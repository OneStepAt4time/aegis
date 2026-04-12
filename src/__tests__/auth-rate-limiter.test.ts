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
});
