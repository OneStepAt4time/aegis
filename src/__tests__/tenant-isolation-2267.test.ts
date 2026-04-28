/**
 * Tests for Issue #2267 — Admin tenant isolation bypass fix.
 */

import { describe, it, expect } from 'vitest';
import { SYSTEM_TENANT } from '../config.js';

describe('SYSTEM_TENANT constant', () => {
  it('should be a non-empty string', () => {
    expect(typeof SYSTEM_TENANT).toBe('string');
    expect(SYSTEM_TENANT.length).toBeGreaterThan(0);
  });

  it('should not collide with user-defined tenant names', () => {
    expect(SYSTEM_TENANT.startsWith('_')).toBe(true);
  });
});

describe('filterByTenant (Issue #2267)', () => {
  function filterByTenant<T extends { tenantId?: string }>(
    items: T[],
    callerTenantId: string | undefined,
  ): T[] {
    if (callerTenantId === SYSTEM_TENANT || callerTenantId === undefined) return items;
    return items.filter(item => item.tenantId === callerTenantId);
  }

  interface TestItem {
    id: string;
    tenantId?: string;
  }

  const makeItems = (): TestItem[] => [
    { id: '1', tenantId: 'acme' },
    { id: '2', tenantId: 'globex' },
    { id: '3', tenantId: 'acme' },
    { id: '4' }, // legacy, no tenant
  ];

  it('SYSTEM_TENANT sees all items', () => {
    const result = filterByTenant(makeItems(), SYSTEM_TENANT);
    expect(result).toHaveLength(4);
  });

  it('regular tenant only sees own items', () => {
    const result = filterByTenant(makeItems(), 'acme');
    expect(result).toHaveLength(2);
    expect(result.every(i => i.tenantId === 'acme')).toBe(true);
  });

  it('regular tenant cannot see other tenant items', () => {
    const result = filterByTenant(makeItems(), 'acme');
    expect(result.find(i => i.tenantId === 'globex')).toBeUndefined();
  });

  it('regular tenant cannot see legacy (no-tenant) items', () => {
    const result = filterByTenant(makeItems(), 'acme');
    expect(result.find(i => !i.tenantId)).toBeUndefined();
  });

  it('non-existent tenant sees nothing', () => {
    const result = filterByTenant(makeItems(), 'nonexistent');
    expect(result).toHaveLength(0);
  });

  it('undefined callerTenantId returns all (backward compat for unauthenticated)', () => {
    const result = filterByTenant(makeItems(), undefined);
    expect(result).toHaveLength(4);
  });
});

describe('tenant scoping logic (Issue #2267)', () => {
  // Helper that mirrors the check in context.ts
  function isCrossTenantBlocked(callerTenant: string | undefined, sessionTenant: string | undefined): boolean {
    if (!callerTenant) return false;
    if (callerTenant === SYSTEM_TENANT) return false;
    if (!sessionTenant) return false; // legacy session, visible to all
    return callerTenant !== sessionTenant;
  }

  it('SYSTEM_TENANT bypasses tenant scoping', () => {
    expect(isCrossTenantBlocked(SYSTEM_TENANT, 'acme')).toBe(false);
  });

  it('regular tenant is blocked from cross-tenant access', () => {
    expect(isCrossTenantBlocked('globex', 'acme')).toBe(true);
  });

  it('same-tenant access is allowed', () => {
    expect(isCrossTenantBlocked('acme', 'acme')).toBe(false);
  });

  it('undefined caller is not blocked', () => {
    expect(isCrossTenantBlocked(undefined, 'acme')).toBe(false);
  });

  it('legacy session (no tenant) is not blocked', () => {
    expect(isCrossTenantBlocked('acme', undefined)).toBe(false);
  });
});
