import { describe, it, expect, vi, afterEach } from 'vitest';
import { RateLimiter } from '../services/auth/index.js';

describe('RateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('enforces auth-failure lockout at configured threshold and resets after window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();

    for (let i = 0; i < 4; i++) {
      limiter.recordAuthFailure('10.0.0.1');
      expect(limiter.checkAuthFailRateLimit('10.0.0.1')).toBe(false);
    }

    limiter.recordAuthFailure('10.0.0.1');
    expect(limiter.checkAuthFailRateLimit('10.0.0.1')).toBe(true);

    vi.setSystemTime(61_000);
    expect(limiter.checkAuthFailRateLimit('10.0.0.1')).toBe(false);
  });

  it('does not double-count auth failures when checked before record', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();

    for (let i = 0; i < 5; i++) {
      expect(limiter.checkAuthFailRateLimit('10.0.0.9')).toBe(false);
      limiter.recordAuthFailure('10.0.0.9');
    }

    expect(limiter.checkAuthFailRateLimit('10.0.0.9')).toBe(true);
  });

  it('enforces per-IP request limits with higher allowance for master token', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();

    for (let i = 0; i < 120; i++) {
      expect(limiter.checkIpRateLimit('10.0.0.2', false)).toBe(false);
    }
    expect(limiter.checkIpRateLimit('10.0.0.2', false)).toBe(true);

    for (let i = 0; i < 300; i++) {
      expect(limiter.checkIpRateLimit('10.0.0.3', true)).toBe(false);
    }
    expect(limiter.checkIpRateLimit('10.0.0.3', true)).toBe(true);
  });

  it('prunes stale windows so old traffic does not keep throttling', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();

    for (let i = 0; i < 120; i++) {
      limiter.checkIpRateLimit('10.0.0.4', false);
    }
    expect(limiter.checkIpRateLimit('10.0.0.4', false)).toBe(true);

    for (let i = 0; i < 5; i++) {
      limiter.recordAuthFailure('10.0.0.5');
    }
    expect(limiter.checkAuthFailRateLimit('10.0.0.5')).toBe(true);

    vi.setSystemTime(61_000);
    limiter.pruneIpRateLimits();
    limiter.pruneAuthFailLimits();

    expect(limiter.checkIpRateLimit('10.0.0.4', false)).toBe(false);
    expect(limiter.checkAuthFailRateLimit('10.0.0.5')).toBe(false);
  });

  it('bounds per-IP in-memory bucket growth for sustained traffic', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();

    for (let i = 0; i < 2_000; i++) {
      limiter.checkIpRateLimit('10.0.0.8', true);
      limiter.recordAuthFailure('10.0.0.8');
    }

    const ipBucket = (limiter as any).ipRateLimits.get('10.0.0.8');
    const authBucket = (limiter as any).authFailLimits.get('10.0.0.8');
    const ipActiveCount = ipBucket.entries.length - ipBucket.start;

    expect(ipActiveCount).toBeLessThanOrEqual(301);
    expect(authBucket.timestamps.length).toBeLessThanOrEqual(5);
  });

  it('cleans up stale inactive IP entries after one hour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();

    limiter.checkIpRateLimit('10.0.1.1', false);
    limiter.recordAuthFailure('10.0.1.1');

    vi.setSystemTime((60 * 60 * 1000) + (5 * 60 * 1000) + 1);
    vi.advanceTimersByTime(5 * 60 * 1000);

    const internal = limiter as unknown as {
      ipRateLimits: Map<string, unknown>;
      authFailLimits: Map<string, unknown>;
      dispose: () => void;
    };

    expect(internal.ipRateLimits.has('10.0.1.1')).toBe(false);
    expect(internal.authFailLimits.has('10.0.1.1')).toBe(false);
    internal.dispose();
  });

  // ── Issue #2456: Separate buckets for authenticated vs unauthenticated ──

  it('uses separate buckets per keyId so unauth traffic cannot exhaust authed bucket', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();

    // Saturate the unauthenticated IP bucket (no keyId)
    for (let i = 0; i < 120; i++) {
      expect(limiter.checkIpRateLimit('10.0.0.10', false)).toBe(false);
    }
    expect(limiter.checkIpRateLimit('10.0.0.10', false)).toBe(true);

    // Authenticated requests with keyId should NOT be affected
    // They have their own independent bucket (120 limit)
    for (let i = 0; i < 120; i++) {
      expect(limiter.checkIpRateLimit('10.0.0.10', false, 'key-abc')).toBe(false);
    }
    expect(limiter.checkIpRateLimit('10.0.0.10', false, 'key-abc')).toBe(true);

    // A different key on the same IP also has its own bucket
    expect(limiter.checkIpRateLimit('10.0.0.10', false, 'key-xyz')).toBe(false);
  });

  it('uses separate buckets for different keyIds on the same IP', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();

    // Saturate key-1
    for (let i = 0; i < 120; i++) {
      limiter.checkIpRateLimit('10.0.0.11', false, 'key-1');
    }
    expect(limiter.checkIpRateLimit('10.0.0.11', false, 'key-1')).toBe(true);

    // key-2 on the same IP is unaffected
    expect(limiter.checkIpRateLimit('10.0.0.11', false, 'key-2')).toBe(false);
  });

  it('checkIpRateLimitUnauth uses a dedicated unauth bucket', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();

    // Unauth limit is 30 requests/minute
    for (let i = 0; i < 30; i++) {
      expect(limiter.checkIpRateLimitUnauth('10.0.0.12')).toBe(false);
    }
    expect(limiter.checkIpRateLimitUnauth('10.0.0.12')).toBe(true);

    // Authenticated requests on the same IP are unaffected
    expect(limiter.checkIpRateLimit('10.0.0.12', false, 'key-1')).toBe(false);
  });

  it('unauth traffic does not block valid auth after failed requests (#2456 regression)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();

    // Simulate rapid failed auth attempts
    for (let i = 0; i < 5; i++) {
      limiter.recordAuthFailure('10.0.0.13');
    }
    expect(limiter.checkAuthFailRateLimit('10.0.0.13')).toBe(true);

    // Auth-fail rate limit does not affect IP rate limit for authenticated requests
    expect(limiter.checkIpRateLimit('10.0.0.13', false, 'valid-key')).toBe(false);

    // Unauth rate limit is separate
    expect(limiter.checkIpRateLimitUnauth('10.0.0.13')).toBe(false);
  });

  it('unauth bucket prunes correctly after time window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();

    for (let i = 0; i < 30; i++) {
      limiter.checkIpRateLimitUnauth('10.0.0.14');
    }
    expect(limiter.checkIpRateLimitUnauth('10.0.0.14')).toBe(true);

    vi.setSystemTime(61_000);
    limiter.pruneIpRateLimits();

    expect(limiter.checkIpRateLimitUnauth('10.0.0.14')).toBe(false);
  });
});
