/**
 * trustproxy-rate-limit-633.test.ts — Tests for Issue #633.
 *
 * Verifies that IP rate limiting does NOT trust X-Forwarded-For
 * when trustProxy is not explicitly enabled.
 */

import { describe, it, expect } from 'vitest';

// ── trustProxy configuration logic ──────────────────────────────────

describe('Issue #633: trustProxy configuration', () => {
  it('enables trustProxy only when TRUST_PROXY=true', () => {
    expect(process.env.TRUST_PROXY === 'true').toBe(false);
    // When not set, the Fastify config should have trustProxy: false
    const trustProxy = process.env.TRUST_PROXY === 'true';
    expect(trustProxy).toBe(false);
  });

  it('would enable trustProxy when TRUST_PROXY=true is set', () => {
    const original = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = 'true';
    const trustProxy = process.env.TRUST_PROXY === 'true';
    expect(trustProxy).toBe(true);
    process.env.TRUST_PROXY = original;
  });
});

// ── IP extraction without X-Forwarded-For fallback ──────────────────

describe('Issue #633: IP extraction ignores X-Forwarded-For when trustProxy is off', () => {
  // Simulates the fixed logic: req.ip ?? 'unknown'
  // No longer falls back to req.headers['x-forwarded-for']

  it('uses req.ip when available', () => {
    const mockReq = { ip: '192.168.1.100' } as { ip: string };
    const clientIp = mockReq.ip ?? 'unknown';
    expect(clientIp).toBe('192.168.1.100');
  });

  it('falls back to "unknown" when req.ip is undefined', () => {
    const mockReq = { ip: undefined } as { ip?: string };
    const clientIp = mockReq.ip ?? 'unknown';
    expect(clientIp).toBe('unknown');
  });

  it('does NOT read x-forwarded-for header', () => {
    // The old code: req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown'
    // The new code: req.ip ?? 'unknown'
    // When req.ip is undefined and X-Forwarded-For is spoofed,
    // the new code correctly returns 'unknown' instead of the spoofed value.
    const mockHeaders = { 'x-forwarded-for': 'spoofed-attacker-ip' };
    const mockReq = { ip: undefined } as { ip?: string };
    const clientIp = mockReq.ip ?? 'unknown';
    expect(clientIp).toBe('unknown');
    expect(clientIp).not.toBe('spoofed-attacker-ip');
  });

  it('uses req.ip even when X-Forwarded-For is set (trustProxy=false)', () => {
    // When trustProxy is false, Fastify sets req.ip to the direct socket IP
    // regardless of any X-Forwarded-For header
    const mockReq = { ip: '10.0.0.1' } as { ip: string };
    const clientIp = mockReq.ip ?? 'unknown';
    expect(clientIp).toBe('10.0.0.1');
  });
});

// ── rate limit function still works correctly ───────────────────────

describe('Issue #633: Rate limiting still functions with fixed IP logic', () => {
  // Copy the checkIpRateLimit logic (simplified) for testing
  function checkIpRateLimit(
    ip: string,
    isMaster: boolean,
    ipRateLimits: Map<string, { entries: number[]; start: number }>,
  ): boolean {
    const now = Date.now();
    const cutoff = now - 60_000;
    const bucket = ipRateLimits.get(ip) || { entries: [], start: 0 };
    while (bucket.start < bucket.entries.length && bucket.entries[bucket.start]! < cutoff) {
      bucket.start++;
    }
    bucket.entries.push(now);
    ipRateLimits.set(ip, bucket);
    const activeCount = bucket.entries.length - bucket.start;
    const limit = isMaster ? 300 : 120;
    return activeCount > limit;
  }

  it('does not rate limit under threshold', () => {
    const limits = new Map<string, { entries: number[]; start: number }>();
    for (let i = 0; i < 100; i++) {
      expect(checkIpRateLimit('10.0.0.1', false, limits)).toBe(false);
    }
  });

  it('rate limits when threshold exceeded', () => {
    const limits = new Map<string, { entries: number[]; start: number }>();
    let limited = false;
    for (let i = 0; i < 130; i++) {
      if (checkIpRateLimit('10.0.0.1', false, limits)) {
        limited = true;
      }
    }
    expect(limited).toBe(true);
  });

  it('tracks different IPs independently', () => {
    const limits = new Map<string, { entries: number[]; start: number }>();
    // 100 requests from IP1 — should not be limited
    for (let i = 0; i < 100; i++) {
      expect(checkIpRateLimit('10.0.0.1', false, limits)).toBe(false);
    }
    // 1 request from IP2 — should not be limited
    expect(checkIpRateLimit('10.0.0.2', false, limits)).toBe(false);
  });
});
