/**
 * batch-limiter.test.ts — Tests for Issue #583: batch rate limiting.
 */

import { describe, it, expect } from 'vitest';
import { BatchRateLimiter } from '../batch-limiter.js';

describe('BatchRateLimiter (Issue #583)', () => {
  describe('per-key cooldown', () => {
    it('allows the first batch request for a key', () => {
      const limiter = new BatchRateLimiter({ cooldownMs: 5000 });
      const result = limiter.check('key-1', 0, 10);
      expect(result.allowed).toBe(true);
    });

    it('rejects a second request within cooldown period', () => {
      const limiter = new BatchRateLimiter({ cooldownMs: 5000 });
      limiter.check('key-1', 0, 10);
      limiter.record('key-1');

      const result = limiter.check('key-1', 10, 5);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('cooldown');
        expect(result.detail).toContain('retry after');
      }
    });

    it('allows requests from different keys independently', () => {
      const limiter = new BatchRateLimiter({ cooldownMs: 5000 });
      limiter.check('key-1', 0, 10);
      limiter.record('key-1');

      const result = limiter.check('key-2', 10, 5);
      expect(result.allowed).toBe(true);
    });

    it('allows a request after cooldown expires', () => {
      const limiter = new BatchRateLimiter({ cooldownMs: 100 });
      limiter.record('key-1');

      // Simulate time passing
      const originalNow = Date.now;
      let fakeTime = originalNow();
      Date.now = () => fakeTime;

      fakeTime += 150; // Past the 100ms cooldown
      const result = limiter.check('key-1', 0, 5);
      expect(result.allowed).toBe(true);

      Date.now = originalNow;
    });
  });

  describe('global concurrent session cap', () => {
    it('rejects batch that would exceed session cap', () => {
      const limiter = new BatchRateLimiter({ maxConcurrentSessions: 200 });
      const result = limiter.check('key-1', 195, 10);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('session_cap');
        expect(result.detail).toContain('195');
        expect(result.detail).toContain('10');
        expect(result.detail).toContain('200');
      }
    });

    it('allows batch that fits within session cap', () => {
      const limiter = new BatchRateLimiter({ maxConcurrentSessions: 200 });
      const result = limiter.check('key-1', 195, 5);
      expect(result.allowed).toBe(true);
    });

    it('allows batch that exactly fills session cap', () => {
      const limiter = new BatchRateLimiter({ maxConcurrentSessions: 200 });
      const result = limiter.check('key-1', 190, 10);
      expect(result.allowed).toBe(true);
    });
  });

  describe('cooldown vs session cap priority', () => {
    it('checks cooldown before session cap', () => {
      const limiter = new BatchRateLimiter({ cooldownMs: 5000, maxConcurrentSessions: 10 });
      limiter.record('key-1');

      // Cooldown should trigger first, even if session cap would also fail
      const result = limiter.check('key-1', 0, 100);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('cooldown');
      }
    });
  });

  describe('reset', () => {
    it('clears cooldown for a specific key', () => {
      const limiter = new BatchRateLimiter({ cooldownMs: 5000 });
      limiter.record('key-1');

      limiter.reset('key-1');
      const result = limiter.check('key-1', 0, 5);
      expect(result.allowed).toBe(true);
    });
  });

  describe('defaults', () => {
    it('uses default cooldown of 5000ms', () => {
      const limiter = new BatchRateLimiter();
      expect(limiter.cooldown).toBe(5000);
    });

    it('uses default session cap of 200', () => {
      const limiter = new BatchRateLimiter();
      expect(limiter.sessionCap).toBe(200);
    });
  });
});
