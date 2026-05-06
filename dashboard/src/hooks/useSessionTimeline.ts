/**
 * hooks/useSessionTimeline.ts — React hook for session operator timeline.
 *
 * Fetches normalized timeline events from the event replay endpoint
 * and provides them to the OperatorTimeline component.
 */

import { useState, useCallback, useEffect } from 'react';
import type { AcpTimelineEvent } from '../types/acp-timeline';
import { replaySessionEvents } from '../api/acp-timeline-client';

export interface UseSessionTimelineReturn {
  /** Timeline events. */
  events: AcpTimelineEvent[];
  /** Whether events are loading. */
  isLoading: boolean;
  /** Error message, if any. */
  error: string | null;
  /** Refresh events from server. */
  refresh: () => Promise<void>;
  /** Clear error. */
  clearError: () => void;
}

export function useSessionTimeline(sessionId: string | undefined): UseSessionTimelineReturn {
  const [events, setEvents] = useState<AcpTimelineEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await replaySessionEvents(sessionId);
      setEvents(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load timeline');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { events, isLoading, error, refresh, clearError };
}
