import { useState, useEffect, useRef, useCallback } from 'react';
import type { SessionInfo, SessionHealth, SessionMetrics } from '../types';
import {
  getSession,
  getSessionHealth,
  getSessionPane,
  getSessionMetrics,
  subscribeSSE,
} from '../api/client';
import { useStore } from '../store/useStore';
import { useToastStore } from '../store/useToastStore';

interface SessionSSEEventData {
  event: 'status' | 'message' | 'approval' | 'ended' | 'heartbeat' | 'stall' | 'dead' | 'connected';
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface UseSessionPollingReturn {
  session: SessionInfo | null;
  health: SessionHealth | null;
  notFound: boolean;
  loading: boolean;
  paneContent: string;
  paneLoading: boolean;
  metrics: SessionMetrics | null;
  metricsLoading: boolean;
  refetchPaneAndMetrics: () => void;
}

export function useSessionPolling(sessionId: string): UseSessionPollingReturn {
  const token = useStore((s) => s.token);
  const addToast = useToastStore((t) => t.addToast);

  // Session + health state
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [health, setHealth] = useState<SessionHealth | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  // Pane content state
  const [paneContent, setPaneContent] = useState('');
  const [paneLoading, setPaneLoading] = useState(true);

  // Metrics state
  const [metrics, setMetrics] = useState<SessionMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  // Refs for stable callbacks
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const cancelledRef = useRef(false);

  // Fetch session + health
  const loadSessionAndHealth = useCallback(async () => {
    try {
      const [sessionRes, healthRes] = await Promise.allSettled([
        getSession(sessionIdRef.current),
        getSessionHealth(sessionIdRef.current),
      ]);

      if (
        (sessionRes.status === 'rejected' && (sessionRes.reason as any)?.statusCode === 404) ||
        (healthRes.status === 'rejected' && (healthRes.reason as any)?.statusCode === 404)
      ) {
        setNotFound(true);
        return;
      }

      if (sessionRes.status === 'fulfilled') setSession(sessionRes.value);
      if (healthRes.status === 'fulfilled') setHealth(healthRes.value);
    } catch (e: unknown) {
      addToast('error', 'Failed to load session', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch pane + metrics
  const loadPaneAndMetrics = useCallback(async () => {
    if (cancelledRef.current) return;
    const sid = sessionIdRef.current;

    try {
      const data = await getSessionPane(sid);
      if (!cancelledRef.current) setPaneContent(data.pane ?? '');
    } catch (e: unknown) {
      addToast('warning', 'Failed to load terminal pane', e instanceof Error ? e.message : undefined);
    } finally {
      if (!cancelledRef.current) setPaneLoading(false);
    }

    try {
      const data = await getSessionMetrics(sid);
      if (!cancelledRef.current) setMetrics(data);
    } catch (e: unknown) {
      addToast('warning', 'Failed to load session metrics', e instanceof Error ? e.message : undefined);
    } finally {
      if (!cancelledRef.current) setMetricsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    setPaneLoading(true);
    setMetricsLoading(true);

    loadSessionAndHealth();
    loadPaneAndMetrics();

    return () => { cancelledRef.current = true; };
  }, [sessionId, loadSessionAndHealth, loadPaneAndMetrics]);

  // Debounced refetch timer for pane + metrics
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const schedulePaneAndMetricsRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadPaneAndMetrics();
    }, 1000);
  }, [loadPaneAndMetrics]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // SSE subscription — drives all refetching
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = subscribeSSE(sessionId, (e) => {
      try {
        const parsed: SessionSSEEventData = JSON.parse(e.data as string);

        switch (parsed.event) {
          case 'status':
          case 'approval':
          case 'stall':
          case 'dead':
            // Re-fetch session + health, and also pane + metrics
            loadSessionAndHealth();
            schedulePaneAndMetricsRefetch();
            break;

          case 'message':
            // Re-fetch pane + metrics (debounced)
            schedulePaneAndMetricsRefetch();
            break;

          case 'ended':
            // Final state — re-fetch everything
            loadSessionAndHealth();
            loadPaneAndMetrics();
            break;

          // 'connected', 'heartbeat' — no action needed
        }
      } catch {
        // ignore malformed events
      }
    }, token);

    return () => unsubscribe();
  }, [sessionId, token, loadSessionAndHealth, schedulePaneAndMetricsRefetch, loadPaneAndMetrics]);

  return {
    session,
    health,
    notFound,
    loading,
    paneContent,
    paneLoading,
    metrics,
    metricsLoading,
    refetchPaneAndMetrics: loadPaneAndMetrics,
  };
}
