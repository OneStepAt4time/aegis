/**
 * tenant-filter.ts — Shared tenant scoping filter.
 *
 * SYSTEM_TENANT callers (master keys) see everything.
 * Regular tenant callers see only their own items.
 * Items without tenantId (legacy) are only visible to SYSTEM_TENANT.
 */

import { SYSTEM_TENANT } from '../config.js';

export function filterByTenant<T extends { tenantId?: string }>(
  items: T[],
  callerTenantId: string | undefined,
): T[] {
  if (callerTenantId === SYSTEM_TENANT) return items;
  if (callerTenantId === undefined) return [];
  return items.filter(item => item.tenantId === callerTenantId);
}
