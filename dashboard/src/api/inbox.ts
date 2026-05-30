/**
 * api/inbox.ts — Inbox API client.
 */

import { request } from './client';
import type { InboxListResponse, InboxItem } from '../types/inbox';

export async function fetchInbox(): Promise<InboxListResponse> {
  return request<InboxListResponse>('/v1/inbox');
}

export async function markInboxItemRead(id: string): Promise<InboxItem> {
  return request<InboxItem>(`/v1/inbox/${id}/read`, { method: 'POST' });
}

export async function markAllInboxRead(): Promise<void> {
  await request<void>('/v1/inbox/read-all', { method: 'POST' });
}

export async function archiveInboxItem(id: string): Promise<InboxItem> {
  return request<InboxItem>(`/v1/inbox/${id}/archive`, { method: 'POST' });
}

export async function archiveAllInboxRead(): Promise<void> {
  await request<void>('/v1/inbox/archive-all', { method: 'POST' });
}
