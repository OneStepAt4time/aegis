import { useCallback, useEffect, useRef } from 'react';

interface UseSseAwarePollingOptions {
  refresh: () => Promise<void>;
  sseConnected: boolean;
  eventTrigger?: unknown;
  fallbackPollIntervalMs: number;
  healthyPollIntervalMs: number;
  eventDebounceMs?: number;
}

export const DEFAULT_SSE_EVENT_DEBOUNCE_MS = 1_000;

export function useSseAwarePolling({
  refresh,
  sseConnected,
  eventTrigger,
  fallbackPollIntervalMs,
  healthyPollIntervalMs,
  eventDebounceMs = DEFAULT_SSE_EVENT_DEBOUNCE_MS,
}: UseSseAwarePollingOptions): void {
  const disposedRef = useRef(false);
  const inFlightRef = useRef(false);
  const queuedRefreshRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventTriggerRef = useRef(eventTrigger);

  const clearTimers = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (eventTimerRef.current) {
      clearTimeout(eventTimerRef.current);
      eventTimerRef.current = null;
    }
  }, []);

  const runRefresh = useCallback(async () => {
    if (disposedRef.current) {
      return;
    }

    if (inFlightRef.current) {
      queuedRefreshRef.current = true;
      return;
    }

    inFlightRef.current = true;
    try {
      await refresh();
    } finally {
      inFlightRef.current = false;

      if (queuedRefreshRef.current && !disposedRef.current) {
        queuedRefreshRef.current = false;
        void runRefresh();
      }
    }
  }, [refresh]);

  useEffect(() => {
    disposedRef.current = false;

    return () => {
      disposedRef.current = true;
      clearTimers();
    };
  }, [clearTimers]);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      await runRefresh();

      if (cancelled || disposedRef.current) {
        return;
      }

      pollTimerRef.current = setTimeout(() => {
        void poll();
      }, sseConnected ? healthyPollIntervalMs : fallbackPollIntervalMs);
    };

    void poll();

    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [fallbackPollIntervalMs, healthyPollIntervalMs, runRefresh, sseConnected]);

  useEffect(() => {
    if (!sseConnected) {
      lastEventTriggerRef.current = eventTrigger;
      if (eventTimerRef.current) {
        clearTimeout(eventTimerRef.current);
        eventTimerRef.current = null;
      }
      return;
    }

    if (typeof eventTrigger === 'undefined' || Object.is(eventTrigger, lastEventTriggerRef.current)) {
      return;
    }

    lastEventTriggerRef.current = eventTrigger;

    if (eventTimerRef.current) {
      return;
    }

    eventTimerRef.current = setTimeout(() => {
      eventTimerRef.current = null;
      void runRefresh();
    }, eventDebounceMs);
  }, [eventDebounceMs, eventTrigger, runRefresh, sseConnected]);
}