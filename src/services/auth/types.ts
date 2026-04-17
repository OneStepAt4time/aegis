import type { ApiKeyPermission } from './permissions.js';

export type ApiKeyRole = 'admin' | 'operator' | 'viewer';

export interface ApiKey {
  id: string;
  name: string;
  hash: string;
  createdAt: number;
  lastUsedAt: number;
  rateLimit: number;
  expiresAt: number | null;
  role: ApiKeyRole;
  permissions: ApiKeyPermission[];
}

export interface ApiKeyStore {
  keys: ApiKey[];
}

/** Rejection reason when validate() returns valid=false. */
export type AuthRejectReason = 'expired' | 'invalid' | 'no_auth';
