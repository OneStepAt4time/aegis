/**
 * fix-3072-auth-rate-limit-reset.test.ts — Issue #3072:
 * Auth failure rate limit should reset on successful auth.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter } from '../services/auth/RateLimiter.js';

describe('Auth fail rate limit reset on success (#3072)', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it('should not be rate-limited after 4 failures', () => {
    for (let i = 0; i < 4; i++) {
      limiter.recordAuthFailure('1.2.3.4');
    }
    expect(limiter.checkAuthFailRateLimit('1.2.3.4')).toBe(false);
  });

  it('should be rate-limited after 5 failures', () => {
    for (let i = 0; i < 5; i++) {
      limiter.recordAuthFailure('1.2.3.4');
    }
    expect(limiter.checkAuthFailRateLimit('1.2.3.4')).toBe(true);
  });

  it('should reset failure counter on successful auth', () => {
    // Accumulate 4 failures (just under the limit)
    for (let i = 0; i < 4; i++) {
      limiter.recordAuthFailure('1.2.3.4');
    }
    expect(limiter.checkAuthFailRateLimit('1.2.3.4')).toBe(false);

    // Successful auth resets the counter
    limiter.resetAuthFailures('1.2.3.4');

    // Now 4 more failures should NOT trigger the limit (counter was reset)
    for (let i = 0; i < 4; i++) {
      limiter.recordAuthFailure('1.2.3.4');
    }
    expect(limiter.checkAuthFailRateLimit('1.2.3.4')).toBe(false);
  });

  it('should allow full 5 attempts after reset', () => {
    // 4 failures
    for (let i = 0; i < 4; i++) {
      limiter.recordAuthFailure('1.2.3.4');
    }
    // Reset
    limiter.resetAuthFailures('1.2.3.4');
    // Now should tolerate 5 more
    for (let i = 0; i < 5; i++) {
      limiter.recordAuthFailure('1.2.3.4');
    }
    expect(limiter.checkAuthFailRateLimit('1.2.3.4')).toBe(true);
  });

  it('reset is idempotent and safe on unknown IPs', () => {
    expect(() => limiter.resetAuthFailures('unknown.ip')).not.toThrow();
    expect(limiter.checkAuthFailRateLimit('unknown.ip')).toBe(false);
  });

  it('different IPs have independent counters', () => {
    for (let i = 0; i < 5; i++) {
      limiter.recordAuthFailure('1.1.1.1');
    }
    expect(limiter.checkAuthFailRateLimit('1.1.1.1')).toBe(true);
    expect(limiter.checkAuthFailRateLimit('2.2.2.2')).toBe(false);

    limiter.resetAuthFailures('1.1.1.1');
    expect(limiter.checkAuthFailRateLimit('1.1.1.1')).toBe(false);
  });
});
