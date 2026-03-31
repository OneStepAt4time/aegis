/**
 * stall-threshold-392.test.ts — Tests for Issue #392:
 * Reduce default stall threshold from 5min to 2min, add env var override.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Issue #392: stall threshold defaults and env var override', () => {
  const originalEnv = process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS;

  beforeEach(() => {
    delete process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = originalEnv;
    } else {
      delete process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS;
    }
    vi.resetModules();
  });

  describe('default threshold', () => {
    it('SessionManager.DEFAULT_STALL_THRESHOLD_MS should be 120000 (2 minutes)', async () => {
      const { SessionManager } = await import('../session.js');
      expect(SessionManager.DEFAULT_STALL_THRESHOLD_MS).toBe(120_000);
    });

    it('DEFAULT_MONITOR_CONFIG.stallThresholdMs should be 120000 (2 minutes)', async () => {
      const { DEFAULT_MONITOR_CONFIG } = await import('../monitor.js');
      expect(DEFAULT_MONITOR_CONFIG.stallThresholdMs).toBe(120_000);
    });
  });

  describe('CLAUDE_STREAM_IDLE_TIMEOUT_MS env var override', () => {
    it('should use env var * 1.5 when result >= 120000', async () => {
      process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '100000';
      // 100000 * 1.5 = 150000, which is >= 120000
      const { SessionManager } = await import('../session.js');
      expect(SessionManager.DEFAULT_STALL_THRESHOLD_MS).toBe(150_000);
    });

    it('should clamp to 120000 when env var * 1.5 < 120000', async () => {
      process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '50000';
      // 50000 * 1.5 = 75000, but Math.max(120000, 75000) = 120000
      const { SessionManager } = await import('../session.js');
      expect(SessionManager.DEFAULT_STALL_THRESHOLD_MS).toBe(120_000);
    });

    it('should handle env var equal to 80000 (80000 * 1.5 = 120000)', async () => {
      process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '80000';
      const { SessionManager } = await import('../session.js');
      expect(SessionManager.DEFAULT_STALL_THRESHOLD_MS).toBe(120_000);
    });
  });
});
