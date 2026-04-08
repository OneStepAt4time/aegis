/**
 * auth-coverage-1305.test.ts — Additional coverage tests for Issue #1305.
 *
 * Targets uncovered branches in src/auth.ts:
 * - load() with corrupted/invalid keys file
 * - save() with non-existent parent directory
 * - validate() non-localhost binding security rejection (#1080)
 * - Rate limit window reset after 60s
 * - sweepStaleRateLimits() for both rate limit and batch rate limit buckets
 * - setHost / isLocalhostBinding
 * - cleanExpiredSSETokens via fake timers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthManager, classifyBearerTokenForRoute } from '../auth.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm, mkdir, writeFile } from 'node:fs/promises';

describe('Issue #1305: auth.ts additional coverage', () => {
  let auth: AuthManager;
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `aegis-cov-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    auth = new AuthManager(tmpFile, '');
  });

  afterEach(async () => {
    try { await rm(tmpFile, { recursive: true, force: true }); } catch { /* ignore */ }
    vi.useRealTimers();
  });

  // ── load() ────────────────────────────────────────────────────────────

  describe('load()', () => {
    it('should handle missing keys file gracefully (no store on disk)', async () => {
      await auth.load();
      expect(auth.listKeys()).toHaveLength(0);
      expect(auth.authEnabled).toBe(false);
    });

    it('should handle corrupted JSON in keys file', async () => {
      await writeFile(tmpFile, 'NOT VALID JSON{{{', 'utf-8');
      await auth.load();
      // Corrupted file — should start fresh
      expect(auth.listKeys()).toHaveLength(0);
    });

    it('should handle valid JSON that fails schema validation', async () => {
      await writeFile(tmpFile, JSON.stringify({ keys: [{ invalid: true }] }), 'utf-8');
      await auth.load();
      // Schema parse failure — should start fresh
      expect(auth.listKeys()).toHaveLength(0);
    });

    it('should load valid persisted keys', async () => {
      const { key } = await auth.createKey('persisted');
      // Create a new AuthManager instance and load
      const auth2 = new AuthManager(tmpFile, '');
      await auth2.load();
      const result = auth2.validate(key);
      expect(result.valid).toBe(true);
      expect(result.keyId).toBeTruthy();
    });
  });

  // ── save() ───────────────────────────────────────────────────────────

  describe('save()', () => {
    it('should create parent directory if it does not exist', async () => {
      const nestedFile = join(tmpdir(), `aegis-nested-${Date.now()}/subdir/keys.json`);
      const nestedAuth = new AuthManager(nestedFile, '');
      await nestedAuth.createKey('nested-key');
      // save() is called inside createKey — if we get here, it succeeded
      expect(nestedAuth.listKeys()).toHaveLength(1);
      // Cleanup
      try { await rm(join(tmpdir(), `aegis-nested-${Date.now()}`), { recursive: true, force: true }); } catch { /* ignore */ }
    });
  });

  // ── validate() ───────────────────────────────────────────────────────

  describe('validate() — #1080 non-localhost binding', () => {
    it('should reject all requests when bound to non-localhost without auth', () => {
      const noAuth = new AuthManager(tmpFile, '');
      noAuth.setHost('0.0.0.0');
      const result = noAuth.validate('anything');
      expect(result.valid).toBe(false);
      expect(result.keyId).toBeNull();
      expect(result.rateLimited).toBe(false);
    });

    it('should reject requests on ::ffff:0.0.0.0 without auth', () => {
      const noAuth = new AuthManager(tmpFile, '');
      noAuth.setHost('::ffff:0.0.0.0');
      const result = noAuth.validate('anything');
      expect(result.valid).toBe(false);
    });

    it('should allow requests on 127.0.0.1 without auth (localhost)', () => {
      const noAuth = new AuthManager(tmpFile, '');
      noAuth.setHost('127.0.0.1');
      const result = noAuth.validate('anything');
      expect(result.valid).toBe(true);
    });

    it('should allow requests on ::1 without auth (localhost IPv6)', () => {
      const noAuth = new AuthManager(tmpFile, '');
      noAuth.setHost('::1');
      const result = noAuth.validate('anything');
      expect(result.valid).toBe(true);
    });

    it('should allow requests on "localhost" without auth', () => {
      const noAuth = new AuthManager(tmpFile, '');
      noAuth.setHost('localhost');
      const result = noAuth.validate('anything');
      expect(result.valid).toBe(true);
    });

    it('should validate API key even on non-localhost binding', async () => {
      const withKey = new AuthManager(tmpFile, '');
      withKey.setHost('0.0.0.0');
      const { key } = await withKey.createKey('secure-key');
      const result = withKey.validate(key);
      expect(result.valid).toBe(true);
    });
  });

  // ── setHost / hostBinding / isLocalhostBinding ────────────────────────

  describe('setHost / hostBinding / isLocalhostBinding', () => {
    it('should default host to 127.0.0.1', () => {
      expect(auth.hostBinding).toBe('127.0.0.1');
      expect(auth.isLocalhostBinding).toBe(true);
    });

    it('should update host via setHost', () => {
      auth.setHost('0.0.0.0');
      expect(auth.hostBinding).toBe('0.0.0.0');
      expect(auth.isLocalhostBinding).toBe(false);
    });

    it('should recognize ::1 as localhost', () => {
      auth.setHost('::1');
      expect(auth.isLocalhostBinding).toBe(true);
    });

    it('should recognize arbitrary hostnames as non-localhost', () => {
      auth.setHost('192.168.1.100');
      expect(auth.isLocalhostBinding).toBe(false);
    });
  });

  // ── Rate limiting — window reset ─────────────────────────────────────

  describe('Rate limit window reset', () => {
    it('should reset rate limit after 60s window', async () => {
      const { key } = await auth.createKey('window-test', 2);
      // Use 3 requests — 3rd should be rate limited
      auth.validate(key);
      auth.validate(key);
      expect(auth.validate(key).rateLimited).toBe(true);

      // Advance time past the 60s window
      vi.useFakeTimers();
      vi.advanceTimersByTime(61_000);

      // Should no longer be rate limited
      expect(auth.validate(key).rateLimited).toBe(false);
    });
  });

  // ── sweepStaleRateLimits ─────────────────────────────────────────────

  describe('sweepStaleRateLimits()', () => {
    it('should remove expired rate limit buckets', async () => {
      const { key } = await auth.createKey('sweep-test', 5);
      auth.validate(key);

      vi.useFakeTimers();
      vi.advanceTimersByTime(61_000);

      auth.sweepStaleRateLimits();

      // After sweep, the bucket is gone — should start fresh
      for (let i = 0; i < 5; i++) {
        expect(auth.validate(key).rateLimited).toBe(false);
      }
    });

    it('should remove expired batch rate limit entries', () => {
      auth.checkBatchRateLimit('batch-key');

      vi.useFakeTimers();
      vi.advanceTimersByTime(6_000);

      auth.sweepStaleRateLimits();

      // After sweep, should be allowed again
      expect(auth.checkBatchRateLimit('batch-key')).toBe(false);
    });

    it('should not remove active rate limit buckets', async () => {
      const { key } = await auth.createKey('active-sweep', 5);
      auth.validate(key);

      // Only advance 30s — within the window
      vi.useFakeTimers();
      vi.advanceTimersByTime(30_000);

      auth.sweepStaleRateLimits();

      // Bucket should still be active — 2nd request is count 2
      expect(auth.validate(key).rateLimited).toBe(false);
    });
  });

  // ── SSE token expiry via fake timers ─────────────────────────────────

  describe('SSE token expiry with time manipulation', () => {
    it('should reject expired SSE tokens', async () => {
      const { token } = await auth.generateSSEToken('master');

      // Advance time past the 60s TTL
      vi.useFakeTimers();
      vi.advanceTimersByTime(61_000);

      expect(await auth.validateSSEToken(token)).toBe(false);
    });

    it('should cleanup expired tokens before generating new ones', async () => {
      // Fill up to the limit
      for (let i = 0; i < 5; i++) {
        await auth.generateSSEToken('master');
      }

      // Advance time past TTL — all tokens should be expired
      vi.useFakeTimers();
      vi.advanceTimersByTime(61_000);

      // Should be able to generate more since expired tokens were cleaned up
      const result = await auth.generateSSEToken('master');
      expect(result.token).toMatch(/^sse_[a-f0-9]{64}$/);
    });
  });

  // ── classifyBearerTokenForRoute ──────────────────────────────────────

  describe('classifyBearerTokenForRoute edge cases', () => {
    it('should classify sse_ prefixed token on SSE route as sse', () => {
      // ggignore:all
      expect(classifyBearerTokenForRoute('sse_abc123def456', true)).toBe('sse');
    });

    it('should reject non-sse_ token on SSE route', () => {
      expect(classifyBearerTokenForRoute('regular-bearer-token', true)).toBe('reject');
    });

    it('should classify any token on non-SSE route as bearer', () => {
      expect(classifyBearerTokenForRoute('anything-goes', false)).toBe('bearer');
      // ggignore:all
      expect(classifyBearerTokenForRoute('sse_something', false)).toBe('bearer');
    });
  });

  // ── validate() with master token on non-localhost ────────────────────

  describe('validate() master token on non-localhost', () => {
    it('should accept master token even on non-localhost binding', () => {
      // ggignore:all
      const withMaster = new AuthManager(tmpFile, 'secret-token');
      withMaster.setHost('0.0.0.0');
      const result = withMaster.validate('secret-token');
      expect(result.valid).toBe(true);
      expect(result.keyId).toBe('master');
    });
  });

  // ── authEnabled ──────────────────────────────────────────────────────

  describe('authEnabled', () => {
    it('should be true when master token is set', () => {
      const withMaster = new AuthManager(tmpFile, 'token');
      expect(withMaster.authEnabled).toBe(true);
    });

    it('should be false when no master token and no keys', () => {
      expect(auth.authEnabled).toBe(false);
    });

    it('should be true when keys exist', async () => {
      await auth.createKey('key');
      expect(auth.authEnabled).toBe(true);
    });
  });
});
