/**
 * auth-rbac.test.ts — Tests for Issue #1432: API key roles RBAC.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthManager, type ApiKeyRole } from '../auth.js';
import { AuditLogger } from '../audit.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile, rm, writeFile } from 'node:fs/promises';

describe('API Key RBAC (Issue #1432)', () => {
  let auth: AuthManager;
  let tmpFile: string;
  let auditDir: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `aegis-rbac-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    auditDir = join(tmpdir(), `aegis-rbac-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    auth = new AuthManager(tmpFile, '');
    await auth.load();
  });

  afterEach(async () => {
    await Promise.allSettled([
      rm(tmpFile, { force: true }),
      rm(auditDir, { recursive: true, force: true }),
    ]);
  });

  // ── Role assignment on key creation ────────────────────────────────────────

  describe('Key creation with roles', () => {
    it('should default to viewer role when no role specified', async () => {
      const result = await auth.createKey('viewer-key');
      expect(result.role).toBe('viewer');
      expect(result.permissions).toEqual(['create']);
    });

    it('should create a key with admin role', async () => {
      const result = await auth.createKey('admin-key', 100, undefined, 'admin');
      expect(result.role).toBe('admin');
      expect(result.permissions).toEqual(['create', 'send', 'approve', 'reject', 'kill']);
    });

    it('should create a key with operator role', async () => {
      const result = await auth.createKey('operator-key', 100, undefined, 'operator');
      expect(result.role).toBe('operator');
      expect(result.permissions).toEqual(['create', 'send', 'approve', 'reject', 'kill']);
    });

    it('should persist role in the store', async () => {
      await auth.createKey('admin-key', 100, undefined, 'admin');
      await auth.createKey('viewer-key', 100, undefined, 'viewer');
      const keys = auth.listKeys();
      const admin = keys.find(k => k.name === 'admin-key');
      const viewer = keys.find(k => k.name === 'viewer-key');
      expect(admin?.role).toBe('admin');
      expect(viewer?.role).toBe('viewer');
      expect(admin?.permissions).toEqual(['create', 'send', 'approve', 'reject', 'kill']);
      expect(viewer?.permissions).toEqual(['create']);
    });

    it('supports custom permissions independent of role defaults', async () => {
      const result = await auth.createKey('approver-key', 100, undefined, 'operator', ['approve']);
      expect(result.role).toBe('operator');
      expect(result.permissions).toEqual(['approve']);
    });

    it('records permission policy without raw permission labels in audit detail', async () => {
      const audit = new AuditLogger(auditDir);
      await audit.init();
      auth.setAuditLogger(audit);

      await auth.createKey('custom-key', 100, undefined, 'operator', ['approve']);
      await audit.flush();

      const records = await audit.query({ action: 'key.create' });
      expect(records).toHaveLength(1);
      expect(records[0]!.detail).toContain('permissionPolicy=custom');
      expect(records[0]!.detail).not.toContain('approve');
    });
  });

  // ── Role retrieval ──────────────────────────────────────────────────────────

  describe('getRole()', () => {
    it('should return admin for master token', () => {
      const masterAuth = new AuthManager(tmpFile, 'master-secret');
      expect(masterAuth.getRole('master')).toBe('admin');
    });

    it('should return viewer for null/undefined keyId', () => {
      expect(auth.getRole(null)).toBe('viewer');
      expect(auth.getRole(undefined)).toBe('viewer');
      expect(auth.getRole('unknown-id')).toBe('viewer');
    });

    it('should return the correct role for a valid key', async () => {
      const { id } = await auth.createKey('op-key', 100, undefined, 'operator');
      expect(auth.getRole(id)).toBe('operator');
    });
  });

  describe('getPermissions()/hasPermission()', () => {
    it('returns all canonical permissions for the master token', () => {
      const masterAuth = new AuthManager(tmpFile, 'master-secret');
      expect(masterAuth.getPermissions('master')).toEqual(['create', 'send', 'approve', 'reject', 'kill']);
      expect(masterAuth.hasPermission('master', 'kill')).toBe(true);
    });

    it('returns the stored permissions for a key', async () => {
      const { id } = await auth.createKey('approve-only', 100, undefined, 'viewer', ['approve']);
      expect(auth.getPermissions(id)).toEqual(['approve']);
      expect(auth.hasPermission(id, 'approve')).toBe(true);
      expect(auth.hasPermission(id, 'kill')).toBe(false);
    });

    it('allows all permissions when auth is disabled', () => {
      expect(auth.authEnabled).toBe(false);
      expect(auth.getPermissions(null)).toEqual(['create', 'send', 'approve', 'reject', 'kill']);
      expect(auth.hasPermission(null, 'send')).toBe(true);
    });
  });

  describe('legacy permission migration', () => {
    it('derives and persists permissions from role for legacy keys', async () => {
      await writeFile(tmpFile, JSON.stringify({
        keys: [
          {
            id: 'legacy-operator',
            name: 'legacy-op',
            hash: 'hash-1',
            createdAt: Date.now(),
            lastUsedAt: 0,
            rateLimit: 100,
            expiresAt: null,
            role: 'operator',
          },
        ],
      }));

      const migrated = new AuthManager(tmpFile, '');
      await migrated.load();

      expect(migrated.listKeys()[0]?.permissions).toEqual(['create', 'send', 'approve', 'reject', 'kill']);

      const persisted = JSON.parse(await readFile(tmpFile, 'utf-8')) as {
        keys: Array<{ permissions?: string[] }>;
      };
      expect(persisted.keys[0]?.permissions).toEqual(['create', 'send', 'approve', 'reject', 'kill']);
    });
  });

  describe('auth key route guard policy', () => {
    function canListAuthKeys(role: ApiKeyRole): boolean {
      return role === 'admin';
    }

    it('allows admin role to list keys', () => {
      expect(canListAuthKeys('admin')).toBe(true);
    });

    it('rejects operator/viewer roles from listing keys', () => {
      expect(canListAuthKeys('operator')).toBe(false);
      expect(canListAuthKeys('viewer')).toBe(false);
    });
  });
});
