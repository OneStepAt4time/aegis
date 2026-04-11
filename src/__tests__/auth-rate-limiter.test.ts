import { describe, it, expect, vi, afterEach } from 'vitest';
import { RateLimiter } from '../services/auth/index.js';

describe('RateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('enforces and resets auth-failure limits per IP', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new RateLimiter();

    for (let i = 0; i < 5; i++) {
      expect(limiter.checkAuthFailRateLimit('10.0.0.1')).toBe(false);
    }
    expect(limiter.checkAuthFailRateLimit('10.0.0.1')).toBe(true);

    vi.setSystemTime(61_000);
    expect(limiter.checkAuthFailRateLimit('10.0.0.1')).toBe(false);
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
});
