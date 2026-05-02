/**
 * multi-tenancy-1944.test.ts — Tests for Issue #1944: tenant scoping.
 *
 * Updated for Issue #2267: tenant isolation model changes.
 * - Admin/master keys now get SYSTEM_TENANT instead of undefined
 * - Non-admin keys without tenantId now get 'default' instead of undefined
 * - Legacy sessions (no tenantId) are only visible to SYSTEM_TENANT callers
 *
 * Covers:
 *  - tenantId on API keys, sessions, audit records
 *  - Session listing filtered by tenant
 *  - Audit queries filtered by tenant
 *  - Admin/master bypass tenant scoping (via SYSTEM_TENANT)
 *  - Config defaultTenantId
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthManager } from '../auth.js';
import { SYSTEM_TENANT } from '../config.js';
import { AuditLogger } from '../audit.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm, mkdir } from 'node:fs/promises';
import { getConfig } from '../config.js';

describe('Multi-tenancy (Issue #1944)', () => {
  let auth: AuthManager;
  let tmpFile: string;
  let auditDir: string;
  let audit: AuditLogger;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `aegis-keys-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    auditDir = join(tmpdir(), `aegis-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(auditDir, { recursive: true });
    auth = new AuthManager(tmpFile, 'master-token');
    auth.setHost('127.0.0.1');
    audit = new AuditLogger(auditDir);
    await audit.init();
  });

  afterEach(async () => {
    try { await rm(tmpFile); } catch { /* ignore */ }
    try { await rm(auditDir, { recursive: true }); } catch { /* ignore */ }
  });

  // ── API Key tenantId ──────────────────────────────────────────────────

  describe('ApiKey tenantId', () => {
    it('should create a key with tenantId', async () => {
      const result = await auth.createKey('tenant-a-key', 100, undefined, 'operator', undefined, 'tenant-a');
      expect(result.tenantId).toBe('tenant-a');
      expect(result.key).toMatch(/^aegis_/);
    });

    it('should create a key without tenantId (backward compat)', async () => {
      const result = await auth.createKey('legacy-key');
      // Issue #2267: non-admin keys without tenantId now get 'default'
      expect(result.tenantId).toBe('default');
    });

    it('should return tenantId from validate() for tenant-scoped key', async () => {
      const { key } = await auth.createKey('tenant-key', 100, undefined, 'operator', undefined, 'tenant-b');
      const result = auth.validate(key);
      expect(result.valid).toBe(true);
      expect(result.tenantId).toBe('tenant-b');
    });

    it('should return default tenantId for key without tenant', async () => {
      const { key } = await auth.createKey('no-tenant-key');
      const result = auth.validate(key);
      expect(result.valid).toBe(true);
      // Issue #2267: non-admin keys without tenantId now get 'default'
      expect(result.tenantId).toBe('default');
    });

    it('should return SYSTEM_TENANT for master token', () => {
      const result = auth.validate('master-token');
      expect(result.valid).toBe(true);
      // Issue #2267: master token now gets SYSTEM_TENANT
      expect(result.tenantId).toBe(SYSTEM_TENANT);
    });
  });

  // ── AuthManager.getTenantId ───────────────────────────────────────────

  describe('AuthManager.getTenantId', () => {
    it('returns tenantId for a tenant-scoped key', async () => {
      const { id } = await auth.createKey('scoped', 100, undefined, 'operator', undefined, 'tenant-x');
      expect(auth.getTenantId(id)).toBe('tenant-x');
    });

    it('returns SYSTEM_TENANT for admin role (bypass)', async () => {
      const { id } = await auth.createKey('admin-key', 100, undefined, 'admin', undefined, 'tenant-y');
      // Issue #2267: admin keys now get SYSTEM_TENANT
      expect(auth.getTenantId(id)).toBe(SYSTEM_TENANT);
    });

    it('returns SYSTEM_TENANT for master', () => {
      // Issue #2267: master now gets SYSTEM_TENANT
      expect(auth.getTenantId('master')).toBe(SYSTEM_TENANT);
    });

    it('returns SYSTEM_TENANT for null/undefined keyId', () => {
      // Issue #2267: null/undefined keyId now gets SYSTEM_TENANT
      expect(auth.getTenantId(null)).toBe(SYSTEM_TENANT);
      expect(auth.getTenantId(undefined)).toBe(SYSTEM_TENANT);
    });

    it('returns undefined for unknown key', () => {
      // Unknown keys are not found in the store, so they return undefined
      expect(auth.getTenantId('nonexistent')).toBeUndefined();
    });

    it('returns default for key without tenantId', async () => {
      const { id } = await auth.createKey('no-tenant');
      // Issue #2267: non-admin keys without tenantId now get 'default'
      expect(auth.getTenantId(id)).toBe('default');
    });
  });

  // ── Audit tenantId ───────────────────────────────────────────────────

  describe('AuditRecord tenantId', () => {
    it('should store tenantId in audit records', async () => {
      await audit.log('key:bot', 'session.create', 'Created session', 'sess-1', 'tenant-a');
      const records = await audit.queryAll({});
      expect(records).toHaveLength(1);
      expect(records[0]!.tenantId).toBe('tenant-a');
    });

    it('should filter audit records by tenantId', async () => {
      await audit.log('key:bot-a', 'session.create', 'Session A', 'sess-1', 'tenant-a');
      await audit.log('key:bot-b', 'session.create', 'Session B', 'sess-2', 'tenant-b');
      await audit.log('key:bot-a', 'session.create', 'Session A2', 'sess-3', 'tenant-a');

      const tenantA = await audit.queryAll({ tenantId: 'tenant-a' });
      expect(tenantA).toHaveLength(2);

      const tenantB = await audit.queryAll({ tenantId: 'tenant-b' });
      expect(tenantB).toHaveLength(1);
    });

    it('should return all records when tenantId filter not set', async () => {
      await audit.log('key:bot-a', 'session.create', 'Session A', 'sess-1', 'tenant-a');
      await audit.log('key:bot-b', 'session.create', 'Session B', 'sess-2', 'tenant-b');

      const all = await audit.queryAll({});
      expect(all).toHaveLength(2);
    });

    it('should not match records with different tenantId', async () => {
      await audit.log('key:bot', 'session.create', 'Session', 'sess-1', 'tenant-a');
      const records = await audit.queryAll({ tenantId: 'tenant-b' });
      expect(records).toHaveLength(0);
    });

    it('should include records without tenantId when filtering by tenant', async () => {
      await audit.log('key:legacy', 'session.create', 'Legacy session', 'sess-old');
      await audit.log('key:bot-a', 'session.create', 'New session', 'sess-1', 'tenant-a');

      // Filtering by 'tenant-a' should NOT include records without tenantId
      const filtered = await audit.queryAll({ tenantId: 'tenant-a' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.sessionId).toBe('sess-1');
    });
  });

  // ── Tenant filtering helper ──────────────────────────────────────────

  describe('Tenant scoping on session-like objects', () => {
    // Simulate the filterByTenant logic used in routes (Issue #2267 updated)
    function filterByTenant<T extends { tenantId?: string }>(items: T[], callerTenantId: string | undefined): T[] {
      if (callerTenantId === SYSTEM_TENANT) return items;
      if (callerTenantId === undefined) return [];
      return items.filter(item => item.tenantId === callerTenantId);
    }

    const sessions = [
      { id: '1', tenantId: 'tenant-a' },
      { id: '2', tenantId: 'tenant-b' },
      { id: '3' }, // no tenantId (legacy)
      { id: '4', tenantId: 'tenant-a' },
    ];

    it('admin/master (SYSTEM_TENANT) sees all sessions', () => {
      expect(filterByTenant(sessions, SYSTEM_TENANT)).toHaveLength(4);
    });

    it('undefined caller sees nothing (deny-by-default per #2267)', () => {
      expect(filterByTenant(sessions, undefined)).toHaveLength(0);
    });

    it('tenant-a caller sees only tenant-a sessions (legacy excluded per #2267)', () => {
      const filtered = filterByTenant(sessions, 'tenant-a');
      expect(filtered).toHaveLength(2);
      expect(filtered.map(s => s.id).sort()).toEqual(['1', '4']);
    });

    it('tenant-b caller sees only tenant-b sessions (legacy excluded per #2267)', () => {
      const filtered = filterByTenant(sessions, 'tenant-b');
      expect(filtered).toHaveLength(1);
      expect(filtered.map(s => s.id).sort()).toEqual(['2']);
    });

    it('unknown tenant sees no sessions (legacy excluded per #2267)', () => {
      const filtered = filterByTenant(sessions, 'tenant-c');
      expect(filtered).toHaveLength(0);
    });

    it('empty array works correctly', () => {
      expect(filterByTenant([], 'tenant-a')).toHaveLength(0);
      expect(filterByTenant([], undefined)).toHaveLength(0);
    });
  });

  // ── Config defaultTenantId ───────────────────────────────────────────

  describe('Config defaultTenantId', () => {
    it('defaults to "default"', () => {
      const config = getConfig();
      expect(config.defaultTenantId).toBe('default');
    });

    it('reads from AEGIS_DEFAULT_TENANT_ID env var', () => {
      const original = process.env.AEGIS_DEFAULT_TENANT_ID;
      process.env.AEGIS_DEFAULT_TENANT_ID = 'my-tenant';
      try {
        const config = getConfig();
        expect(config.defaultTenantId).toBe('my-tenant');
      } finally {
        if (original === undefined) {
          delete process.env.AEGIS_DEFAULT_TENANT_ID;
        } else {
          process.env.AEGIS_DEFAULT_TENANT_ID = original;
        }
      }
    });
  });

  // ── Grace key tenantId ───────────────────────────────────────────────

  describe('Grace key rotation preserves tenantId', () => {
    it('returns tenantId from grace key validation', async () => {
      const { id, key: oldKey } = await auth.createKey('tenant-key', 100, undefined, 'operator', undefined, 'tenant-grace');
      const rotated = await auth.rotateKeyWithGrace(id, 3600);
      expect(rotated).toBeTruthy();

      // Old key should still validate and return the original tenantId
      const result = auth.validate(oldKey);
      expect(result.valid).toBe(true);
      expect(result.tenantId).toBe('tenant-grace');
    });
  });
});
