/**
 * hooks/useSessionEvents.ts — One hook, one source of truth.
 *
 * Issue 07 of the `session-cockpit` epic. See
 * `.claude/epics/session-cockpit/epic.md`.
 *
 * Reads the session transcript from `GET /v1/sessions/:id/messages`,
 * subscribes to SSE, and updates the shared store on:
 *   - `message`  → refetch entries (server-parsed, authoritative)
 *   - `approval` → increment approval counter
 *   - `status`   → increment status-change counter
 *
 * Consumers (Metrics tab, Transcript tab, timeline scrubber) all read
 * from the same store, so counts and bubbles cannot disagree.
 */

import { useEffect } from 'react';
import {
  getSessionMessages,
  getSessionMetrics,
  subscribeSSE,
} from '../api/client';
import { useStore } from '../store/useStore';
import {
  useSessionEventsStore,
  selectSession,
  selectMessageCount,
  selectToolCallCount,
  selectUserMessageCount,
  selectAssistantMessageCount,
  selectThinkingCount,
  type SessionEventState,
} from '../store/useSessionEventsStore';
import { SessionSSEEventDataSchema } from '../api/schemas';

export interface UseSessionEventsReturn {
  state: SessionEventState;
  counts: {
    messages: number;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    thinking: number;
    approvals: number;
    autoApprovals: number;
    statusChanges: number;
  };
}

/** Debounce interval for SSE-triggered refetches. Matches the pattern
 *  already used by `useSessionPolling`. */
const REFETCH_DEBOUNCE_MS = 500;

export function useSessionEvents(sessionId: string): UseSessionEventsReturn {
  const token = useStore((s) => s.token);
  const ensureSession = useSessionEventsStore((s) => s.ensureSession);
  const setEntries = useSessionEventsStore((s) => s.setEntries);
  const setMetrics = useSessionEventsStore((s) => s.setMetrics);
  const setLoading = useSessionEventsStore((s) => s.setLoading);
  const setError = useSessionEventsStore((s) => s.setError);
  const incrementCounter = useSessionEventsStore((s) => s.incrementCounter);
  const clearSession = useSessionEventsStore((s) => s.clearSession);

  const state = useSessionEventsStore((s) => selectSession(s, sessionId));

  useEffect(() => {
    if (!sessionId) return;

    ensureSession(sessionId);
    setLoading(sessionId, true);

    let cancelled = false;
    let refetchTimer: ReturnType<typeof setTimeout> | undefined;

    async function loadEntries() {
      try {
        const response = await getSessionMessages(sessionId);
        if (cancelled) return;
        setEntries(sessionId, response.messages, response.status);
      } catch (err) {
        if (cancelled) return;
        setError(sessionId, err instanceof Error ? err.message : 'Unknown error');
      }
    }

    async function loadMetrics() {
      try {
        const metrics = await getSessionMetrics(sessionId);
        if (cancelled) return;
        setMetrics(sessionId, metrics);
      } catch {
        // Metrics failures are non-fatal — the token card simply won't render.
      }
    }

    function scheduleRefetch() {
      if (refetchTimer) clearTimeout(refetchTimer);
      refetchTimer = setTimeout(() => {
        if (cancelled) return;
        void loadEntries();
        void loadMetrics();
      }, REFETCH_DEBOUNCE_MS);
    }

    void loadEntries();
    void loadMetrics();

    const unsubscribe = subscribeSSE(
      sessionId,
      (event) => {
        if (cancelled) return;
        try {
          const parsed = SessionSSEEventDataSchema.safeParse(
            JSON.parse(event.data as string),
          );
          if (!parsed.success) return;

          switch (parsed.data.event) {
            case 'message':
              scheduleRefetch();
              break;
            case 'approval':
              incrementCounter(sessionId, 'approvalCount');
              scheduleRefetch();
              break;
            case 'status':
              incrementCounter(sessionId, 'statusChangeCount');
              scheduleRefetch();
              break;
            case 'ended':
            case 'dead':
              // Final state — refetch immediately, no debounce.
              void loadEntries();
              void loadMetrics();
              break;
            default:
              break;
          }
        } catch {
          // malformed SSE payload — ignore
        }
      },
      token,
    );

    return () => {
      cancelled = true;
      if (refetchTimer) clearTimeout(refetchTimer);
      unsubscribe();
      // Intentionally keep the session slot around briefly in case of
      // fast remount; GC via `clearSession` is left to consumers that
      // know they're navigating away permanently.
      void clearSession;
    };
  }, [
    sessionId,
    token,
    ensureSession,
    setEntries,
    setMetrics,
    setLoading,
    setError,
    incrementCounter,
    clearSession,
  ]);

  const counts = {
    messages: selectMessageCount(state),
    userMessages: selectUserMessageCount(state),
    assistantMessages: selectAssistantMessageCount(state),
    toolCalls: selectToolCallCount(state),
    thinking: selectThinkingCount(state),
    approvals: state.approvalCount,
    autoApprovals: state.autoApprovalCount,
    statusChanges: state.statusChangeCount,
  };

  return { state, counts };
}
