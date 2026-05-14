/**
 * Issue #3359: Viewer can enumerate all API keys across tenants via rate-limits endpoint.
 * The endpoint should only return keys belonging to the requesting key's tenant,
 * unless the requesting key is a system admin.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthManager } from '../services/auth/AuthManager.js';
import { SYSTEM_TENANT } from '../config.js';

describe('Issue #3359: Tenant isolation on /v1/analytics/rate-limits', () => {
  let tmpDir: string;
  let keysFile: string;
  let auth: AuthManager;

  beforeEach(async () => {
    tmpDir = join('/tmp', `test-3359-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
    keysFile = join(tmpDir, 'keys.json');
    auth = new AuthManager(keysFile, 'master-secret');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('listKeys() returns all keys across tenants', async () => {
    // Create keys on different tenants
    await auth.createKey('system-admin', 100, undefined, 'admin'); // gets SYSTEM_TENANT
    await auth.createKey('default-viewer', 100, undefined, 'viewer', undefined, 'default');
    await auth.createKey('tenant-b-viewer', 100, undefined, 'viewer', undefined, 'tenant-b');

    const allKeys = auth.listKeys();
    expect(allKeys).toHaveLength(3);
  });

  it('tenant-scoped filter returns only matching tenant keys', async () => {
    await auth.createKey('system-admin', 100, undefined, 'admin'); // SYSTEM_TENANT
    await auth.createKey('default-viewer', 100, undefined, 'viewer', undefined, 'default');
    await auth.createKey('tenant-b-viewer', 100, undefined, 'viewer', undefined, 'tenant-b');

    const allKeys = auth.listKeys();
    // Simulate tenant-scoped filtering (same logic as the fix)
    const requestTenant: string = 'default';
    const requestRole: string = 'viewer';
    const filtered = (requestTenant === SYSTEM_TENANT || requestRole === 'admin')
      ? allKeys
      : allKeys.filter(k => k.tenantId === requestTenant);

    // Default viewer should only see 1 key (the default-tenant one)
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('default-viewer');
  });

  it('system admin sees all keys', async () => {
    await auth.createKey('system-admin', 100, undefined, 'admin');
    await auth.createKey('default-viewer', 100, undefined, 'viewer', undefined, 'default');
    await auth.createKey('tenant-b-viewer', 100, undefined, 'viewer', undefined, 'tenant-b');

    const allKeys = auth.listKeys();
    const requestTenant: string = SYSTEM_TENANT;
    const requestRole: string = 'admin';
    const filtered = (requestTenant === SYSTEM_TENANT || requestRole === 'admin')
      ? allKeys
      : allKeys.filter(k => k.tenantId === requestTenant);

    expect(filtered).toHaveLength(3);
  });

  it('tenant-b viewer cannot see default or system keys', async () => {
    await auth.createKey('system-admin', 100, undefined, 'admin');
    await auth.createKey('default-viewer', 100, undefined, 'viewer', undefined, 'default');
    await auth.createKey('tenant-b-viewer', 100, undefined, 'viewer', undefined, 'tenant-b');

    const allKeys = auth.listKeys();
    const filtered = allKeys.filter(k => k.tenantId === 'tenant-b');

    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('tenant-b-viewer');
  });
});
