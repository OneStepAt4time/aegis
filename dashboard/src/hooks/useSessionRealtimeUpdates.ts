/**
 * hooks/useSessionRealtimeUpdates.ts — Apply targeted session list updates from
 * global SSE events without waiting for the debounced refetch from useSseAwarePolling.
 *
 * Processes session_status_change, session_ended, session_created, session_stall,
 * and session_dead events from the activity stream and updates the store's sessions
 * array and health map immediately. The periodic refetch from useSseAwarePolling
 * (in SessionTable / HomeStatusPanel) serves as a consistency backstop.
 */

import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import type { UIState, SessionHealthState } from '../types';

const SESSION_RELEVANT_EVENTS: ReadonlySet<string> = new Set([
  'session_status_change',
  'session_ended',
  'session_created',
  'session_stall',
  'session_dead',
]);

/**
 * Apply real-time SSE updates to the session list.
 * Call once in a page component that renders session data (e.g. OverviewPage).
 */
export function useSessionRealtimeUpdates(): void {
  const activities = useStore((s) => s.activities);
  const lastProcessedKey = useRef<string | null>(null);

  useEffect(() => {
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
    let updatedHealthMap = { ...healthMap };
    let sessionsChanged = false;
    let healthChanged = false;

    for (const event of newEvents) {
      if (!SESSION_RELEVANT_EVENTS.has(event.event)) continue;
      if (event.sessionId === 'global') continue;

      if (event.event === 'session_status_change') {
        const newStatus = event.data?.status as UIState | undefined;
        if (!newStatus) continue;

        const idx = updatedSessions.findIndex((s) => s.id === event.sessionId);
        if (idx !== -1 && updatedSessions[idx].status !== newStatus) {
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
    }

    if (sessionsChanged) {
      setSessions(updatedSessions);
    }
    if (healthChanged) {
      setHealth(updatedHealthMap);
    }
  }, [activities]);
}
