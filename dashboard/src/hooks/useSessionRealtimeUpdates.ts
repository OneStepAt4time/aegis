/**
 * hooks/useSessionRealtimeUpdates.ts — Apply targeted session list updates from
 * global SSE events without waiting for the debounced refetch from useSseAwarePolling.
 *
 * Processes session_status_change and session_ended events from the activity stream
 * and updates the store's sessions array immediately. The periodic refetch from
 * useSseAwarePolling (in SessionTable / HomeStatusPanel) serves as a consistency
 * backstop.
 */

import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import type { UIState } from '../types';

const SESSION_RELEVANT_EVENTS: ReadonlySet<string> = new Set([
  'session_status_change',
  'session_ended',
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

    // Read sessions imperatively to avoid adding `sessions` to the dependency
    // array (which would cause an extra render cycle).
    const { sessions, setSessions } = useStore.getState();
    let updated = sessions;
    let changed = false;

    for (const event of newEvents) {
      if (!SESSION_RELEVANT_EVENTS.has(event.event)) continue;
      if (event.sessionId === 'global') continue;

      if (event.event === 'session_status_change') {
        const newStatus = event.data?.status as UIState | undefined;
        if (!newStatus) continue;

        const idx = updated.findIndex((s) => s.id === event.sessionId);
        if (idx !== -1 && updated[idx].status !== newStatus) {
          if (!changed) updated = [...updated]; // lazy shallow clone
          updated[idx] = { ...updated[idx], status: newStatus, lastActivity: Date.now() };
          changed = true;
        }
      } else if (event.event === 'session_ended') {
        const before = updated.length;
        updated = updated.filter((s) => s.id !== event.sessionId);
        if (updated.length !== before) changed = true;
      }
    }

    if (changed) {
      setSessions(updated);
    }
  }, [activities]);
}
