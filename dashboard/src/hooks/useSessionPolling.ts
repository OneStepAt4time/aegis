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

function hasStatusCode(reason: unknown): reason is Error & { statusCode: number } {
  return reason instanceof Error && 'statusCode' in reason;
}

interface SessionSSEEventData {
  event: 'status' | 'message' | 'approval' | 'ended' | 'heartbeat' | 'stall' | 'dead' | 'system' | 'hook' | 'subagent_start' | 'subagent_stop';
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
  const generationRef = useRef(0);

  // Fetch session + health
  const loadSessionAndHealth = useCallback(async () => {
    try {
      const [sessionRes, healthRes] = await Promise.allSettled([
        getSession(sessionIdRef.current),
        getSessionHealth(sessionIdRef.current),
      ]);

      if (
        (sessionRes.status === 'rejected' && hasStatusCode(sessionRes.reason) && sessionRes.reason.statusCode === 404) ||
        (healthRes.status === 'rejected' && hasStatusCode(healthRes.reason) && healthRes.reason.statusCode === 404)
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
    generationRef.current++;
    setLoading(true);
    setPaneLoading(true);
    setMetricsLoading(true);

    loadSessionAndHealth();
    loadPaneAndMetrics();

    return () => {
      cancelledRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (sessionDebounceRef.current) clearTimeout(sessionDebounceRef.current);
    };
  }, [sessionId, loadSessionAndHealth, loadPaneAndMetrics]);

  // Debounced refetch timers
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sessionDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const schedulePaneAndMetricsRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const gen = generationRef.current;
    debounceRef.current = setTimeout(() => {
      if (generationRef.current !== gen) return;
      loadPaneAndMetrics();
    }, 1000);
  }, [loadPaneAndMetrics]);

  const scheduleSessionAndHealthRefetch = useCallback(() => {
    if (sessionDebounceRef.current) clearTimeout(sessionDebounceRef.current);
    const gen = generationRef.current;
    sessionDebounceRef.current = setTimeout(() => {
      if (generationRef.current !== gen) return;
      loadSessionAndHealth();
    }, 1000);
  }, [loadSessionAndHealth]);

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
            // Re-fetch session + health (debounced), and pane + metrics (debounced)
            scheduleSessionAndHealthRefetch();
            schedulePaneAndMetricsRefetch();
            break;

          case 'message':
            // Re-fetch pane + metrics (debounced)
            schedulePaneAndMetricsRefetch();
            break;

          case 'ended':
            // Final state — re-fetch everything immediately
            loadSessionAndHealth();
            loadPaneAndMetrics();
            break;

          // 'heartbeat', 'system', 'hook', 'subagent_start', 'subagent_stop' — no action needed
        }
      } catch {
        // ignore malformed events
      }
    }, token);

    return () => unsubscribe();
  }, [sessionId, token, scheduleSessionAndHealthRefetch, schedulePaneAndMetricsRefetch, loadSessionAndHealth, loadPaneAndMetrics]);

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
