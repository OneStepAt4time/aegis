/**
 * rate-limiter-separation-2456.test.ts — Issue #2456
 *
 * Verifies that rate limiting buckets are properly separated so that:
 *   (a) Valid authenticated requests are never blocked by rate limits triggered
 *       by unauthenticated or failed requests from the same IP.
 *   (b) Unauthenticated requests are still rate-limited via their own bucket.
 *   (c) Mixed auth/unauth traffic from the same IP does not cross-contaminate.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { RateLimiter } from '../services/auth/index.js';

describe('Rate limiter bucket separation (Issue #2456)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── (a) Valid auth never blocked by unauth-triggered limits ──────────

  it('(a) auth-fail lockout on an IP does not block subsequent valid-token requests', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.10';

    // Exhaust the auth-failure limit (5 failures within the window)
    for (let i = 0; i < 5; i++) {
      limiter.recordAuthFailure(ip);
    }
    expect(limiter.checkAuthFailRateLimit(ip)).toBe(true); // brute-force gate is up

    // The *authenticated* IP bucket must remain completely untouched — valid
    // callers presenting a key can still make their full 120 req/min.
    for (let i = 0; i < 120; i++) {
      expect(limiter.checkIpRateLimit(ip, false, 'key-abc')).toBe(false);
    }
    // Only the 121st request hits the auth bucket's own limit
    expect(limiter.checkIpRateLimit(ip, false, 'key-abc')).toBe(true);
  });

  it('(a) unauth no-token flood does not consume the authenticated IP bucket', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.11';

    // Drive the unauth bucket well past its limit
    for (let i = 0; i < 50; i++) {
      limiter.checkIpRateLimitUnauth(ip);
    }
    expect(limiter.checkIpRateLimitUnauth(ip)).toBe(true); // unauth is blocked

    // Auth bucket is untouched — valid requests still allowed
    for (let i = 0; i < 120; i++) {
      expect(limiter.checkIpRateLimit(ip, false, 'key-xyz')).toBe(false);
    }
  });

  // ── (b) Unauth requests are still rate-limited ───────────────────────

  it('(b) unauth IP bucket enforces its own limit', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.20';

    // Allow up to IP_UNAUTH_LIMIT (30) requests without blocking
    for (let i = 0; i < 30; i++) {
      expect(limiter.checkIpRateLimitUnauth(ip)).toBe(false);
    }
    // 31st request is throttled
    expect(limiter.checkIpRateLimitUnauth(ip)).toBe(true);
  });

  it('(b) unauth bucket resets after the 60-second window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.21';

    for (let i = 0; i < 31; i++) {
      limiter.checkIpRateLimitUnauth(ip);
    }
    expect(limiter.checkIpRateLimitUnauth(ip)).toBe(true); // blocked

    vi.setSystemTime(61_000); // advance past the window
    expect(limiter.checkIpRateLimitUnauth(ip)).toBe(false); // allowed again
  });

  it('(b) auth-fail rate limit still blocks brute-force bad tokens', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.22';

    for (let i = 0; i < 5; i++) {
      limiter.recordAuthFailure(ip);
      if (i < 4) expect(limiter.checkAuthFailRateLimit(ip)).toBe(false);
    }
    expect(limiter.checkAuthFailRateLimit(ip)).toBe(true);
  });

  // ── (c) No cross-contamination between buckets ───────────────────────

  it('(c) exhausting auth bucket does not affect unauth bucket', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.30';

    // Exhaust auth bucket
    for (let i = 0; i < 121; i++) {
      limiter.checkIpRateLimit(ip, false, 'key-a');
    }
    expect(limiter.checkIpRateLimit(ip, false, 'key-a')).toBe(true); // auth blocked

    // Unauth bucket must still be pristine
    for (let i = 0; i < 30; i++) {
      expect(limiter.checkIpRateLimitUnauth(ip)).toBe(false);
    }
    expect(limiter.checkIpRateLimitUnauth(ip)).toBe(true); // unauth blocked at its OWN limit
  });

  it('(c) exhausting unauth bucket does not affect auth bucket', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.31';

    // Exhaust unauth bucket
    for (let i = 0; i < 31; i++) {
      limiter.checkIpRateLimitUnauth(ip);
    }
    expect(limiter.checkIpRateLimitUnauth(ip)).toBe(true); // unauth blocked

    // Auth bucket is independent — full 120-request allowance is intact
    for (let i = 0; i < 120; i++) {
      expect(limiter.checkIpRateLimit(ip, false, 'key-b')).toBe(false);
    }
    expect(limiter.checkIpRateLimit(ip, false, 'key-b')).toBe(true);
  });

  it('(c) different API keys from the same IP use independent auth buckets', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.32';

    // Exhaust bucket for key-1
    for (let i = 0; i < 121; i++) {
      limiter.checkIpRateLimit(ip, false, 'key-1');
    }
    expect(limiter.checkIpRateLimit(ip, false, 'key-1')).toBe(true); // key-1 blocked

    // key-2 from the same IP must be unaffected
    for (let i = 0; i < 120; i++) {
      expect(limiter.checkIpRateLimit(ip, false, 'key-2')).toBe(false);
    }
  });

  it('(c) pruneIpRateLimits clears both auth and unauth buckets', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const ip = '10.2.4.33';

    limiter.checkIpRateLimit(ip, false, 'key-c');
    limiter.checkIpRateLimitUnauth(ip);

    vi.setSystemTime(61_000);
    limiter.pruneIpRateLimits();

    expect(limiter.checkIpRateLimit(ip, false, 'key-c')).toBe(false);
    expect(limiter.checkIpRateLimitUnauth(ip)).toBe(false);

    limiter.dispose();
  });
});
