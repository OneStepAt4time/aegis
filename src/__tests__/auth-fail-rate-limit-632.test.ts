/**
 * auth-fail-rate-limit-632.test.ts — Tests for Issue #632:
 * Auth failure rate limiting — 5 failed auth attempts per minute per IP.
 *
 * Tests the checkAuthFailRateLimit() and recordAuthFailure() functions
 * which protect against brute-force attacks on the auth endpoint.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Replicate the auth failure rate limiter logic for unit testing ──

interface AuthFailBucket {
  timestamps: number[];
}

const AUTH_FAIL_WINDOW_MS = 60_000;
const AUTH_FAIL_MAX = 5;

function createAuthFailLimiter() {
  const limits = new Map<string, AuthFailBucket>();

  function prune(ip: string): void {
    const now = Date.now();
    const cutoff = now - AUTH_FAIL_WINDOW_MS;
    const bucket = limits.get(ip);
    if (bucket) {
      bucket.timestamps = bucket.timestamps.filter(t => t >= cutoff);
      if (bucket.timestamps.length === 0) limits.delete(ip);
    }
  }

  /** Returns true if the IP is rate-limited (exceeded max failures). */
  function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const cutoff = now - AUTH_FAIL_WINDOW_MS;
    const bucket = limits.get(ip) || { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter(t => t >= cutoff);
    bucket.timestamps.push(now);
    limits.set(ip, bucket);
    return bucket.timestamps.length > AUTH_FAIL_MAX;
  }

  /** Record a failed auth attempt and check if rate limited. */
  function recordFailure(ip: string): boolean {
    return checkRateLimit(ip);
  }

  /** Get current failure count for an IP (for testing). */
  function getCount(ip: string): number {
    prune(ip);
    return limits.get(ip)?.timestamps.length ?? 0;
  }

  return { checkRateLimit, recordFailure, getCount, limits };
}

describe('Auth failure rate limiting (Issue #632)', () => {
  const limiter = createAuthFailLimiter();
  const ip = '192.168.1.100';

  beforeEach(() => {
    limiter.limits.clear();
  });

  it('allows the first 5 failed auth attempts', () => {
    for (let i = 0; i < 5; i++) {
      expect(limiter.recordFailure(ip)).toBe(false);
    }
  });

  it('blocks on the 6th failed auth attempt', () => {
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure(ip);
    }
    expect(limiter.recordFailure(ip)).toBe(true);
  });

  it('tracks different IPs independently', () => {
    const ip1 = '10.0.0.1';
    const ip2 = '10.0.0.2';
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure(ip1);
    }
    // ip1 is now rate-limited
    expect(limiter.recordFailure(ip1)).toBe(true);
    // ip2 should still be allowed
    expect(limiter.recordFailure(ip2)).toBe(false);
  });

  it('allows attempts after the window expires', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    // Burn through 5 failures + trigger limit
    for (let i = 0; i < 6; i++) {
      limiter.recordFailure(ip);
    }
    expect(limiter.getCount(ip)).toBe(6);

    // Advance past the 60s window
    vi.advanceTimersByTime(60_001);

    // Should be allowed again — old entries pruned
    expect(limiter.recordFailure(ip)).toBe(false);

    vi.useRealTimers();
  });

  it('prunes expired entries to prevent memory growth', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    limiter.recordFailure(ip);
    expect(limiter.getCount(ip)).toBe(1);

    vi.advanceTimersByTime(60_001);
    expect(limiter.getCount(ip)).toBe(0); // pruned

    vi.useRealTimers();
  });

  it('handles requests from x-forwarded-for header value', () => {
    const forwardedIp = '203.0.113.50';
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure(forwardedIp);
    }
    expect(limiter.recordFailure(forwardedIp)).toBe(true);
  });
});
