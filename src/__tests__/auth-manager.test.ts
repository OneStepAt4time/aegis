/**
 * auth-manager.test.ts — Coverage for methods not exercised by other auth test files.
 *
 * Existing coverage lives in:
 *   auth.test.ts, auth-coverage-1305.test.ts, auth-rbac.test.ts,
 *   auth-key-rotation-grace-2097.test.ts, auth-key-rotation-1403.test.ts,
 *   auth-key-update-3207.test.ts, fix-3484-auth-state-sync.test.ts
 *
 * This file targets the remaining gaps:
 *   - getMasterToken()
 *   - getTenantId()
 *   - getKey()
 *   - setQuotas()
 *   - rotateKey() (non-grace)
 *   - isHealthy()
 *   - createKey() duplicate-name guard (#3073) and tenant-ID assignment (#2267)
 *   - validate() tenantId in result
 *   - Audit logger wiring for key lifecycle events
 *   - checkBatchRateLimit() full flow
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthManager } from '../services/auth/AuthManager.js';
import { AuditLogger } from '../audit.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { SYSTEM_TENANT } from '../config.js';

function tempKeysFile(): string {
  return join(tmpdir(), `aegis-am-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

describe('AuthManager.getMasterToken()', () => {
  it('returns empty string when no master token was configured', () => {
    const auth = new AuthManager(tempKeysFile(), '');
    expect(auth.getMasterToken()).toBe('');
  });

  it('returns the configured master token', () => {
    const auth = new AuthManager(tempKeysFile(), 'my-secret');
    expect(auth.getMasterToken()).toBe('my-secret');
  });
});

describe('AuthManager.getTenantId()', () => {
  let auth: AuthManager;
  let keysFile: string;

  beforeEach(() => {
    keysFile = tempKeysFile();
    auth = new AuthManager(keysFile, '');
  });

  afterEach(async () => {
    try { await rm(keysFile); } catch { /* ignore */ }
  });

  it('returns SYSTEM_TENANT for master keyId', () => {
    expect(auth.getTenantId('master')).toBe(SYSTEM_TENANT);
  });

  it('returns SYSTEM_TENANT for null keyId', () => {
    expect(auth.getTenantId(null)).toBe(SYSTEM_TENANT);
  });

  it('returns SYSTEM_TENANT for undefined keyId', () => {
    expect(auth.getTenantId(undefined)).toBe(SYSTEM_TENANT);
  });

  it('returns SYSTEM_TENANT for admin-role key', async () => {
    const { id } = await auth.createKey('admin-key', 100, undefined, 'admin');
    expect(auth.getTenantId(id)).toBe(SYSTEM_TENANT);
  });

  it('returns the defaultTenantId for viewer-role key without explicit tenantId', async () => {
    const auth2 = new AuthManager(keysFile, '', 'my-tenant');
    const { id } = await auth2.createKey('viewer-key');
    expect(auth2.getTenantId(id)).toBe('my-tenant');
  });

  it('returns undefined for an unknown keyId', () => {
    expect(auth.getTenantId('nonexistent')).toBeUndefined();
  });
});

describe('AuthManager.getKey()', () => {
  let auth: AuthManager;
  let keysFile: string;

  beforeEach(() => {
    keysFile = tempKeysFile();
    auth = new AuthManager(keysFile, '');
  });

  afterEach(async () => {
    try { await rm(keysFile); } catch { /* ignore */ }
  });

  it('returns null for unknown ID', async () => {
    await auth.createKey('some-key');
    expect(auth.getKey('nonexistent')).toBeNull();
  });

  it('returns the ApiKey object (with hash) for a known ID', async () => {
    const { id } = await auth.createKey('my-key');
    const found = auth.getKey(id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(id);
    expect(found!.name).toBe('my-key');
    expect(typeof found!.hash).toBe('string');
  });
});

describe('AuthManager.setQuotas()', () => {
  let auth: AuthManager;
  let keysFile: string;

  beforeEach(() => {
    keysFile = tempKeysFile();
    auth = new AuthManager(keysFile, '');
  });

  afterEach(async () => {
    try { await rm(keysFile); } catch { /* ignore */ }
  });

  it('returns null for unknown key ID', async () => {
    const result = await auth.setQuotas('nonexistent', {
      maxConcurrentSessions: 2,
      maxTokensPerWindow: null,
      maxSpendPerWindow: null,
      quotaWindowMs: 3_600_000,
    });
    expect(result).toBeNull();
  });

  it('sets quotas on a key and returns the updated key (without hash)', async () => {
    const { id } = await auth.createKey('quota-key');
    const quotas = {
      maxConcurrentSessions: 5,
      maxTokensPerWindow: 100_000,
      maxSpendPerWindow: 10.0,
      quotaWindowMs: 3_600_000,
    };
    const updated = await auth.setQuotas(id, quotas);
    expect(updated).not.toBeNull();
    expect(updated!.quotas).toEqual(quotas);
    expect((updated as any).hash).toBeUndefined();
  });

  it('persists quota changes on disk', async () => {
    const { id } = await auth.createKey('persist-quota');
    await auth.setQuotas(id, {
      maxConcurrentSessions: 3,
      maxTokensPerWindow: null,
      maxSpendPerWindow: null,
      quotaWindowMs: 3_600_000,
    });

    const auth2 = new AuthManager(keysFile, '');
    await auth2.load();
    const key = auth2.getKey(id);
    expect(key!.quotas?.maxConcurrentSessions).toBe(3);
  });

  it('fires audit event when audit logger is set', async () => {
    const auditDir = join(tmpdir(), `aegis-audit-${Date.now()}`);
    const audit = new AuditLogger(auditDir);
    await audit.init();
    auth.setAuditLogger(audit);

    const { id } = await auth.createKey('audited-quota');
    await auth.setQuotas(id, {
      maxConcurrentSessions: 1,
      maxTokensPerWindow: null,
      maxSpendPerWindow: null,
      quotaWindowMs: 3_600_000,
    });
    await audit.flush();

    const records = await audit.query({ action: 'key.quotas.update' });
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records[0]!.detail).toContain(id);

    await rm(auditDir, { recursive: true, force: true });
  });
});

describe('AuthManager.rotateKey() (non-grace)', () => {
  let auth: AuthManager;
  let keysFile: string;

  beforeEach(() => {
    keysFile = tempKeysFile();
    auth = new AuthManager(keysFile, '');
  });

  afterEach(async () => {
    try { await rm(keysFile); } catch { /* ignore */ }
  });

  it('returns null for unknown key ID', async () => {
    const result = await auth.rotateKey('nonexistent');
    expect(result).toBeNull();
  });

  it('generates a new key with aegis_ prefix', async () => {
    const { id, key: oldKey } = await auth.createKey('rotate-me');
    const rotated = await auth.rotateKey(id);
    expect(rotated).not.toBeNull();
    expect(rotated!.key).toMatch(/^aegis_[a-f0-9]{64}$/);
    expect(rotated!.key).not.toBe(oldKey);
  });

  it('invalidates the old key after rotation', async () => {
    const { id, key: oldKey } = await auth.createKey('rotate-invalidate');
    await auth.rotateKey(id);
    const result = auth.validate(oldKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid');
  });

  it('activates the new key immediately', async () => {
    const { id } = await auth.createKey('rotate-new-valid');
    const rotated = await auth.rotateKey(id);
    const result = auth.validate(rotated!.key);
    expect(result.valid).toBe(true);
    expect(result.keyId).toBe(id);
  });

  it('preserves the same key ID after rotation', async () => {
    const { id } = await auth.createKey('same-id');
    const rotated = await auth.rotateKey(id);
    expect(rotated!.id).toBe(id);
  });

  it('preserves role and name after rotation', async () => {
    const { id } = await auth.createKey('named-key', 100, undefined, 'operator');
    const rotated = await auth.rotateKey(id);
    expect(rotated!.name).toBe('named-key');
    expect(rotated!.role).toBe('operator');
  });

  it('sets new expiresAt when ttlDays is provided', async () => {
    const { id } = await auth.createKey('with-ttl');
    const rotated = await auth.rotateKey(id, 30);
    expect(rotated!.expiresAt).not.toBeNull();
    expect(rotated!.expiresAt!).toBeGreaterThan(Date.now());
  });

  it('preserves expiresAt null when no ttlDays provided and no original TTL', async () => {
    const { id } = await auth.createKey('no-ttl');
    const rotated = await auth.rotateKey(id);
    expect(rotated!.expiresAt).toBeNull();
  });

  it('clears rate limit bucket on rotation', async () => {
    const { id, key: oldKey } = await auth.createKey('rate-reset', 2);
    // Exhaust rate limit
    auth.validate(oldKey);
    auth.validate(oldKey);
    expect(auth.validate(oldKey).rateLimited).toBe(true);

    const rotated = await auth.rotateKey(id);
    // New key starts fresh
    expect(auth.validate(rotated!.key).rateLimited).toBe(false);
  });

  it('persists the rotated key to disk', async () => {
    const { id } = await auth.createKey('persisted-rotation');
    const rotated = await auth.rotateKey(id);

    const auth2 = new AuthManager(keysFile, '');
    await auth2.load();
    const result = auth2.validate(rotated!.key);
    expect(result.valid).toBe(true);
  });
});

describe('AuthManager.isHealthy()', () => {
  it('returns true when no keys are stored', () => {
    const auth = new AuthManager(tempKeysFile(), '');
    expect(auth.isHealthy()).toBe(true);
  });

  it('returns true when keys exist and keys file exists on disk', async () => {
    const keysFile = tempKeysFile();
    const auth = new AuthManager(keysFile, '');
    await auth.createKey('healthy-key');
    expect(auth.isHealthy()).toBe(true);
    await rm(keysFile, { force: true });
  });

  it('returns false when in-memory keys exist but keys file has been deleted', async () => {
    const keysFile = tempKeysFile();
    const auth = new AuthManager(keysFile, '');
    await auth.createKey('orphaned-key');
    // Delete the file to simulate state dir wipe
    await rm(keysFile, { force: true });
    expect(auth.isHealthy()).toBe(false);
  });
});

describe('AuthManager.createKey() — duplicate name guard (#3073)', () => {
  let auth: AuthManager;
  let keysFile: string;

  beforeEach(() => {
    keysFile = tempKeysFile();
    auth = new AuthManager(keysFile, '');
  });

  afterEach(async () => {
    try { await rm(keysFile); } catch { /* ignore */ }
  });

  it('throws DUPLICATE_KEY_NAME when creating a key with the same name in the same tenant', async () => {
    await auth.createKey('dup-name');
    await expect(auth.createKey('dup-name')).rejects.toMatchObject({
      code: 'DUPLICATE_KEY_NAME',
      statusCode: 409,
    });
  });

  it('allows the same name in different tenants', async () => {
    const auth1 = new AuthManager(keysFile, '', 'tenant-a');
    await auth1.createKey('shared-name');

    // Manually create a key with a different tenantId by using a second instance
    const auth2 = new AuthManager(keysFile, '', 'tenant-b');
    await auth2.load(); // load keys written by auth1
    const result = await auth2.createKey('shared-name');
    expect(result.tenantId).toBe('tenant-b');
  });
});

describe('AuthManager.createKey() — tenant-ID assignment (#2267)', () => {
  let keysFile: string;

  beforeEach(() => {
    keysFile = tempKeysFile();
  });

  afterEach(async () => {
    try { await rm(keysFile); } catch { /* ignore */ }
  });

  it('assigns SYSTEM_TENANT to admin keys regardless of defaultTenantId', async () => {
    const auth = new AuthManager(keysFile, '', 'my-org');
    const result = await auth.createKey('admin-key', 100, undefined, 'admin');
    expect(result.tenantId).toBe(SYSTEM_TENANT);
  });

  it('assigns defaultTenantId to non-admin keys when no explicit tenantId', async () => {
    const auth = new AuthManager(keysFile, '', 'my-org');
    const result = await auth.createKey('viewer-key');
    expect(result.tenantId).toBe('my-org');
  });

  it('assigns explicit tenantId to non-admin keys when provided', async () => {
    const auth = new AuthManager(keysFile, '', 'my-org');
    const result = await auth.createKey('viewer-key', 100, undefined, 'viewer', undefined, 'other-org');
    expect(result.tenantId).toBe('other-org');
  });
});

describe('AuthManager.validate() — tenantId in result (#1944)', () => {
  let auth: AuthManager;
  let keysFile: string;

  beforeEach(() => {
    keysFile = tempKeysFile();
    auth = new AuthManager(keysFile, 'master-secret');
  });

  afterEach(async () => {
    try { await rm(keysFile); } catch { /* ignore */ }
  });

  it('returns SYSTEM_TENANT for master token', () => {
    const result = auth.validate('master-secret');
    expect(result.tenantId).toBe(SYSTEM_TENANT);
  });

  it('returns SYSTEM_TENANT for admin-role API key', async () => {
    const { key } = await auth.createKey('admin-key', 100, undefined, 'admin');
    const result = auth.validate(key);
    expect(result.tenantId).toBe(SYSTEM_TENANT);
  });

  it('returns the key tenantId for non-admin key', async () => {
    const auth2 = new AuthManager(keysFile, '', 'acme-corp');
    const { key } = await auth2.createKey('viewer-key');
    const result = auth2.validate(key);
    expect(result.tenantId).toBe('acme-corp');
  });

  it('returns tenantId even when rate-limited', async () => {
    const { key } = await auth.createKey('rl-key', 1, undefined, 'admin');
    auth.validate(key); // count 1
    const result = auth.validate(key); // count 2 → rate limited
    expect(result.rateLimited).toBe(true);
    expect(result.tenantId).toBe(SYSTEM_TENANT);
  });
});

describe('AuthManager — audit logger wiring', () => {
  let auth: AuthManager;
  let keysFile: string;
  let auditDir: string;
  let audit: AuditLogger;

  beforeEach(async () => {
    keysFile = tempKeysFile();
    auditDir = join(tmpdir(), `aegis-audit-am-${Date.now()}`);
    auth = new AuthManager(keysFile, '');
    audit = new AuditLogger(auditDir);
    await audit.init();
    auth.setAuditLogger(audit);
  });

  afterEach(async () => {
    await Promise.allSettled([
      rm(keysFile, { force: true }),
      rm(auditDir, { recursive: true, force: true }),
    ]);
  });

  it('emits key.create event on createKey()', async () => {
    await auth.createKey('audit-create', 100, undefined, 'operator');
    await audit.flush();
    const records = await audit.query({ action: 'key.create' });
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records[0]!.detail).toContain('audit-create');
  });

  it('emits key.revoke event on revokeKey()', async () => {
    const { id } = await auth.createKey('audit-revoke');
    await auth.revokeKey(id);
    await audit.flush();
    const records = await audit.query({ action: 'key.revoke' });
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records[0]!.detail).toContain('audit-revoke');
  });

  it('emits key.update event on updateKey()', async () => {
    const { id } = await auth.createKey('audit-update');
    await auth.updateKey(id, { name: 'new-name' });
    await audit.flush();
    const records = await audit.query({ action: 'key.update' });
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records[0]!.detail).toContain(id);
  });

  it('emits key.rotate event on rotateKeyWithGrace()', async () => {
    const { id } = await auth.createKey('audit-grace');
    await auth.rotateKeyWithGrace(id, 60);
    await audit.flush();
    const records = await audit.query({ action: 'key.rotate' });
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records[0]!.detail).toContain('audit-grace');
  });
});

describe('AuthManager.checkBatchRateLimit()', () => {
  let auth: AuthManager;
  let keysFile: string;

  beforeEach(() => {
    keysFile = tempKeysFile();
    auth = new AuthManager(keysFile, '');
  });

  afterEach(async () => {
    vi.useRealTimers();
    try { await rm(keysFile); } catch { /* ignore */ }
  });

  it('allows first batch request for a key', () => {
    expect(auth.checkBatchRateLimit('key-1')).toBe(false);
  });

  it('rate-limits second immediate request for the same key', () => {
    auth.checkBatchRateLimit('key-2');
    expect(auth.checkBatchRateLimit('key-2')).toBe(true);
  });

  it('uses "anonymous" for null keyId', () => {
    expect(auth.checkBatchRateLimit(null)).toBe(false);
    expect(auth.checkBatchRateLimit(null)).toBe(true);
  });

  it('tracks limits independently per key', () => {
    auth.checkBatchRateLimit('key-a');
    expect(auth.checkBatchRateLimit('key-b')).toBe(false);
  });

  it('allows again after the 5-second cooldown expires', async () => {
    auth.checkBatchRateLimit('key-cooldown');

    vi.useFakeTimers();
    vi.advanceTimersByTime(5_001);

    await auth.sweepStaleRateLimits();
    expect(auth.checkBatchRateLimit('key-cooldown')).toBe(false);
  });
});

describe('AuthManager — sweepStaleRateLimits() lastUsedAt persistence (#2534)', () => {
  let keysFile: string;

  beforeEach(() => {
    keysFile = tempKeysFile();
  });

  afterEach(async () => {
    vi.useRealTimers();
    try { await rm(keysFile); } catch { /* ignore */ }
  });

  it('saves lastUsedAt to disk when dirty flag is set by validate()', async () => {
    const auth = new AuthManager(keysFile, '');
    const { key, id } = await auth.createKey('persist-lastusedat');

    // Validate to set dirty flag
    auth.validate(key);

    // Sweep should persist
    await auth.sweepStaleRateLimits();

    // Reload and verify lastUsedAt was persisted
    const auth2 = new AuthManager(keysFile, '');
    await auth2.load();
    const stored = auth2.getKey(id);
    expect(stored!.lastUsedAt).toBeGreaterThan(0);
  });
});
