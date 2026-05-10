/**
 * Issue #3073: API key creation should reject duplicate names within the same tenant.
 *
 * Security rationale: Duplicate key names create operational confusion during
 * incident response and key rotation. Admins cannot uniquely identify keys by
 * name, leading to potential key confusion during emergency revocation.
 *
 * Expected: Throws DUPLICATE_KEY_NAME when creating a key with a name that
 * already exists for the same tenant. Different tenants may have keys with
 * the same name.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthManager } from '../auth.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

describe('Issue #3073: Duplicate API key name rejection', () => {
  let auth: AuthManager;
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `aegis-3073-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    auth = new AuthManager(tmpFile, '');
  });

  afterEach(async () => {
    try { await rm(tmpFile); } catch { /* ignore */ }
  });

  it('should reject duplicate key names within the same tenant', async () => {
    // Create first key (admin → _system tenant)
    const first = await auth.createKey('dup-test', 100, undefined, 'admin');
    expect(first.name).toBe('dup-test');

    // Attempt duplicate name with same tenant — should throw
    let thrown: any;
    try {
      await auth.createKey('dup-test', 100, undefined, 'admin');
    } catch (err: any) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).toContain('already exists');
    expect(thrown.code).toBe('DUPLICATE_KEY_NAME');
    expect(thrown.statusCode).toBe(409);
  });

  it('should allow same key name for different tenants', async () => {
    // Create key for tenant-a
    const first = await auth.createKey('shared-name', 100, undefined, 'viewer', undefined, 'tenant-a');
    expect(first.name).toBe('shared-name');

    // Create key for tenant-b with same name — should succeed
    const second = await auth.createKey('shared-name', 100, undefined, 'viewer', undefined, 'tenant-b');
    expect(second.name).toBe('shared-name');
    expect(first.id).not.toBe(second.id);
  });

  it('should allow key creation after revoking a key with the same name', async () => {
    // Create first key
    const { id } = await auth.createKey('recyclable', 100, undefined, 'admin');

    // Revoke it
    await auth.revokeKey(id);

    // Create again with same name — should succeed
    const recreated = await auth.createKey('recyclable', 100, undefined, 'admin');
    expect(recreated.name).toBe('recyclable');
    expect(recreated.id).not.toBe(id);
  });

  it('should allow duplicate names across admin (system tenant) and named tenants', async () => {
    // Admin key → always SYSTEM_TENANT
    const admin = await auth.createKey('my-key', 100, undefined, 'admin');
    expect(admin.tenantId).toBe('_system');

    // Viewer key for tenant-a → different tenant, same name OK
    const viewer = await auth.createKey('my-key', 100, undefined, 'viewer', undefined, 'tenant-a');
    expect(viewer.tenantId).toBe('tenant-a');
  });

  it('should reject duplicate admin keys with the same name', async () => {
    await auth.createKey('admin-key', 100, undefined, 'admin');

    // Both admin keys resolve to SYSTEM_TENANT → should conflict
    await expect(
      auth.createKey('admin-key', 100, undefined, 'admin'),
    ).rejects.toThrow('already exists');
  });
});
