/**
 * auth-rbac.test.ts — Tests for Issue #1432: API key roles RBAC.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthManager, type ApiKeyRole } from '../auth.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

describe('API Key RBAC (Issue #1432)', () => {
  let auth: AuthManager;
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `aegis-rbac-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    auth = new AuthManager(tmpFile, '');
    await auth.load();
  });

  afterEach(async () => {
    try { await rm(tmpFile); } catch { /* ignore */ }
  });

  // ── Role assignment on key creation ────────────────────────────────────────

  describe('Key creation with roles', () => {
    it('should default to viewer role when no role specified', async () => {
      const result = await auth.createKey('viewer-key');
      expect(result.role).toBe('viewer');
    });

    it('should create a key with admin role', async () => {
      const result = await auth.createKey('admin-key', 100, undefined, 'admin');
      expect(result.role).toBe('admin');
    });

    it('should create a key with operator role', async () => {
      const result = await auth.createKey('operator-key', 100, undefined, 'operator');
      expect(result.role).toBe('operator');
    });

    it('should persist role in the store', async () => {
      await auth.createKey('admin-key', 100, undefined, 'admin');
      await auth.createKey('viewer-key', 100, undefined, 'viewer');
      const keys = auth.listKeys();
      const admin = keys.find(k => k.name === 'admin-key');
      const viewer = keys.find(k => k.name === 'viewer-key');
      expect(admin?.role).toBe('admin');
      expect(viewer?.role).toBe('viewer');
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
});
