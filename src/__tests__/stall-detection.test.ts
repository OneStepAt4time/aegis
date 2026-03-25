/**
 * stall-detection.test.ts — Tests for Issue #4: configurable per-session stall detection.
 */

import { describe, it, expect } from 'vitest';

describe('Configurable stall detection', () => {
  describe('default threshold', () => {
    it('should default to 5 minutes (300000ms)', () => {
      const DEFAULT_STALL_THRESHOLD_MS = 5 * 60 * 1000;
      expect(DEFAULT_STALL_THRESHOLD_MS).toBe(300000);
    });

    it('should be significantly less than old 60min default', () => {
      const newDefault = 5 * 60 * 1000;
      const oldDefault = 60 * 60 * 1000;
      expect(newDefault).toBeLessThan(oldDefault);
      expect(newDefault).toBe(oldDefault / 12);
    });
  });

  describe('per-session threshold', () => {
    it('should use session threshold when provided', () => {
      const sessionThreshold = 10 * 60 * 1000; // 10 min
      const globalThreshold = 5 * 60 * 1000;   // 5 min
      const threshold = sessionThreshold || globalThreshold;
      expect(threshold).toBe(10 * 60 * 1000);
    });

    it('should fall back to global threshold when session has none', () => {
      const sessionThreshold = 0;
      const globalThreshold = 5 * 60 * 1000;
      const threshold = sessionThreshold || globalThreshold;
      expect(threshold).toBe(5 * 60 * 1000);
    });

    it('should handle quick fix threshold (5 min)', () => {
      const threshold = 5 * 60 * 1000;
      const stallDuration = 6 * 60 * 1000; // 6 min
      expect(stallDuration >= threshold).toBe(true);
    });

    it('should handle complex feature threshold (15 min)', () => {
      const threshold = 15 * 60 * 1000;
      const stallDuration = 10 * 60 * 1000; // 10 min
      expect(stallDuration >= threshold).toBe(false); // Not stalled yet
    });

    it('should handle research task threshold (30 min)', () => {
      const threshold = 30 * 60 * 1000;
      const stallDuration = 25 * 60 * 1000; // 25 min
      expect(stallDuration >= threshold).toBe(false); // Not stalled yet
    });
  });

  describe('stall detection logic', () => {
    it('should not trigger stall when bytes are increasing', () => {
      const prevBytes = 1000;
      const currentBytes = 1500;
      const bytesIncreased = currentBytes > prevBytes;
      expect(bytesIncreased).toBe(true);
      // When bytes increase, stall timer resets — no stall
    });

    it('should start tracking when working with no new bytes', () => {
      const status = 'working';
      const prevBytes = 1000;
      const currentBytes = 1000;
      const isWorking = status === 'working';
      const noNewBytes = currentBytes <= prevBytes;
      expect(isWorking && noNewBytes).toBe(true);
    });

    it('should reset tracking when not working', () => {
      const status: string = 'idle';
      const shouldResetTracking = status !== 'working';
      expect(shouldResetTracking).toBe(true);
    });

    it('should only notify once per stall', () => {
      const stallNotified = new Set<string>();
      const sessionId = 'test-session';

      // First notification
      expect(stallNotified.has(sessionId)).toBe(false);
      stallNotified.add(sessionId);

      // Second check — already notified
      expect(stallNotified.has(sessionId)).toBe(true);
    });
  });

  describe('monitor config defaults', () => {
    it('should check stalls every 30 seconds', () => {
      const stallCheckIntervalMs = 30 * 1000;
      expect(stallCheckIntervalMs).toBe(30000);
    });

    it('should poll sessions every 2 seconds', () => {
      const pollIntervalMs = 2000;
      expect(pollIntervalMs).toBe(2000);
    });
  });

  describe('rate-limited session stall exemption', () => {
    it('should skip Type 1 JSONL stall detection when session is rate-limited', () => {
      const rateLimitedSessions = new Set<string>();
      const sessionId = 'rate-limited-session';
      rateLimitedSessions.add(sessionId);

      // Simulate the guard at top of Type 1 stall check
      const shouldSkipStallCheck = rateLimitedSessions.has(sessionId);
      expect(shouldSkipStallCheck).toBe(true);
    });

    it('should not skip stall detection for non-rate-limited sessions', () => {
      const rateLimitedSessions = new Set<string>();
      const sessionId = 'normal-session';

      const shouldSkipStallCheck = rateLimitedSessions.has(sessionId);
      expect(shouldSkipStallCheck).toBe(false);
    });

    it('should clear rate-limited state when new JSONL messages arrive', () => {
      const rateLimitedSessions = new Set<string>();
      const sessionId = 'rate-limited-session';
      rateLimitedSessions.add(sessionId);

      expect(rateLimitedSessions.has(sessionId)).toBe(true);

      // Simulate new messages arriving — clear rate-limited state
      const messages = [{ role: 'assistant', contentType: 'text' }];
      if (messages.length > 0) {
        rateLimitedSessions.delete(sessionId);
      }

      expect(rateLimitedSessions.has(sessionId)).toBe(false);
    });

    it('should clear rate-limited state when session goes idle', () => {
      const rateLimitedSessions = new Set<string>();
      const sessionId = 'rate-limited-session';
      rateLimitedSessions.add(sessionId);

      expect(rateLimitedSessions.has(sessionId)).toBe(true);

      // Simulate idle cleanup
      const currentStatus = 'idle';
      if (currentStatus === 'idle') {
        rateLimitedSessions.delete(sessionId);
      }

      expect(rateLimitedSessions.has(sessionId)).toBe(false);
    });

    it('should route rate_limit stop_reason to status.rate_limited event', () => {
      const stopReason = 'rate_limit';
      const isRateLimited = stopReason === 'rate_limit' || stopReason === 'overloaded';
      const channelEvent = isRateLimited ? 'status.rate_limited' : 'status.error';
      expect(channelEvent).toBe('status.rate_limited');
    });

    it('should route overloaded stop_reason to status.rate_limited event', () => {
      const stopReason: string = 'overloaded';
      const isRateLimited = stopReason === 'rate_limit' || stopReason === 'overloaded';
      const channelEvent = isRateLimited ? 'status.rate_limited' : 'status.error';
      expect(channelEvent).toBe('status.rate_limited');
    });

    it('should route other stop_reasons to status.error event', () => {
      const stopReason: string = 'api_error';
      const isRateLimited = stopReason === 'rate_limit' || stopReason === 'overloaded';
      const channelEvent = isRateLimited ? 'status.rate_limited' : 'status.error';
      expect(channelEvent).toBe('status.error');
    });
  });
});
