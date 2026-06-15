/**
 * hooks/useSessionRealtimeUpdates.ts — Apply targeted session list updates from
 * global SSE events without waiting for the debounced refetch from useSseAwarePolling.
 *
 * Processes session_status_change, session_ended, session_created, session_stall,
 * and session_dead events from the activity stream and updates the store's sessions
 * array and health map immediately. The periodic refetch from useSseAwarePolling
 * (in SessionTable / HomeStatusPanel) serves as a consistency backstop.
 *
 * Issue #4683: Reports SSE-push to store-commit latency to perfRecorder for
 * the Endurance Test "session list responsiveness" surface. The recorded
 * value is the time the effect body took to walk events and dispatch
 * setSessions/setHealth — a tight upper bound on the user-visible
 * push-to-render delay (React reconciliation is sub-frame in this app).
 */

import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { useApprovalStore } from '../store/useApprovalStore';
import { useToastStore } from '../store/useToastStore';
import { perfRecorder } from '../utils/perfRecorder';
import type { UIState, SessionHealthState } from '../types';

const SESSION_RELEVANT_EVENTS: ReadonlySet<string> = new Set([
  'session_status_change',
  'session_ended',
  'session_created',
  'session_stall',
  'session_dead',
  'session_approval',
]);

/**
 * Apply real-time SSE updates to the session list.
 * Call once in a page component that renders session data (e.g. OverviewPage).
 */
export function useSessionRealtimeUpdates(): void {
  const activities = useStore((s) => s.activities);
  const lastProcessedKey = useRef<string | null>(null);

  useEffect(() => {
    // Issue #4683 — start the push-to-render timer at the moment this
    // effect is scheduled, which is the moment React observed a new
    // event in the activities array. We compare to performance.now()
    // at setSessions/setHealth below to record the latency.
    const startedAt = performance.now();

    // Collect new events since last render (activities are newest-first).
    const newEvents = [];
    for (const activity of activities) {
      if (activity.renderKey === lastProcessedKey.current) break;
      newEvents.push(activity);
    }

    // Mark all current activities as processed — even non-session ones — so we
    // never re-scan them.
    lastProcessedKey.current = activities[0]?.renderKey ?? null;

    if (newEvents.length === 0) return;

    // Read sessions and healthMap imperatively to avoid adding them to the
    // dependency array (which would cause extra render cycles).
    const { sessions, setSessions, healthMap, setHealth } = useStore.getState();
    let updatedSessions = sessions;
    const updatedHealthMap = { ...healthMap };
    let sessionsChanged = false;
    let healthChanged = false;

    for (const event of newEvents) {
      if (!SESSION_RELEVANT_EVENTS.has(event.event)) continue;
      if (event.sessionId === 'global') continue;

      // Extract status for use in multiple handlers below
      let newStatus: UIState | undefined;
      if (event.event === 'session_status_change') {
        newStatus = event.data?.status as UIState | undefined;
        if (!newStatus) continue;

        const idx = updatedSessions.findIndex((s) => s.id === event.sessionId);
        if (idx !== -1 && updatedSessions[idx].status !== newStatus) {
          // Toast when session finishes working
          if (updatedSessions[idx].status === 'working' && (newStatus === 'idle' || newStatus === 'completed' || newStatus === 'killed')) {
            const name = updatedSessions[idx].displayName || updatedSessions[idx].id.slice(0, 8);
            if (newStatus === 'killed') {
              useToastStore.getState().addToast('info', `Session killed: ${name}`, undefined, { duration: 3000 });
            } else {
              useToastStore.getState().addToast('success', `Session completed: ${name}`, undefined, { duration: 4000 });
            }
          }
          if (!sessionsChanged) updatedSessions = [...updatedSessions]; // lazy shallow clone
          updatedSessions[idx] = { ...updatedSessions[idx], status: newStatus, lastActivity: Date.now() };
          sessionsChanged = true;
        }
      } else if (event.event === 'session_ended') {
        const before = updatedSessions.length;
        updatedSessions = updatedSessions.filter((s) => s.id !== event.sessionId);
        if (updatedSessions.length !== before) sessionsChanged = true;
      } else if (event.event === 'session_created') {
        // session_created data contains the new session info as SessionInfo
        const newSession = event.data as unknown as { id: string } | undefined;
        if (newSession?.id && !updatedSessions.find((s) => s.id === newSession.id)) {
          updatedSessions = [...updatedSessions, newSession as Parameters<typeof setSessions>[0][number]];
          sessionsChanged = true;
        }
      } else if (event.event === 'session_stall') {
        const existing = updatedHealthMap[event.sessionId!];
        if (!existing || existing.health !== 'stall') {
          updatedHealthMap[event.sessionId!] = { alive: true, loading: false, health: 'stall' as SessionHealthState };
          healthChanged = true;
        }
      } else if (event.event === 'session_dead') {
        const existing = updatedHealthMap[event.sessionId!];
        if (!existing || existing.health !== 'dead') {
          updatedHealthMap[event.sessionId!] = { alive: false, loading: false, health: 'dead' as SessionHealthState };
          healthChanged = true;
        }
      }

      // Sync approval store: remove from pending when status changes away from permission_prompt
      if (event.event === 'session_status_change' && newStatus && newStatus !== 'permission_prompt') {
        const pending = useApprovalStore.getState().pending;
        if (pending.has(event.sessionId!)) {
          useApprovalStore.getState().removeApproval(event.sessionId!);
        }
      }

      // Forward-compatible: handle session_approval SSE event (#3697)
      if (event.event === 'session_approval') {
        const approvalData = event.data as { action?: string } | undefined;
        const action = approvalData?.action;
        if (action && useApprovalStore.getState().pending.has(event.sessionId!)) {
          useApprovalStore.getState().removeApproval(event.sessionId!);
        }
      }
    }

    if (sessionsChanged) {
      setSessions(updatedSessions);
    }
    if (healthChanged) {
      setHealth(updatedHealthMap);
    }

    // Issue #4683 — record the latency for any batch that actually
    // changed the list. A no-op batch is uninteresting; ignore it.
    if (sessionsChanged || healthChanged) {
      perfRecorder.recordSsePushToRender(performance.now() - startedAt);
    }
  }, [activities]);
}
