/**
 * Issue #3073: Duplicate API key names should be rejected with 409 Conflict.
 * Keys with the same name cannot coexist within the same tenant.
 * Different tenants may reuse the same key name.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AuthManager } from '../services/auth/AuthManager.js';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Issue #3073 — Duplicate key name rejection', () => {
  let auth: AuthManager;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `aegis-test-3073-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    auth = new AuthManager(join(tmpDir, 'keys.json'), 'master-token', 'default');
    await auth.load();
  });

  it('rejects creating a key with a duplicate name in the same tenant', async () => {
    await auth.createKey('my-key', 100, undefined, 'admin');

    await expect(auth.createKey('my-key', 100, undefined, 'admin'))
      .rejects.toThrow('already exists');
  });

  it('allows creating a key with the same name in a different tenant', async () => {
    await auth.createKey('my-key', 100, undefined, 'viewer', undefined, 'tenant-A');
    const result = await auth.createKey('my-key', 100, undefined, 'viewer', undefined, 'tenant-B');

    expect(result.name).toBe('my-key');
    expect(result.tenantId).toBe('tenant-B');
  });

  it('throws error with code DUPLICATE_KEY_NAME and statusCode 409', async () => {
    await auth.createKey('dup-key', 100, undefined, 'admin');

    try {
      await auth.createKey('dup-key', 100, undefined, 'admin');
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('DUPLICATE_KEY_NAME');
      expect(err.statusCode).toBe(409);
      expect(err.message).toContain('dup-key');
    }
  });

  it('allows reusing a name after the key is revoked', async () => {
    const { id } = await auth.createKey('recyclable', 100, undefined, 'admin');
    await auth.revokeKey(id);

    const result = await auth.createKey('recyclable', 100, undefined, 'admin');
    expect(result.name).toBe('recyclable');
  });

  it('allows creating keys with different names in the same tenant', async () => {
    await auth.createKey('key-alpha', 100, undefined, 'admin');
    const result = await auth.createKey('key-beta', 100, undefined, 'admin');

    expect(result.name).toBe('key-beta');
  });
});
