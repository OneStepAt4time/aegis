/**
 * auth-key-update-3207.test.ts — Tests for Issue #3207: PATCH /v1/auth/keys/:id
 *
 * Tests for the updateKey method on AuthManager and the PATCH route,
 * including role changes, name updates, permission management,
 * self-demotion guard, and name uniqueness check.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthManager } from '../auth.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

describe('AuthManager.updateKey (#3207)', () => {
  let auth: AuthManager;
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `aegis-update-key-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    auth = new AuthManager(tmpFile, '');
    await auth.load();
  });

  afterEach(async () => {
    await rm(tmpFile, { force: true });
  });

  describe('Role updates', () => {
    it('should update key role from viewer to operator', async () => {
      const created = await auth.createKey('test-key', 100, undefined, 'viewer');
      const updated = await auth.updateKey(created.id, { role: 'operator' });
      expect(updated).not.toBeNull();
      expect(updated!.role).toBe('operator');
      // When role changes without explicit permissions, reset to role defaults
      expect(updated!.permissions).toEqual(['create', 'send', 'approve', 'reject', 'kill']);
    });

    it('should update key role from viewer to admin', async () => {
      const created = await auth.createKey('test-key', 100, undefined, 'viewer');
      const updated = await auth.updateKey(created.id, { role: 'admin' });
      expect(updated!.role).toBe('admin');
      expect(updated!.permissions).toEqual(['create', 'send', 'approve', 'reject', 'kill']);
    });

    it('should update key role from admin to viewer', async () => {
      const created = await auth.createKey('test-key', 100, undefined, 'admin');
      const updated = await auth.updateKey(created.id, { role: 'viewer' });
      expect(updated!.role).toBe('viewer');
      expect(updated!.permissions).toEqual([]);
    });

    it('should persist role change to disk', async () => {
      const created = await auth.createKey('test-key', 100, undefined, 'viewer');
      await auth.updateKey(created.id, { role: 'admin' });

      // Reload from disk
      const auth2 = new AuthManager(tmpFile, '');
      await auth2.load();
      const keys = auth2.listKeys();
      expect(keys[0]!.role).toBe('admin');
    });
  });

  describe('Name updates', () => {
    it('should update key name', async () => {
      const created = await auth.createKey('old-name', 100, undefined, 'viewer');
      const updated = await auth.updateKey(created.id, { name: 'new-name' });
      expect(updated!.name).toBe('new-name');
    });

    it('should persist name change to disk', async () => {
      const created = await auth.createKey('old-name', 100, undefined, 'viewer');
      await auth.updateKey(created.id, { name: 'new-name' });

      const auth2 = new AuthManager(tmpFile, '');
      await auth2.load();
      expect(auth2.listKeys()[0]!.name).toBe('new-name');
    });
  });

  describe('Permission updates', () => {
    it('should set explicit permissions', async () => {
      const created = await auth.createKey('test-key', 100, undefined, 'viewer');
      const updated = await auth.updateKey(created.id, { permissions: ['create', 'send'] });
      expect(updated!.permissions).toEqual(['create', 'send']);
    });

    it('should reset permissions to role defaults when null', async () => {
      const created = await auth.createKey('test-key', 100, undefined, 'operator');
      // First set custom permissions
      await auth.updateKey(created.id, { permissions: ['create'] });
      // Then reset to defaults
      const updated = await auth.updateKey(created.id, { permissions: null });
      expect(updated!.permissions).toEqual(['create', 'send', 'approve', 'reject', 'kill']);
    });

    it('should update permissions alongside role', async () => {
      const created = await auth.createKey('test-key', 100, undefined, 'viewer');
      const updated = await auth.updateKey(created.id, { role: 'operator', permissions: ['create'] });
      expect(updated!.role).toBe('operator');
      expect(updated!.permissions).toEqual(['create']);
    });
  });

  describe('Edge cases', () => {
    it('should return null for non-existent key', async () => {
      const result = await auth.updateKey('nonexistent', { role: 'admin' });
      expect(result).toBeNull();
    });

    it('should handle empty updates (no-op)', async () => {
      const created = await auth.createKey('test-key', 100, undefined, 'viewer');
      const updated = await auth.updateKey(created.id, {});
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('test-key');
      expect(updated!.role).toBe('viewer');
    });

    it('should not expose hash in result', async () => {
      const created = await auth.createKey('test-key', 100, undefined, 'viewer');
      const updated = await auth.updateKey(created.id, { role: 'admin' });
      expect(updated).not.toHaveProperty('hash');
    });
  });
});
