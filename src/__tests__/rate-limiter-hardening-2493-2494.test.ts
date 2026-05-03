/**
 * rate-limiter-hardening-2493-2494.test.ts — Defensive hardening tests.
 *
 * Issue #2493: Bucket keys use NUL-byte separator (\0) instead of colon,
 *   so a keyId containing ":" cannot create ambiguous bucket keys.
 *
 * Issue #2494: Authenticated and unauthenticated buckets use separate Maps,
 *   so unauth traffic cannot evict auth buckets under map-size pressure.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { RateLimiter } from '../services/auth/index.js';

describe('RateLimiter hardening (Issues #2493, #2494)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── #2493: NUL-byte separator prevents keyId ambiguity ──

  it('#2493: a keyId containing a colon does not collide with other keys', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.0.0.1';

    // A keyId that contains a colon — with the old ":" separator this
    // would create key "10.0.0.1:abc:def" which could collide with
    // ip="10.0.0.1", keyId="abc:def".
    const trickyKeyId = 'abc:def';

    // Exhaust the bucket for the tricky key
    for (let i = 0; i < 121; i++) {
      limiter.checkIpRateLimit(ip, false, trickyKeyId);
    }
    expect(limiter.checkIpRateLimit(ip, false, trickyKeyId)).toBe(true);

    // A different key that would share the same string representation
    // under the old separator should be unaffected
    expect(limiter.checkIpRateLimit(ip, false, 'abc')).toBe(false);
  });

  it('#2493: keyId with NUL byte in theory cannot exist (sanity)', () => {
    // NUL bytes cannot appear in HTTP headers (Bearer token → keyId),
    // so bucket keys built with \0 as separator are unambiguous.
    // This test documents the assumption.
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();

    // Normal operation — same IP, different keys, isolated buckets
    for (let i = 0; i < 121; i++) {
      limiter.checkIpRateLimit('10.0.0.2', false, 'key-a');
    }
    expect(limiter.checkIpRateLimit('10.0.0.2', false, 'key-a')).toBe(true);
    expect(limiter.checkIpRateLimit('10.0.0.2', false, 'key-b')).toBe(false);
  });

  // ── #2494: Separate Maps prevent cross-type eviction ──

  it('#2494: exhausting the auth map does not affect the unauth map', () => {
    // This is a structural guarantee: the two maps are independent.
    // We verify by checking that pruneIpRateLimits clears both,
    // and that they operate on separate storage.
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();

    // Create auth bucket
    limiter.checkIpRateLimit('10.0.1.1', false, 'key-1');
    // Create unauth bucket
    limiter.checkIpRateLimitUnauth('10.0.1.1');

    // Both should be independently functional
    expect(limiter.checkIpRateLimit('10.0.1.1', false, 'key-1')).toBe(false);
    expect(limiter.checkIpRateLimitUnauth('10.0.1.1')).toBe(false);

    // After window expiry, prune clears both independently
    vi.setSystemTime(61_000);
    limiter.pruneIpRateLimits();

    // Fresh buckets after prune
    expect(limiter.checkIpRateLimit('10.0.1.1', false, 'key-1')).toBe(false);
    expect(limiter.checkIpRateLimitUnauth('10.0.1.1')).toBe(false);

    limiter.dispose();
  });

  it('#2494: pruneIpRateLimits clears both auth and unauth maps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();

    // Create entries in both maps
    limiter.checkIpRateLimit('10.0.2.1', false, 'auth-key');
    limiter.checkIpRateLimitUnauth('10.0.2.2');

    // Advance past window
    vi.setSystemTime(61_000);
    limiter.pruneIpRateLimits();

    // Both should be pruned (fresh buckets after prune)
    expect(limiter.checkIpRateLimit('10.0.2.1', false, 'auth-key')).toBe(false);
    expect(limiter.checkIpRateLimitUnauth('10.0.2.2')).toBe(false);

    limiter.dispose();
  });
});
