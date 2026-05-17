/**
 * Issue #3575: Test coverage for RateLimiter
 *
 * Tests rate limiting: IP rate limits (auth/unauth/master),
 * auth failure tracking, bucket info, pruning, and disposal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../services/auth/RateLimiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new RateLimiter();
  });

  afterEach(() => {
    limiter.dispose();
    vi.useRealTimers();
  });

  describe('checkIpRateLimit', () => {
    it('allows requests under the limit', () => {
      for (let i = 0; i < 120; i++) {
        expect(limiter.checkIpRateLimit('1.2.3.4', false)).toBe(false);
      }
    });

    it('blocks requests over the normal limit (120)', () => {
      for (let i = 0; i < 120; i++) {
        limiter.checkIpRateLimit('1.2.3.4', false);
      }
      expect(limiter.checkIpRateLimit('1.2.3.4', false)).toBe(true);
    });

    it('allows higher limit for master key (300)', () => {
      for (let i = 0; i < 300; i++) {
        limiter.checkIpRateLimit('1.2.3.4', true);
      }
      expect(limiter.checkIpRateLimit('1.2.3.4', true)).toBe(true);
    });

    it('isolates buckets by keyId', () => {
      for (let i = 0; i < 120; i++) {
        limiter.checkIpRateLimit('1.2.3.4', false, 'key-a');
      }
      expect(limiter.checkIpRateLimit('1.2.3.4', false, 'key-a')).toBe(true);
      expect(limiter.checkIpRateLimit('1.2.3.4', false, 'key-b')).toBe(false);
    });

    it('isolates buckets by IP', () => {
      for (let i = 0; i < 120; i++) {
        limiter.checkIpRateLimit('1.2.3.4', false);
      }
      expect(limiter.checkIpRateLimit('1.2.3.4', false)).toBe(true);
      expect(limiter.checkIpRateLimit('5.6.7.8', false)).toBe(false);
    });

    it('resets bucket after window expires', () => {
      for (let i = 0; i < 120; i++) {
        limiter.checkIpRateLimit('1.2.3.4', false);
      }
      expect(limiter.checkIpRateLimit('1.2.3.4', false)).toBe(true);

      vi.advanceTimersByTime(61_000);
      expect(limiter.checkIpRateLimit('1.2.3.4', false)).toBe(false);
    });
  });

  describe('checkIpRateLimitUnauth', () => {
    it('allows requests under unauth limit (30)', () => {
      for (let i = 0; i < 30; i++) {
        expect(limiter.checkIpRateLimitUnauth('1.2.3.4')).toBe(false);
      }
    });

    it('blocks requests over unauth limit', () => {
      for (let i = 0; i < 30; i++) {
        limiter.checkIpRateLimitUnauth('1.2.3.4');
      }
      expect(limiter.checkIpRateLimitUnauth('1.2.3.4')).toBe(true);
    });

    it('does not affect authenticated buckets', () => {
      for (let i = 0; i < 30; i++) {
        limiter.checkIpRateLimitUnauth('1.2.3.4');
      }
      expect(limiter.checkIpRateLimit('1.2.3.4', false, 'key-a')).toBe(false);
    });
  });

  describe('auth failure tracking', () => {
    it('does not rate limit with no failures', () => {
      expect(limiter.checkAuthFailRateLimit('1.2.3.4')).toBe(false);
    });

    it('allows up to 5 failures before rate limiting', () => {
      for (let i = 0; i < 5; i++) {
        limiter.recordAuthFailure('1.2.3.4');
      }
      expect(limiter.checkAuthFailRateLimit('1.2.3.4')).toBe(true);
    });

    it('rate limits after 5 failures', () => {
      for (let i = 0; i < 4; i++) {
        limiter.recordAuthFailure('1.2.3.4');
      }
      expect(limiter.checkAuthFailRateLimit('1.2.3.4')).toBe(false);
      limiter.recordAuthFailure('1.2.3.4');
      expect(limiter.checkAuthFailRateLimit('1.2.3.4')).toBe(true);
    });

    it('resets failures on resetAuthFailures', () => {
      for (let i = 0; i < 5; i++) {
        limiter.recordAuthFailure('1.2.3.4');
      }
      expect(limiter.checkAuthFailRateLimit('1.2.3.4')).toBe(true);
      limiter.resetAuthFailures('1.2.3.4');
      expect(limiter.checkAuthFailRateLimit('1.2.3.4')).toBe(false);
    });

    it('expires old failure timestamps', () => {
      for (let i = 0; i < 5; i++) {
        limiter.recordAuthFailure('1.2.3.4');
      }
      expect(limiter.checkAuthFailRateLimit('1.2.3.4')).toBe(true);

      vi.advanceTimersByTime(61_000);
      expect(limiter.checkAuthFailRateLimit('1.2.3.4')).toBe(false);
    });
  });

  describe('getIpBucketInfo', () => {
    it('returns default bucket info when no requests', () => {
      const info = limiter.getIpBucketInfo('1.2.3.4', false);
      expect(info.limit).toBe(120);
      expect(info.remaining).toBe(120);
      expect(info.reset).toBeGreaterThan(0);
    });

    it('returns master bucket info', () => {
      const info = limiter.getIpBucketInfo('1.2.3.4', true);
      expect(info.limit).toBe(300);
    });

    it('decrements remaining after requests', () => {
      for (let i = 0; i < 10; i++) {
        limiter.checkIpRateLimit('1.2.3.4', false);
      }
      const info = limiter.getIpBucketInfo('1.2.3.4', false);
      expect(info.remaining).toBe(110);
    });
  });

  describe('getUnauthIpBucketInfo', () => {
    it('returns default unauth bucket info', () => {
      const info = limiter.getUnauthIpBucketInfo('1.2.3.4');
      expect(info.limit).toBe(30);
      expect(info.remaining).toBe(30);
    });

    it('decrements remaining after requests', () => {
      limiter.checkIpRateLimitUnauth('1.2.3.4');
      const info = limiter.getUnauthIpBucketInfo('1.2.3.4');
      expect(info.remaining).toBe(29);
    });
  });

  describe('getAuthFailBucketInfo', () => {
    it('returns default info when no failures', () => {
      const info = limiter.getAuthFailBucketInfo('1.2.3.4');
      expect(info.limit).toBe(5);
      expect(info.remaining).toBe(5);
    });

    it('decrements remaining after failures', () => {
      limiter.recordAuthFailure('1.2.3.4');
      const info = limiter.getAuthFailBucketInfo('1.2.3.4');
      expect(info.remaining).toBe(4);
    });
  });

  describe('pruning', () => {
    it('pruneIpRateLimits removes expired buckets', () => {
      limiter.checkIpRateLimit('1.2.3.4', false);
      limiter.checkIpRateLimitUnauth('5.6.7.8');

      vi.advanceTimersByTime(61_000);
      limiter.pruneIpRateLimits();

      const info = limiter.getIpBucketInfo('1.2.3.4', false);
      expect(info.remaining).toBe(120);
    });

    it('pruneAuthFailLimits removes expired failures', () => {
      limiter.recordAuthFailure('1.2.3.4');
      vi.advanceTimersByTime(61_000);
      limiter.pruneAuthFailLimits();
      expect(limiter.checkAuthFailRateLimit('1.2.3.4')).toBe(false);
    });
  });

  describe('dispose', () => {
    it('clears the cleanup timer without error', () => {
      limiter.dispose();
    });
  });
});
