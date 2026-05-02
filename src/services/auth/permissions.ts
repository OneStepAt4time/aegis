export const API_KEY_PERMISSION_VALUES = ['create', 'send', 'approve', 'reject', 'kill', 'audit'] as const;

export type ApiKeyPermission = typeof API_KEY_PERMISSION_VALUES[number];

type PermissionRole = 'admin' | 'operator' | 'viewer';

const DEFAULT_ROLE_PERMISSIONS: Record<PermissionRole, readonly ApiKeyPermission[]> = {
  admin: API_KEY_PERMISSION_VALUES,
  operator: API_KEY_PERMISSION_VALUES,
  viewer: ['audit'],
};

export function isApiKeyPermission(value: string): value is ApiKeyPermission {
  return API_KEY_PERMISSION_VALUES.includes(value as ApiKeyPermission);
}

export function permissionsForRole(role: PermissionRole): ApiKeyPermission[] {
  return [...DEFAULT_ROLE_PERMISSIONS[role]];
}

export function normalizePermissions(permissions: Iterable<ApiKeyPermission>): ApiKeyPermission[] {
  const granted = new Set<ApiKeyPermission>(permissions);
  return API_KEY_PERMISSION_VALUES.filter(permission => granted.has(permission));
}
