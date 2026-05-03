/**
 * rate-limiter-2456.test.ts — Separate auth/unauth rate-limit buckets (Issue #2456).
 *
 * Three scenarios verified:
 *   1. Valid auth is never blocked by unauth-triggered rate limits (failed attempts
 *      or no-token traffic from the same IP must not lock out a caller with a valid
 *      token, because authenticated requests use an `ip:keyId` compound bucket key).
 *   2. Unauthenticated (no-token) requests are still rate-limited via the IP-only bucket.
 *   3. Auth and unauth buckets are fully independent — exhausting one does not
 *      affect the other.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { RateLimiter } from '../services/auth/index.js';

describe('RateLimiter — separate auth/unauth buckets (Issue #2456)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Scenario 1: valid auth never blocked by unauth-triggered rate limits ──

  it('unauth (no-keyId) traffic does not consume the authenticated ip:keyId bucket', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.56';

    // Drive the IP-only (unauth) bucket over its 120/min limit
    for (let i = 0; i < 121; i++) {
      limiter.checkIpRateLimit(ip, false); // no keyId — uses bucket key "ip"
    }
    expect(limiter.checkIpRateLimit(ip, false)).toBe(true); // unauth bucket is exhausted

    // Authenticated traffic uses bucket "ip:key1" — completely separate, still fresh
    for (let i = 0; i < 120; i++) {
      expect(limiter.checkIpRateLimit(ip, false, 'key1')).toBe(false);
    }
    expect(limiter.checkIpRateLimit(ip, false, 'key1')).toBe(true); // own limit reached independently
  });

  it('auth-fail lockout does not block a caller from the same IP that presents a valid token', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.57';

    // Exhaust the auth-failure rate limit (5 failures in window)
    for (let i = 0; i < 5; i++) {
      limiter.recordAuthFailure(ip);
    }
    expect(limiter.checkAuthFailRateLimit(ip)).toBe(true); // auth-fail limit is hit

    // The per-key IP rate limit is untouched — valid auth from same IP still works
    for (let i = 0; i < 120; i++) {
      expect(limiter.checkIpRateLimit(ip, false, 'valid-key')).toBe(false);
    }
  });

  // ── Scenario 2: unauthenticated requests are still rate-limited ──

  it('IP-only (no-keyId) bucket enforces its own limit and resets after the window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.58';

    // 120 requests pass
    for (let i = 0; i < 120; i++) {
      expect(limiter.checkIpRateLimit(ip, false)).toBe(false);
    }
    // 121st exceeds the limit
    expect(limiter.checkIpRateLimit(ip, false)).toBe(true);

    // After the 60-second window the bucket drains and unauth is allowed again
    vi.setSystemTime(61_000);
    expect(limiter.checkIpRateLimit(ip, false)).toBe(false);
  });

  // ── Scenario 3: no cross-contamination between auth and unauth buckets ──

  it('exhausting the auth (ip:keyId) bucket does not affect the unauth (ip-only) bucket', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.60';

    // Exhaust auth bucket for key1
    for (let i = 0; i < 121; i++) {
      limiter.checkIpRateLimit(ip, false, 'key1');
    }
    expect(limiter.checkIpRateLimit(ip, false, 'key1')).toBe(true); // key1 bucket exhausted

    // Unauth (IP-only) bucket is untouched
    for (let i = 0; i < 120; i++) {
      expect(limiter.checkIpRateLimit(ip, false)).toBe(false);
    }
    expect(limiter.checkIpRateLimit(ip, false)).toBe(true); // unauth hits its own limit
  });

  it('exhausting the unauth (ip-only) bucket does not affect auth (ip:keyId) buckets', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.61';

    // Exhaust unauth (IP-only) bucket
    for (let i = 0; i < 121; i++) {
      limiter.checkIpRateLimit(ip, false); // no keyId
    }
    expect(limiter.checkIpRateLimit(ip, false)).toBe(true); // unauth is blocked

    // Authenticated key2 from same IP has its own fresh bucket
    for (let i = 0; i < 120; i++) {
      expect(limiter.checkIpRateLimit(ip, false, 'key2')).toBe(false);
    }
    expect(limiter.checkIpRateLimit(ip, false, 'key2')).toBe(true);
  });

  it('different API keys on the same IP use independent buckets', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.62';

    // Exhaust key-a bucket
    for (let i = 0; i < 121; i++) {
      limiter.checkIpRateLimit(ip, false, 'key-a');
    }
    expect(limiter.checkIpRateLimit(ip, false, 'key-a')).toBe(true);

    // key-b from same IP is unaffected
    for (let i = 0; i < 120; i++) {
      expect(limiter.checkIpRateLimit(ip, false, 'key-b')).toBe(false);
    }
    expect(limiter.checkIpRateLimit(ip, false, 'key-b')).toBe(true);
  });

  it('pruneIpRateLimits clears all buckets after window expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.63';

    limiter.checkIpRateLimit(ip, false);           // unauth bucket
    limiter.checkIpRateLimit(ip, false, 'key-x');  // auth bucket

    vi.setSystemTime(61_000);
    limiter.pruneIpRateLimits();

    // Both buckets are reset after prune + window expiry
    expect(limiter.checkIpRateLimit(ip, false)).toBe(false);
    expect(limiter.checkIpRateLimit(ip, false, 'key-x')).toBe(false);

    limiter.dispose();
  });
});
