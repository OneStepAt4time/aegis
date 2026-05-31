import { SYSTEM_TENANT } from '../config.js';

export function resolveRequestTenantScope(
  tenantId: string | undefined,
  authEnabled: boolean,
): string | undefined {
  return tenantId ?? (authEnabled ? undefined : SYSTEM_TENANT);
}
