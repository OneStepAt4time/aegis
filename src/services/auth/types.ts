import type { ApiKeyPermission } from './permissions.js';

export type ApiKeyRole = 'admin' | 'operator' | 'viewer';

export interface QuotaConfig {
  /** Max concurrent sessions for this key (null = unlimited). */
  maxConcurrentSessions: number | null;
  /** Max tokens (input + output) per rolling window (null = unlimited). */
  maxTokensPerWindow: number | null;
  /** Max estimated USD spend per rolling window (null = unlimited). */
  maxSpendPerWindow: number | null;
  /** Rolling window duration in milliseconds (default 1 hour). */
  quotaWindowMs: number;
}

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
  /** Per-key resource quotas (Issue #1953). Omitted when no quotas set. */
  quotas?: QuotaConfig;
}

export interface ApiKeyStore {
  keys: ApiKey[];
}

/** A deprecated key hash that remains valid during a grace period after rotation. */
export interface GraceKeyEntry {
  /** SHA-256 hash of the old API key. */
  hash: string;
  /** ID of the key that was rotated. */
  keyId: string;
  /** Timestamp (ms epoch) when this grace entry expires. */
  graceExpiresAt: number;
}

/** Rejection reason when validate() returns valid=false. */
export type AuthRejectReason = 'expired' | 'invalid' | 'no_auth';
