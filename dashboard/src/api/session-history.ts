/**
 * api/session-history.ts — Session history endpoints.
 */

import { request } from './base';

export interface SessionHistoryRecord {
  id: string;
  ownerKeyId?: string;
  createdAt?: number;
  endedAt?: number;
  lastSeenAt: number;
  finalStatus: 'active' | 'killed' | 'unknown';
  source: 'audit' | 'live' | 'audit+live';
}

export interface SessionHistoryResponse {
  records: SessionHistoryRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface FetchSessionHistoryParams {
  page?: number;
  limit?: number;
  status?: 'active' | 'killed' | 'unknown';
  ownerKeyId?: string;
  nameSearch?: string;
  createdAfter?: number;
  createdBefore?: number;
  sortBy?: 'createdAt' | 'lastSeenAt' | 'status';
  sortOrder?: 'asc' | 'desc';
  signal?: AbortSignal;
}

export function fetchSessionHistory(params: FetchSessionHistoryParams = {}): Promise<SessionHistoryResponse> {
  const { signal, ...queryParams } = params;
  const searchParams = new URLSearchParams();
  if (queryParams.page !== undefined) searchParams.set('page', String(queryParams.page));
  if (queryParams.limit !== undefined) searchParams.set('limit', String(queryParams.limit));
  if (queryParams.status) searchParams.set('status', queryParams.status);
  if (queryParams.ownerKeyId) searchParams.set('ownerKeyId', queryParams.ownerKeyId);
  if (queryParams.nameSearch) searchParams.set('name', queryParams.nameSearch);
  if (queryParams.createdAfter) searchParams.set('createdAfter', String(queryParams.createdAfter));
  if (queryParams.createdBefore) searchParams.set('createdBefore', String(queryParams.createdBefore));
  if (queryParams.sortBy) searchParams.set('sortBy', queryParams.sortBy);
  if (queryParams.sortOrder) searchParams.set('sortOrder', queryParams.sortOrder);

  const query = searchParams.toString();
  const path = query ? `/v1/sessions/history?${query}` : '/v1/sessions/history';
  return request<SessionHistoryResponse>(path, { signal });
}
