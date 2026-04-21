export type ApiKeyRole = 'admin' | 'operator' | 'viewer';

/**
 * Per-action session permissions for fine-grained RBAC (Issue #2081).
 * When an ApiKey has a non-null `permissions` array, these override the
 * coarse role-based check. An empty array = read-only (viewer).
 * `["session:*"]` grants all actions. Null = fall back to role.
 */
export type SessionAction =
  | 'session:create'
  | 'session:send'
  | 'session:command'
  | 'session:bash'
  | 'session:approve'
  | 'session:reject'
  | 'session:kill'
  | 'session:interrupt'
  | 'session:read';

export interface ApiKey {
  id: string;
  name: string;
  hash: string;
  createdAt: number;
  lastUsedAt: number;
  rateLimit: number;
  expiresAt: number | null;
  role: ApiKeyRole;
  /** Issue #2081: Explicit per-action permissions. Null = use role fallback. */
  permissions: SessionAction[] | null;
}

export interface ApiKeyStore {
  keys: ApiKey[];
}

/** Rejection reason when validate() returns valid=false. */
export type AuthRejectReason = 'expired' | 'invalid' | 'no_auth';
