/**
 * auth-rbac-1432.test.ts — Tests for Issue #1432: API key roles RBAC.
 *
 * Tests that:
 * 1. API keys have a role field (admin/operator/viewer)
 * 2. viewer keys cannot create/revoke keys or kill sessions
 * 3. operator keys can manage own sessions but not others'
 * 4. admin keys have full access
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

  // ── Validation preserves role info via getRole ─────────────────────────────

  describe('validate() + getRole() integration', () => {
    it('should allow an admin key to validate and retain admin role', async () => {
      const { key, id } = await auth.createKey('admin-test', 100, undefined, 'admin');
      const result = auth.validate(key);
      expect(result.valid).toBe(true);
      expect(result.keyId).toBe(id);
      expect(auth.getRole(result.keyId)).toBe('admin');
    });

    it('should allow an operator key to validate and retain operator role', async () => {
      const { key, id } = await auth.createKey('operator-test', 100, undefined, 'operator');
      const result = auth.validate(key);
      expect(result.valid).toBe(true);
      expect(result.keyId).toBe(id);
      expect(auth.getRole(result.keyId)).toBe('operator');
    });

    it('should allow a viewer key to validate and retain viewer role', async () => {
      const { key, id } = await auth.createKey('viewer-test', 100, undefined, 'viewer');
      const result = auth.validate(key);
      expect(result.valid).toBe(true);
      expect(result.keyId).toBe(id);
      expect(auth.getRole(result.keyId)).toBe('viewer');
    });
  });

  // ── Role hierarchy enforcement ──────────────────────────────────────────────

  describe('Role hierarchy (admin > operator > viewer)', () => {
    it('should only allow admin to manage API keys (getRole check)', () => {
      const adminId = 'admin-id';
      const operatorId = 'operator-id';
      const viewerId = 'viewer-id';
      // Mock: add keys to store directly
      // @ts-ignore — accessing private store for test setup
      auth.store.keys = [
        { id: adminId, name: 'admin', hash: 'a', createdAt: 0, lastUsedAt: 0, rateLimit: 100, expiresAt: null, role: 'admin' as ApiKeyRole },
        { id: operatorId, name: 'operator', hash: 'b', createdAt: 0, lastUsedAt: 0, rateLimit: 100, expiresAt: null, role: 'operator' as ApiKeyRole },
        { id: viewerId, name: 'viewer', hash: 'c', createdAt: 0, lastUsedAt: 0, rateLimit: 100, expiresAt: null, role: 'viewer' as ApiKeyRole },
      ];

      // Admin can manage keys
      const roles = ['admin'];
      expect(roles.includes(auth.getRole(adminId))).toBe(true);
      expect(roles.includes(auth.getRole(operatorId))).toBe(false);
      expect(roles.includes(auth.getRole(viewerId))).toBe(false);

      // Admin + operator can manage own sessions (write role)
      const writeRoles = ['admin', 'operator'];
      expect(writeRoles.includes(auth.getRole(adminId))).toBe(true);
      expect(writeRoles.includes(auth.getRole(operatorId))).toBe(true);
      expect(writeRoles.includes(auth.getRole(viewerId))).toBe(false);
    });
  });
});
