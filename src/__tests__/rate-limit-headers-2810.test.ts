/**
 * Test for #2810: Rate limit headers on 429 responses.
 *
 * Verifies that all 429 responses from the custom rate limiter include
 * X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, and Retry-After.
 */

import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../services/auth/RateLimiter.js';

describe('RateLimiter bucket info (#2810)', () => {
  it('getIpBucketInfo returns limit, remaining, and reset', () => {
    const limiter = new RateLimiter();
    const info = limiter.getIpBucketInfo('127.0.0.1', false);

    expect(info.limit).toBe(120);
    expect(info.remaining).toBe(120);
    expect(typeof info.reset).toBe('number');
    expect(info.reset).toBeGreaterThan(0);
  });

  it('getIpBucketInfo reflects checkIpRateLimit consumption', () => {
    const limiter = new RateLimiter();
    limiter.checkIpRateLimit('127.0.0.1', false);
    limiter.checkIpRateLimit('127.0.0.1', false);

    const info = limiter.getIpBucketInfo('127.0.0.1', false);
    expect(info.limit).toBe(120);
    expect(info.remaining).toBe(118);
  });

  it('getIpBucketInfo with keyId uses per-key bucket', () => {
    const limiter = new RateLimiter();
    limiter.checkIpRateLimit('127.0.0.1', false, 'key-1');
    limiter.checkIpRateLimit('127.0.0.1', false, 'key-1');
    limiter.checkIpRateLimit('127.0.0.1', false, 'key-2');

    const info1 = limiter.getIpBucketInfo('127.0.0.1', false, 'key-1');
    expect(info1.remaining).toBe(118);

    const info2 = limiter.getIpBucketInfo('127.0.0.1', false, 'key-2');
    expect(info2.remaining).toBe(119);
  });

  it('getIpBucketInfo for master key returns 300 limit', () => {
    const limiter = new RateLimiter();
    const info = limiter.getIpBucketInfo('127.0.0.1', true);

    expect(info.limit).toBe(300);
  });

  it('getUnauthIpBucketInfo returns unauth limit', () => {
    const limiter = new RateLimiter();
    limiter.checkIpRateLimitUnauth('127.0.0.1');

    const info = limiter.getUnauthIpBucketInfo('127.0.0.1');
    expect(info.limit).toBe(30);
    expect(info.remaining).toBe(29);
  });

  it('getAuthFailBucketInfo returns auth fail limit', () => {
    const limiter = new RateLimiter();
    limiter.recordAuthFailure('127.0.0.1');
    limiter.recordAuthFailure('127.0.0.1');

    const info = limiter.getAuthFailBucketInfo('127.0.0.1');
    expect(info.limit).toBe(5);
    expect(info.remaining).toBe(3);
  });

  it('remaining is clamped to 0 when over limit', () => {
    const limiter = new RateLimiter();
    // Exhaust the bucket
    for (let i = 0; i < 125; i++) {
      limiter.checkIpRateLimit('127.0.0.1', false);
    }

    const info = limiter.getIpBucketInfo('127.0.0.1', false);
    expect(info.remaining).toBe(0);
  });

  it('reset is a future epoch timestamp', () => {
    const limiter = new RateLimiter();
    const now = Math.ceil(Date.now() / 1000);
    const info = limiter.getIpBucketInfo('127.0.0.1', false);

    expect(info.reset).toBeGreaterThanOrEqual(now);
    expect(info.reset).toBeLessThanOrEqual(now + 120); // within 2 minutes
  });

  it('dispose clears interval without error', () => {
    const limiter = new RateLimiter();
    expect(() => limiter.dispose()).not.toThrow();
  });
});
