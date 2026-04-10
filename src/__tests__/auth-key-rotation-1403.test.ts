/**
 * auth-key-rotation-1403.test.ts — Tests for Issue #1403: API key expiry + rotation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthManager, type AuthRejectReason } from '../auth.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

describe('API key expiry and rotation (Issue #1403)', () => {
  let auth: AuthManager;
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `aegis-1403-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    auth = new AuthManager(tmpFile, '');
  });

  afterEach(async () => {
    try { await rm(tmpFile); } catch { /* ignore */ }
  });

  describe('validate() reason field', () => {
    it('should return reason="expired" for an expired key', async () => {
      const { key } = await auth.createKey('expiring', 100, 1);
      const stored = (auth as unknown as { store: { keys: Array<{ expiresAt: number }> } }).store.keys[0];
      stored.expiresAt = Date.now() - 1000;
      const result = auth.validate(key);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
    });

    it('should return reason="invalid" for a wrong key', async () => {
      await auth.createKey('my-key');
      const result = auth.validate('aegis_deadbeef');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid');
    });

    it('should return reason="no_auth" when no auth configured on non-localhost', () => {
      const noAuth = new AuthManager(tmpFile, '');
      noAuth.setHost('0.0.0.0');
      const result = noAuth.validate('anything');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('no_auth');
    });

    it('should not set reason when valid', async () => {
      const { key } = await auth.createKey('valid-key');
      const result = auth.validate(key);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should not set reason when no auth on localhost', () => {
      const noAuth = new AuthManager(tmpFile, '');
      const result = noAuth.validate('anything');
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('rotateKey()', () => {
    it('should rotate an existing key and return the new plaintext', async () => {
      const { id, key: oldKey } = await auth.createKey('rotate-me');
      const rotated = await auth.rotateKey(id);
      expect(rotated).not.toBeNull();
      expect(rotated!.key).not.toBe(oldKey);
      expect(rotated!.key).toMatch(/^aegis_[a-f0-9]{64}$/);
      expect(rotated!.id).toBe(id);
      expect(rotated!.name).toBe('rotate-me');
    });

    it('should invalidate the old key after rotation', async () => {
      const { id, key: oldKey } = await auth.createKey('rotate-me');
      const rotated = await auth.rotateKey(id);
      // Old key must no longer validate
      expect(auth.validate(oldKey).valid).toBe(false);
      // New key must validate
      expect(auth.validate(rotated!.key).valid).toBe(true);
    });

    it('should preserve role from original key', async () => {
      const { id } = await auth.createKey('admin-key', 100, undefined, 'admin');
      const rotated = await auth.rotateKey(id);
      expect(rotated!.role).toBe('admin');
    });

    it('should preserve rateLimit from original key', async () => {
      const { id } = await auth.createKey('limited-key', 42);
      const rotated = await auth.rotateKey(id);
      // Validate that the new key works and the rate limit is inherited
      const result = auth.validate(rotated!.key);
      expect(result.valid).toBe(true);
      // The stored key should still have rateLimit=42
      const stored = (auth as unknown as { store: { keys: Array<{ rateLimit: number }> } }).store.keys[0];
      expect(stored.rateLimit).toBe(42);
    });

    it('should set new expiresAt when ttlDays is provided', async () => {
      const { id } = await auth.createKey('old-expiry', 100, 1);
      const rotated = await auth.rotateKey(id, 30);
      expect(rotated!.expiresAt).not.toBeNull();
      expect(rotated!.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should preserve existing expiresAt when ttlDays is omitted', async () => {
      const { id } = await auth.createKey('keep-expiry', 100, 90);
      const rotated = await auth.rotateKey(id);
      // The expiresAt should still be set (not null)
      expect(rotated!.expiresAt).not.toBeNull();
    });

    it('should return null for non-existent key', async () => {
      const rotated = await auth.rotateKey('nonexistent-id');
      expect(rotated).toBeNull();
    });

    it('should persist rotated key to disk', async () => {
      const { id } = await auth.createKey('persist-rotate');
      const rotated = await auth.rotateKey(id);

      // Reload from disk
      const auth2 = new AuthManager(tmpFile, '');
      await auth2.load();

      // New key should validate
      expect(auth2.validate(rotated!.key).valid).toBe(true);
    });

    it('should reset rate limit counters on rotation', async () => {
      const { id, key } = await auth.createKey('rate-reset', 2);
      // Exhaust rate limit
      auth.validate(key);
      auth.validate(key);
      expect(auth.validate(key).rateLimited).toBe(true);

      // Rotate
      const rotated = await auth.rotateKey(id);
      // New key should not be rate limited
      expect(auth.validate(rotated!.key).rateLimited).toBe(false);
    });
  });
});
