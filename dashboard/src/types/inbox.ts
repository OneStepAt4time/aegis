/**
 * types/inbox.ts — Inbox feature types.
 */

export type InboxItemType =
  | 'task_completed'
  | 'task_failed'
  | 'blocker'
  | 'mention'
  | 'session_idle';

export type InboxReferenceType = 'session' | 'autopilot' | 'squad' | 'chat';

export type InboxActorType = 'agent' | 'system';

export interface InboxItem {
  id: string;
  workspaceId: string;
  userId: string;
  actorType: InboxActorType;
  actorId: string;
  type: InboxItemType;
  title: string;
  body?: string;
  referenceType?: InboxReferenceType;
  referenceId?: string;
  readAt?: string;
  archivedAt?: string;
  createdAt: string;
}

export interface InboxListResponse {
  items: InboxItem[];
  unreadCount: number;
}

export type InboxFilter = 'all' | 'unread' | 'archived';
