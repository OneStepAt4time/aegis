/**
 * auth.test.ts — Tests for Issue #39: API key management + auth.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthManager } from '../auth.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

describe('Authentication and API key management (Issue #39)', () => {
  let auth: AuthManager;
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `aegis-keys-${Date.now()}.json`);
    auth = new AuthManager(tmpFile, '');
  });

  afterEach(async () => {
    try { await rm(tmpFile); } catch { /* ignore */ }
  });

  describe('Key creation', () => {
    it('should create a key with aegis_ prefix', async () => {
      const result = await auth.createKey('test-key');
      expect(result.key).toMatch(/^aegis_[a-f0-9]{64}$/);
      expect(result.id).toBeTruthy();
      expect(result.name).toBe('test-key');
    });

    it('should generate unique keys', async () => {
      const k1 = await auth.createKey('key1');
      const k2 = await auth.createKey('key2');
      expect(k1.key).not.toBe(k2.key);
      expect(k1.id).not.toBe(k2.id);
    });
  });

  describe('Key listing', () => {
    it('should list keys without hashes', async () => {
      await auth.createKey('my-key');
      const keys = auth.listKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0].name).toBe('my-key');
      expect((keys[0] as any).hash).toBeUndefined();
    });
  });

  describe('Key revocation', () => {
    it('should revoke an existing key', async () => {
      const { id } = await auth.createKey('to-revoke');
      expect(auth.listKeys()).toHaveLength(1);
      const revoked = await auth.revokeKey(id);
      expect(revoked).toBe(true);
      expect(auth.listKeys()).toHaveLength(0);
    });

    it('should return false for non-existent key', async () => {
      const revoked = await auth.revokeKey('nonexistent');
      expect(revoked).toBe(false);
    });
  });

  describe('Validation', () => {
    it('should validate a correct API key', async () => {
      const { key } = await auth.createKey('valid-key');
      const result = auth.validate(key);
      expect(result.valid).toBe(true);
      expect(result.keyId).toBeTruthy();
    });

    it('should reject an invalid key', async () => {
      await auth.createKey('valid-key');
      const result = auth.validate('aegis_invalidkey');
      expect(result.valid).toBe(false);
    });

    it('should allow all when no auth configured', () => {
      const noAuth = new AuthManager(tmpFile, '');
      const result = noAuth.validate('anything');
      expect(result.valid).toBe(true);
    });

    it('should validate master token (backward compat)', () => {
      const withMaster = new AuthManager(tmpFile, 'my-secret-token');
      const result = withMaster.validate('my-secret-token');
      expect(result.valid).toBe(true);
      expect(result.keyId).toBe('master');
    });

    it('should reject wrong master token', () => {
      const withMaster = new AuthManager(tmpFile, 'my-secret-token');
      const result = withMaster.validate('wrong-token');
      expect(result.valid).toBe(false);
    });
  });

  describe('Rate limiting', () => {
    it('should allow requests within rate limit', async () => {
      const { key } = await auth.createKey('rate-test', 5);
      for (let i = 0; i < 5; i++) {
        const result = auth.validate(key);
        expect(result.rateLimited).toBe(false);
      }
    });

    it('should rate limit after exceeding threshold', async () => {
      const { key } = await auth.createKey('rate-test', 3);
      auth.validate(key);
      auth.validate(key);
      auth.validate(key);
      const result = auth.validate(key); // 4th request
      expect(result.rateLimited).toBe(true);
      expect(result.valid).toBe(true); // Still valid, just rate limited
    });

    it('should not rate limit master token', () => {
      const withMaster = new AuthManager(tmpFile, 'master');
      for (let i = 0; i < 200; i++) {
        const result = withMaster.validate('master');
        expect(result.rateLimited).toBe(false);
      }
    });
  });

  describe('Hashing', () => {
    it('should produce consistent hashes', () => {
      const h1 = AuthManager.hashKey('test-key');
      const h2 = AuthManager.hashKey('test-key');
      expect(h1).toBe(h2);
    });

    it('should produce different hashes for different keys', () => {
      const h1 = AuthManager.hashKey('key-a');
      const h2 = AuthManager.hashKey('key-b');
      expect(h1).not.toBe(h2);
    });

    it('should produce hex string of 64 chars (SHA-256)', () => {
      const hash = AuthManager.hashKey('any-key');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('Persistence', () => {
    it('should save and reload keys', async () => {
      const { key } = await auth.createKey('persist-test');

      const auth2 = new AuthManager(tmpFile, '');
      await auth2.load();

      const result = auth2.validate(key);
      expect(result.valid).toBe(true);
    });
  });

  describe('authEnabled', () => {
    it('should be false with no master token and no keys', () => {
      expect(auth.authEnabled).toBe(false);
    });

    it('should be true with master token', () => {
      const withMaster = new AuthManager(tmpFile, 'token');
      expect(withMaster.authEnabled).toBe(true);
    });

    it('should be true with API keys', async () => {
      await auth.createKey('key');
      expect(auth.authEnabled).toBe(true);
    });
  });
});
