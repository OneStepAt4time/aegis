/**
 * auth-key-rotation-grace-2097.test.ts — Tests for Issue #2097: API key rotation with grace period.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthManager } from '../auth.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm, readFile } from 'node:fs/promises';

describe('API key rotation with grace period (Issue #2097)', () => {
  let auth: AuthManager;
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `aegis-2097-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    auth = new AuthManager(tmpFile, '');
  });

  afterEach(async () => {
    vi.useRealTimers();
    try { await rm(tmpFile); } catch { /* ignore */ }
  });

  describe('rotateKeyWithGrace()', () => {
    it('should return new key with graceExpiresAt', async () => {
      const { id, key: oldKey } = await auth.createKey('grace-key');
      const rotated = await auth.rotateKeyWithGrace(id, 3600);
      expect(rotated).not.toBeNull();
      expect(rotated!.key).not.toBe(oldKey);
      expect(rotated!.key).toMatch(/^aegis_[a-f0-9]{64}$/);
      expect(rotated!.id).toBe(id);
      expect(rotated!.name).toBe('grace-key');
      expect(rotated!.graceExpiresAt).toBeGreaterThan(Date.now());
    });

    it('should allow both old and new keys during grace period', async () => {
      const { id, key: oldKey } = await auth.createKey('both-work');
      const rotated = await auth.rotateKeyWithGrace(id, 3600);

      // New key works
      expect(auth.validate(rotated!.key).valid).toBe(true);
      // Old key also works during grace
      expect(auth.validate(oldKey).valid).toBe(true);
    });

    it('should reject old key after grace period expires', async () => {
      vi.useFakeTimers({ now: Date.now() });

      const { id, key: oldKey } = await auth.createKey('expires-grace');
      const rotated = await auth.rotateKeyWithGrace(id, 60); // 60 second grace

      // Both work during grace
      expect(auth.validate(rotated!.key).valid).toBe(true);
      expect(auth.validate(oldKey).valid).toBe(true);

      // Advance past grace period
      vi.advanceTimersByTime(61_000);

      // New key still works
      expect(auth.validate(rotated!.key).valid).toBe(true);
      // Old key is rejected
      expect(auth.validate(oldKey).valid).toBe(false);
      expect(auth.validate(oldKey).reason).toBe('invalid');

      vi.useRealTimers();
    });

    it('should return null for non-existent key', async () => {
      const result = await auth.rotateKeyWithGrace('nonexistent', 3600);
      expect(result).toBeNull();
    });

    it('should use default grace period of 3600 seconds', async () => {
      const before = Date.now();
      const { id } = await auth.createKey('default-grace');
      const rotated = await auth.rotateKeyWithGrace(id);
      expect(rotated).not.toBeNull();
      // Grace period should be approximately 3600 seconds from now
      const expectedGrace = before + 3600 * 1000;
      expect(rotated!.graceExpiresAt).toBeGreaterThanOrEqual(expectedGrace - 1000);
      expect(rotated!.graceExpiresAt).toBeLessThanOrEqual(expectedGrace + 1000);
    });

    it('should set new expiresAt when ttlDays is provided', async () => {
      const { id } = await auth.createKey('ttl-rotate');
      const rotated = await auth.rotateKeyWithGrace(id, 60, 30);
      expect(rotated).not.toBeNull();
      expect(rotated!.expiresAt).not.toBeNull();
      expect(rotated!.expiresAt!).toBeGreaterThan(Date.now());
    });

    it('should preserve existing expiresAt when ttlDays is omitted', async () => {
      const { id } = await auth.createKey('keep-ttl', 100, 90);
      const rotated = await auth.rotateKeyWithGrace(id, 60);
      expect(rotated).not.toBeNull();
      expect(rotated!.expiresAt).not.toBeNull();
    });

    it('should preserve role and permissions', async () => {
      const { id } = await auth.createKey('role-key', 100, undefined, 'admin');
      const rotated = await auth.rotateKeyWithGrace(id, 60);
      expect(rotated!.role).toBe('admin');
    });
  });

  describe('grace key persistence', () => {
    it('should persist grace keys to disk', async () => {
      const { id, key: oldKey } = await auth.createKey('persist-grace');
      await auth.rotateKeyWithGrace(id, 3600);

      // Read raw file and verify graceKeys array
      const raw = await readFile(tmpFile, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.graceKeys).toHaveLength(1);
      expect(parsed.graceKeys[0].keyId).toBe(id);
    });

    it('should load grace keys from disk on restart', async () => {
      const { id, key: oldKey } = await auth.createKey('reload-grace');
      const rotated = await auth.rotateKeyWithGrace(id, 3600);

      // Reload from disk
      const auth2 = new AuthManager(tmpFile, '');
      await auth2.load();

      // New key works
      expect(auth2.validate(rotated!.key).valid).toBe(true);
      // Old key works (grace period still active)
      expect(auth2.validate(oldKey).valid).toBe(true);
    });

    it('should not load expired grace keys from disk', async () => {
      vi.useFakeTimers({ now: Date.now() });

      const { id, key: oldKey } = await auth.createKey('expired-grace');
      await auth.rotateKeyWithGrace(id, 10); // 10 second grace

      // Advance past grace
      vi.advanceTimersByTime(11_000);

      // Reload from disk — expired grace keys should be pruned
      const auth2 = new AuthManager(tmpFile, '');
      await auth2.load();

      expect(auth2.validate(oldKey).valid).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('grace key rate limiting', () => {
    it('should apply rate limiting to old key during grace period', async () => {
      const { id, key: oldKey } = await auth.createKey('rate-grace', 2);
      const rotated = await auth.rotateKeyWithGrace(id, 3600);

      // Exhaust rate limit via old key
      auth.validate(oldKey);
      auth.validate(oldKey);

      // Both old and new should be rate-limited (shared key ID bucket)
      expect(auth.validate(oldKey).rateLimited).toBe(true);
      expect(auth.validate(rotated!.key).rateLimited).toBe(true);
    });
  });

  describe('grace key revocation (#2446)', () => {
    it('should immediately invalidate grace keys when key is revoked', async () => {
      // Create a second key so store isn't empty after revocation
      // (empty store + no master token = allow-all mode)
      await auth.createKey('bystander');
      const { id, key: oldKey } = await auth.createKey('revoke-grace');
      const rotated = await auth.rotateKeyWithGrace(id, 3600);

      // Old (grace) key works before revocation
      expect(auth.validate(oldKey).valid).toBe(true);

      // Revoke the key
      const revoked = await auth.revokeKey(id);
      expect(revoked).toBe(true);

      // Old (grace) key must no longer authenticate
      expect(auth.validate(oldKey).valid).toBe(false);
      // New key also no longer valid (key removed)
      expect(auth.validate(rotated!.key).valid).toBe(false);
    });

    it('should not affect grace keys belonging to other keys', async () => {
      const { id: id1, key: oldKey1 } = await auth.createKey('keep-grace');
      const { id: id2, key: oldKey2 } = await auth.createKey('revoke-this');
      const rotated1 = await auth.rotateKeyWithGrace(id1, 3600);
      const rotated2 = await auth.rotateKeyWithGrace(id2, 3600);

      // Revoke key2
      await auth.revokeKey(id2);

      // Key1's grace key still works
      expect(auth.validate(oldKey1).valid).toBe(true);
      expect(auth.validate(rotated1!.key).valid).toBe(true);
      // Key2 is fully gone
      expect(auth.validate(oldKey2).valid).toBe(false);
      expect(auth.validate(rotated2!.key).valid).toBe(false);
    });
  });

  describe('sweepStaleGraceKeys()', () => {
    it('should remove expired grace keys', async () => {
      vi.useFakeTimers({ now: Date.now() });

      const { id, key: oldKey } = await auth.createKey('sweep-grace');
      await auth.rotateKeyWithGrace(id, 5); // 5 second grace

      // Advance past grace
      vi.advanceTimersByTime(6_000);

      // Old key should no longer validate
      expect(auth.validate(oldKey).valid).toBe(false);

      vi.useRealTimers();
    });
  });
});
