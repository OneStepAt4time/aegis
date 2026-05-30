/**
 * hooks/useInboxFromActivity.ts — Derive inbox items from the activity stream.
 *
 * Layout already subscribes to global SSE → activity store. This hook bridges
 * relevant events to the inbox store without a duplicate SSE connection.
 */

import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { useInboxStore } from '../store/useInboxStore';
import type { InboxItem, InboxItemType } from '../types/inbox';
import type { GlobalSSEEvent } from '../types';

const EVENT_TO_INBOX_TYPE: Partial<Record<GlobalSSEEvent['event'], InboxItemType>> = {
  session_ended: 'task_completed',
  session_dead: 'task_failed',
  session_approval: 'blocker',
  session_stall: 'session_idle',
};

function eventToInboxItem(event: GlobalSSEEvent): InboxItem | null {
  const type = EVENT_TO_INBOX_TYPE[event.event];
  if (!type) return null;

  const sid = event.sessionId !== 'global' ? event.sessionId.slice(0, 8) : '';

  return {
    id: `inbox-${event.id ?? Date.now()}-${event.sessionId}`,
    workspaceId: '',
    userId: '',
    actorType: 'system',
    actorId: event.sessionId,
    type,
    title: deriveTitle(event.event, sid),
    referenceType: 'session',
    referenceId: event.sessionId !== 'global' ? event.sessionId : undefined,
    createdAt: event.timestamp,
  };
}

function deriveTitle(eventType: string, sid: string): string {
  switch (eventType) {
    case 'session_ended': return `Session ${sid} completed`;
    case 'session_dead': return `Session ${sid} failed`;
    case 'session_approval': return `Session ${sid} awaiting approval`;
    case 'session_stall': return `Session ${sid} stalled`;
    default: return `Session ${sid} update`;
  }
}

/**
 * Call once in Layout. Watches activity stream and creates inbox items.
 * Deduplication is handled by the store (addItems checks existing IDs).
 */
export function useInboxFromActivity() {
  const activities = useStore((s) => s.activities);
  const addItems = useInboxStore((s) => s.addItems);
  const prevLength = useRef(activities.length);

  useEffect(() => {
    // Only process new activities (prepended to front of array)
    if (activities.length <= prevLength.current) {
      prevLength.current = activities.length;
      return;
    }

    const newCount = activities.length - prevLength.current;
    const newEvents = activities.slice(0, newCount);
    prevLength.current = activities.length;

    const items = newEvents.map(eventToInboxItem).filter(Boolean) as InboxItem[];
    if (items.length > 0) addItems(items);
  }, [activities, addItems]);
}
