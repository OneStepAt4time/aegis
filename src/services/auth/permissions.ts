/**
 * permissions.ts — RBAC permission matrix (Issue #2081).
 *
 * Action-based permissions are grouped by resource domain (SESSION_*, KEY_*).
 * Each role maps to a fixed set of permissions enforced at the route layer.
 */

export const Permission = {
  SESSION_CREATE: 'SESSION_CREATE',
  SESSION_READ:   'SESSION_READ',
  SESSION_SEND:   'SESSION_SEND',
  SESSION_KILL:   'SESSION_KILL',
  SESSION_APPROVE:'SESSION_APPROVE',
  KEY_CREATE:     'KEY_CREATE',
  KEY_REVOKE:     'KEY_REVOKE',
} as const;

export type Permission = typeof Permission[keyof typeof Permission];

/** Canonical ordering — used for normalisation and stable serialization. */
export const PERMISSION_VALUES: readonly Permission[] = [
  Permission.SESSION_CREATE,
  Permission.SESSION_READ,
  Permission.SESSION_SEND,
  Permission.SESSION_KILL,
  Permission.SESSION_APPROVE,
  Permission.KEY_CREATE,
  Permission.KEY_REVOKE,
];

/** Role → default permission set. */
const ROLE_PERMISSIONS: Record<ApiKeyRole, readonly Permission[]> = {
  admin:    PERMISSION_VALUES,
  operator: [Permission.SESSION_CREATE, Permission.SESSION_READ, Permission.SESSION_SEND],
  viewer:   [Permission.SESSION_READ],
};

export type ApiKeyRole = 'admin' | 'operator' | 'viewer';

export function isPermission(value: string): value is Permission {
  return (PERMISSION_VALUES as readonly string[]).includes(value);
}

/** Return the default permission set for a role (fresh copy). */
export function permissionsForRole(role: ApiKeyRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/** Deduplicate and order an iterable of permissions against the canonical list. */
export function normalizePermissions(permissions: Iterable<Permission>): Permission[] {
  const granted = new Set<Permission>(permissions);
  return PERMISSION_VALUES.filter(p => granted.has(p));
}

// ── Legacy aliases for backward compatibility during migration ────────

/** @deprecated Use Permission enum values instead. Will be removed in next major. */
export const API_KEY_PERMISSION_VALUES = PERMISSION_VALUES;
/** @deprecated Use Permission enum values instead. */
export type ApiKeyPermission = Permission;
/** @deprecated Use isPermission instead. */
export const isApiKeyPermission = isPermission;
