/**
 * api/users.ts — User management endpoints.
 */

import { request } from './base';

export interface UserSummary {
  id: string;
  name: string;
  role: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number | null;
  rateLimit: number;
  activeSessions: number;
  totalSessionsCreated: number;
  lastSessionAt: number | null;
}

export interface UsersResponse {
  count: number;
  users: UserSummary[];
}

export function fetchUsers(signal?: AbortSignal): Promise<UsersResponse> {
  return request<UsersResponse>('/v1/users', { signal });
}
