/**
 * ip-rate-limiter.test.ts — Tests for Issue #844: max-IP cap on ipRateLimits map.
 *
 * Also covers the core per-IP rate limiting logic (#228, #622) extracted from server.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IpRateLimiter, MAX_TRACKED_IPS, IP_LIMIT_NORMAL, IP_LIMIT_MASTER, IP_WINDOW_MS } from '../ip-rate-limiter.js';

describe('IpRateLimiter', () => {
  let limiter: IpRateLimiter;

  beforeEach(() => {
    limiter = new IpRateLimiter();
  });

  // ── Core rate limiting (#228, #622) ──────────────────────────────────
  describe('basic rate limiting', () => {
    it('allows requests under the limit', () => {
      for (let i = 0; i < IP_LIMIT_NORMAL; i++) {
        expect(limiter.check('1.2.3.4', false)).toBe(false);
      }
    });

    it('blocks requests over the normal limit', () => {
      for (let i = 0; i < IP_LIMIT_NORMAL; i++) {
        limiter.check('1.2.3.4', false);
      }
      expect(limiter.check('1.2.3.4', false)).toBe(true);
    });

    it('allows higher limit for master token', () => {
      for (let i = 0; i < IP_LIMIT_NORMAL; i++) {
        limiter.check('1.2.3.4', true);
      }
      // Normal limit would block, but master has higher limit
      expect(limiter.check('1.2.3.4', false)).toBe(true); // normal limit exceeded
      expect(limiter.check('1.2.3.4', true)).toBe(false);  // master limit not yet reached
    });

    it('blocks requests over the master limit', () => {
      for (let i = 0; i < IP_LIMIT_MASTER; i++) {
        limiter.check('1.2.3.4', true);
      }
      expect(limiter.check('1.2.3.4', true)).toBe(true);
    });

    it('tracks IPs independently', () => {
      for (let i = 0; i < IP_LIMIT_NORMAL; i++) {
        limiter.check('1.2.3.4', false);
      }
      expect(limiter.check('1.2.3.4', false)).toBe(true);
      expect(limiter.check('5.6.7.8', false)).toBe(false);
    });

    it('resets after the window expires', () => {
      vi.useFakeTimers();
      for (let i = 0; i < IP_LIMIT_NORMAL; i++) {
        limiter.check('1.2.3.4', false);
      }
      expect(limiter.check('1.2.3.4', false)).toBe(true);

      // Advance past the window
      vi.advanceTimersByTime(IP_WINDOW_MS + 1);
      expect(limiter.check('1.2.3.4', false)).toBe(false);
      vi.useRealTimers();
    });
  });

  // ── #844: Max tracked IPs cap ───────────────────────────────────────
  describe('max tracked IPs cap (#844)', () => {
    it('enforces MAX_TRACKED_IPS cap', () => {
      // Fill up to the cap
      for (let i = 0; i < MAX_TRACKED_IPS; i++) {
        limiter.check(`${i}.0.0.1`, false);
      }
      expect(limiter.size).toBe(MAX_TRACKED_IPS);

      // Adding one more should NOT exceed the cap
      limiter.check('255.0.0.1', false);
      expect(limiter.size).toBe(MAX_TRACKED_IPS);
    });

    it('evicts least-recently-used IP when cap is reached', () => {
      // Add IP "1.0.0.1" first (it should be evicted)
      limiter.check('1.0.0.1', false);
      // Fill the rest with other IPs
      for (let i = 1; i < MAX_TRACKED_IPS; i++) {
        limiter.check(`${i + 1}.0.0.1`, false);
      }
      expect(limiter.size).toBe(MAX_TRACKED_IPS);

      // Adding a new IP should evict "1.0.0.1" (oldest lastUsedAt)
      limiter.check('255.0.0.1', false);
      expect(limiter.size).toBe(MAX_TRACKED_IPS);

      // "1.0.0.1" should have been evicted, so it starts fresh
      // It should only have 1 entry now, well under the limit
      expect(limiter.check('1.0.0.1', false)).toBe(false);
    });

    it('does not evict existing IPs when updating', () => {
      // Add an IP, then re-check it — size should not grow
      limiter.check('1.2.3.4', false);
      expect(limiter.size).toBe(1);
      limiter.check('1.2.3.4', false);
      expect(limiter.size).toBe(1);
    });

    it('evicts the correct LRU IP when multiple candidates exist', () => {
      // Add IPs in order: first will have oldest lastUsedAt
      const ips = ['10.0.0.1', '10.0.0.2', '10.0.0.3'];
      for (const ip of ips) {
        limiter.check(ip, false);
      }
      // Update lastUsedAt for 10.0.0.2 and 10.0.0.3 but not 10.0.0.1
      limiter.check('10.0.0.2', false);
      limiter.check('10.0.0.3', false);

      // Fill to cap
      for (let i = 4; i <= MAX_TRACKED_IPS; i++) {
        limiter.check(`10.0.0.${i}`, false);
      }

      // Add one more — should evict 10.0.0.1 (least recently used)
      limiter.check('10.1.0.1', false);
      expect(limiter.size).toBe(MAX_TRACKED_IPS);

      // 10.0.0.1 was evicted — fresh start, under limit
      expect(limiter.check('10.0.0.1', false)).toBe(false);
    });
  });

  // ── Prune stale entries (#357) ──────────────────────────────────────
  describe('prune', () => {
    it('removes IPs with no recent activity', () => {
      vi.useFakeTimers();
      limiter.check('1.2.3.4', false);
      expect(limiter.size).toBe(1);

      // Advance past the window
      vi.advanceTimersByTime(IP_WINDOW_MS + 1);
      limiter.prune();
      expect(limiter.size).toBe(0);
      vi.useRealTimers();
    });

    it('keeps IPs with recent activity', () => {
      vi.useFakeTimers();
      limiter.check('1.2.3.4', false);
      vi.advanceTimersByTime(IP_WINDOW_MS / 2);
      limiter.check('1.2.3.4', false); // refresh activity

      vi.advanceTimersByTime(IP_WINDOW_MS / 2 + 1);
      limiter.prune();
      expect(limiter.size).toBe(1); // still active
      vi.useRealTimers();
    });

    it('prunes multiple stale IPs', () => {
      vi.useFakeTimers();
      limiter.check('1.2.3.4', false);
      limiter.check('5.6.7.8', false);
      limiter.check('9.10.11.12', false);
      expect(limiter.size).toBe(3);

      vi.advanceTimersByTime(IP_WINDOW_MS + 1);
      limiter.prune();
      expect(limiter.size).toBe(0);
      vi.useRealTimers();
    });
  });
});
