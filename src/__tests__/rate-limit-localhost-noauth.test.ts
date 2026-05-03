/**
 * rate-limit-localhost-noauth.test.ts — Tests for Issue #2532.
 *
 * When Aegis runs on localhost with no auth configured, all requests
 * previously bypassed rate limiting entirely. Now per-IP rate limiting
 * is applied even in no-auth localhost mode.
 */

import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { RateLimiter } from '../services/auth/RateLimiter.js';

describe('Rate limiting in no-auth localhost mode (Issue #2532)', () => {
  it('RateLimiter.checkIpRateLimit returns false under threshold', () => {
    const limiter = new RateLimiter();
    const ip = '127.0.0.1';

    // Normal limit is 120/min — 50 requests should be fine
    for (let i = 0; i < 50; i++) {
      expect(limiter.checkIpRateLimit(ip, false)).toBe(false);
    }
  });

  it('RateLimiter.checkIpRateLimit returns true over threshold', () => {
    const limiter = new RateLimiter();
    const ip = '192.168.1.1';

    // Normal limit is 120/min — send 121 requests
    let exceeded = false;
    for (let i = 0; i < 130; i++) {
      if (limiter.checkIpRateLimit(ip, false)) {
        exceeded = true;
        break;
      }
    }
    expect(exceeded).toBe(true);
  });

  it('RateLimiter.checkIpRateLimitUnauth returns true over threshold', () => {
    const limiter = new RateLimiter();
    const ip = '10.0.0.1';

    // Unauth limit is 30/min — send 31 requests
    let exceeded = false;
    for (let i = 0; i < 35; i++) {
      if (limiter.checkIpRateLimitUnauth(ip)) {
        exceeded = true;
        break;
      }
    }
    expect(exceeded).toBe(true);
  });

  it('RateLimiter isolates authenticated and unauthenticated buckets', () => {
    const limiter = new RateLimiter();
    const ip = '127.0.0.1';

    // Exhaust unauthenticated bucket (30/min)
    for (let i = 0; i < 35; i++) {
      limiter.checkIpRateLimitUnauth(ip);
    }
    // Unauthenticated should be blocked
    expect(limiter.checkIpRateLimitUnauth(ip)).toBe(true);

    // Authenticated should still work (separate bucket)
    expect(limiter.checkIpRateLimit(ip, false, 'key-1')).toBe(false);
  });

  it('master token gets higher IP rate limit (300/min)', () => {
    const limiter = new RateLimiter();
    const ip = '127.0.0.1';

    // Normal limit is 120 — exhaust it
    for (let i = 0; i < 125; i++) {
      limiter.checkIpRateLimit(ip, false);
    }
    expect(limiter.checkIpRateLimit(ip, false)).toBe(true);

    // Master should still be under its 300 limit
    const masterIp = '127.0.0.2';
    for (let i = 0; i < 125; i++) {
      expect(limiter.checkIpRateLimit(masterIp, true)).toBe(false);
    }
  });
});
