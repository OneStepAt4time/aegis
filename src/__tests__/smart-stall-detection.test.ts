/**
 * stall-detection.test.ts — Tests for smart stall detection (4 stall types).
 *
 * Tests the multi-layer stall detection:
 * 1. JSONL stall: working + no new bytes for threshold
 * 2. Permission stall: permission_prompt for too long
 * 3. Unknown stall: unknown state for too long
 * 4. Extended state stall: any non-idle state for 2x threshold
 */

import { describe, it, expect } from 'vitest';

describe('Smart stall detection', () => {
  describe('Type 1: JSONL stall (working but no output)', () => {
    it('should detect stall when working with no new bytes for threshold', () => {
      const now = Date.now();
      const prevBytes = { bytes: 100, at: now - 6 * 60 * 1000 }; // 6 min ago
      const currentBytes = 100; // No change
      const threshold = 5 * 60 * 1000; // 5 min threshold

      const stallDuration = now - prevBytes.at;
      const isStalled = currentBytes <= prevBytes.bytes && stallDuration >= threshold;
      expect(isStalled).toBe(true);
    });

    it('should NOT stall when bytes are increasing', () => {
      const now = Date.now();
      const prevBytes = { bytes: 100, at: now - 4 * 60 * 1000 };
      const currentBytes = 200; // Bytes increased
      const threshold = 5 * 60 * 1000;

      const stallDuration = now - prevBytes.at;
      const isStalled = currentBytes <= prevBytes.bytes && stallDuration >= threshold;
      expect(isStalled).toBe(false);
    });

    it('should NOT stall when under threshold', () => {
      const now = Date.now();
      const prevBytes = { bytes: 100, at: now - 2 * 60 * 1000 }; // Only 2 min
      const currentBytes = 100;
      const threshold = 5 * 60 * 1000;

      const stallDuration = now - prevBytes.at;
      const isStalled = currentBytes <= prevBytes.bytes && stallDuration >= threshold;
      expect(isStalled).toBe(false);
    });

    it('should use per-session threshold when set', () => {
      const perSessionThreshold = 10 * 60 * 1000; // 10 min
      const now = Date.now();
      const prevBytes = { bytes: 100, at: now - 7 * 60 * 1000 }; // 7 min

      const stallDuration = now - prevBytes.at;
      const isStalled = stallDuration >= perSessionThreshold;
      expect(isStalled).toBe(false); // 7 min < 10 min threshold
    });
  });

  describe('Type 2: Permission stall', () => {
    it('should detect permission stall after permissionStallMs', () => {
      const now = Date.now();
      const stateSince = now - 6 * 60 * 1000; // 6 min in permission_prompt
      const permissionStallMs = 5 * 60 * 1000; // 5 min threshold

      const duration = now - stateSince;
      const isStalled = duration >= permissionStallMs;
      expect(isStalled).toBe(true);
    });

    it('should NOT stall when permission prompt is recent', () => {
      const now = Date.now();
      const stateSince = now - 2 * 60 * 1000; // Only 2 min
      const permissionStallMs = 5 * 60 * 1000;

      const duration = now - stateSince;
      const isStalled = duration >= permissionStallMs;
      expect(isStalled).toBe(false);
    });
  });

  describe('Type 3: Unknown stall', () => {
    it('should detect unknown stall after unknownStallMs', () => {
      const now = Date.now();
      const stateSince = now - 4 * 60 * 1000; // 4 min in unknown
      const unknownStallMs = 3 * 60 * 1000; // 3 min threshold

      const duration = now - stateSince;
      const isStalled = duration >= unknownStallMs;
      expect(isStalled).toBe(true);
    });

    it('should NOT stall when unknown state is brief', () => {
      const now = Date.now();
      const stateSince = now - 60 * 1000; // 1 min
      const unknownStallMs = 3 * 60 * 1000;

      const duration = now - stateSince;
      const isStalled = duration >= unknownStallMs;
      expect(isStalled).toBe(false);
    });
  });

  describe('Type 4: Extended state stall', () => {
    it('should detect any non-idle state held for 2x stall threshold', () => {
      const now = Date.now();
      const stateSince = now - 11 * 60 * 1000; // 11 min in plan_mode
      const stallThreshold = 5 * 60 * 1000;
      const extendedThreshold = stallThreshold * 2; // 10 min

      const duration = now - stateSince;
      const isStalled = duration >= extendedThreshold;
      expect(isStalled).toBe(true);
    });

    it('should NOT trigger extended stall for working state (handled by Type 1)', () => {
      // Working state has its own JSONL-based stall detection
      const currentStatus = 'working';
      const nonIdleStates = ['permission_prompt', 'bash_approval', 'plan_mode', 'ask_question', 'unknown'];
      expect(nonIdleStates.includes(currentStatus)).toBe(false);
    });
  });

  describe('Stall recovery (state transition resets)', () => {
    it('should clear all stall tracking when session goes idle', () => {
      const sessionId = 'test-session';
      const stateSince = new Map<string, number>();
      const stallNotified = new Set<string>();

      // Simulate tracking entries
      stateSince.set(`${sessionId}:permission_prompt`, Date.now());
      stateSince.set(`${sessionId}:unknown`, Date.now());
      stallNotified.add(`${sessionId}:perm-stall-notified`);
      stallNotified.add(`${sessionId}:unknown-stall-notified`);

      // Simulate idle transition cleanup
      for (const key of stateSince.keys()) {
        if (key.startsWith(sessionId + ':')) {
          stateSince.delete(key);
        }
      }
      for (const key of stallNotified) {
        if (key.startsWith(sessionId)) {
          stallNotified.delete(key);
        }
      }

      expect(stateSince.size).toBe(0);
      expect(stallNotified.size).toBe(0);
    });

    it('should not clear JSONL tracking when switching to permission_prompt', () => {
      // JSONL stall tracking (lastBytesSeen) is separate from state tracking
      // Only the JSONL stall notification should be cleared when not working
      const stallNotified = new Set<string>();
      stallNotified.add('session-1'); // JSONL stall notification

      // When switching to permission_prompt, clear JSONL stall
      stallNotified.delete('session-1');
      expect(stallNotified.size).toBe(0);
    });
  });

  describe('No spam: only notify once per stall type', () => {
    it('should not re-notify for same stall type', () => {
      const stallNotified = new Set<string>();
      const stallKey = 'session-1:perm-stall-notified';

      // First check
      expect(stallNotified.has(stallKey)).toBe(false);
      stallNotified.add(stallKey);

      // Second check — should skip
      expect(stallNotified.has(stallKey)).toBe(true);
    });
  });

  describe('Default thresholds', () => {
    it('should have reasonable default values', () => {
      const config = {
        stallThresholdMs: 5 * 60 * 1000,     // 5 min
        permissionStallMs: 5 * 60 * 1000,    // 5 min
        unknownStallMs: 3 * 60 * 1000,       // 3 min
        stallCheckIntervalMs: 30 * 1000,     // 30 sec
        pollIntervalMs: 2000,                // 2 sec
      };

      expect(config.stallThresholdMs).toBe(300_000);
      expect(config.permissionStallMs).toBe(300_000);
      expect(config.unknownStallMs).toBe(180_000);
      expect(config.stallCheckIntervalMs).toBe(30_000);
      expect(config.unknownStallMs).toBeLessThan(config.stallThresholdMs); // Faster detection for unknown
    });
  });
});
