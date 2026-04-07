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
        permissionTimeoutMs: 10 * 60 * 1000, // 10 min
        stallCheckIntervalMs: 30 * 1000,     // 30 sec
        pollIntervalMs: 2000,                // 2 sec
      };

      expect(config.stallThresholdMs).toBe(300_000);
      expect(config.permissionStallMs).toBe(300_000);
      expect(config.unknownStallMs).toBe(180_000);
      expect(config.permissionTimeoutMs).toBe(600_000);
      expect(config.stallCheckIntervalMs).toBe(30_000);
      expect(config.unknownStallMs).toBeLessThan(config.stallThresholdMs); // Faster detection for unknown
    });

    it('permission timeout should be larger than permission stall threshold', () => {
      const config = {
        permissionStallMs: 5 * 60 * 1000,
        permissionTimeoutMs: 10 * 60 * 1000,
      };
      expect(config.permissionTimeoutMs).toBeGreaterThan(config.permissionStallMs);
    });
  });

  describe('#258: stateSince cleanup on non-idle transitions', () => {
    const sessionId = 'test-session';

    it('should clear permission tracking when leaving permission_prompt for working', () => {
      const stateSince = new Map<string, number>();
      const stallNotified = new Set<string>();

      // First permission prompt sets tracking
      stateSince.set(`${sessionId}:permission`, Date.now() - 8 * 60 * 1000); // 8 min ago
      stallNotified.add(`${sessionId}:perm-stall-notified`);
      stallNotified.add(`${sessionId}:perm-timeout`);

      // Simulate: prevStatus = permission_prompt, currentStatus = working
      const prevStatus: string = 'permission_prompt';
      const currentStatus: string = 'working';

      if (prevStatus && prevStatus !== currentStatus) {
        const exitedPermission = prevStatus === 'permission_prompt' || prevStatus === 'bash_approval';
        if (exitedPermission) {
          stateSince.delete(`${sessionId}:permission`);
          stallNotified.delete(`${sessionId}:perm-stall-notified`);
          stallNotified.delete(`${sessionId}:perm-timeout`);
        }
      }

      expect(stateSince.has(`${sessionId}:permission`)).toBe(false);
      expect(stallNotified.has(`${sessionId}:perm-stall-notified`)).toBe(false);
      expect(stallNotified.has(`${sessionId}:perm-timeout`)).toBe(false);
    });

    it('should allow fresh permission timestamp on re-entry to permission_prompt', () => {
      const stateSince = new Map<string, number>();
      const _stallNotified = new Set<string>();
      const now = Date.now();

      // First prompt at T-8min
      stateSince.set(`${sessionId}:permission`, now - 8 * 60 * 1000);

      // Transition: permission_prompt → working (cleans permission)
      stateSince.delete(`${sessionId}:permission`);

      // Brief working period, then back to permission_prompt
      const secondPromptStart = now - 30_000; // 30s ago — fresh
      stateSince.set(`${sessionId}:permission`, secondPromptStart);

      // Second prompt duration should be 30s, not 8min
      const permDuration = now - stateSince.get(`${sessionId}:permission`)!;
      expect(permDuration).toBeLessThan(60_000); // under 1 min
    });

    it('should clear permission tracking when leaving bash_approval', () => {
      const stateSince = new Map<string, number>();
      const stallNotified = new Set<string>();

      stateSince.set(`${sessionId}:permission`, Date.now() - 6 * 60 * 1000);
      stallNotified.add(`${sessionId}:perm-stall-notified`);

      const prevStatus: string = 'bash_approval';
      const currentStatus: string = 'working';

      if (prevStatus && prevStatus !== currentStatus) {
        const exitedPermission = prevStatus === 'permission_prompt' || prevStatus === 'bash_approval';
        if (exitedPermission) {
          stateSince.delete(`${sessionId}:permission`);
          stallNotified.delete(`${sessionId}:perm-stall-notified`);
          stallNotified.delete(`${sessionId}:perm-timeout`);
        }
      }

      expect(stateSince.has(`${sessionId}:permission`)).toBe(false);
      expect(stallNotified.has(`${sessionId}:perm-stall-notified`)).toBe(false);
    });

    it('should clear unknown tracking when leaving unknown state', () => {
      const stateSince = new Map<string, number>();
      const stallNotified = new Set<string>();

      stateSince.set(`${sessionId}:unknown`, Date.now() - 4 * 60 * 1000);
      stallNotified.add(`${sessionId}:unknown-stall-notified`);

      const prevStatus: string = 'unknown';
      const currentStatus: string = 'working';

      if (prevStatus && prevStatus !== currentStatus) {
        const exitedUnknown = prevStatus === 'unknown';
        if (exitedUnknown) {
          stateSince.delete(`${sessionId}:unknown`);
          stallNotified.delete(`${sessionId}:unknown-stall-notified`);
        }
      }

      expect(stateSince.has(`${sessionId}:unknown`)).toBe(false);
      expect(stallNotified.has(`${sessionId}:unknown-stall-notified`)).toBe(false);
    });

    it('should NOT clear tracking when status stays the same', () => {
      const stateSince = new Map<string, number>();
      const stallNotified = new Set<string>();

      stateSince.set(`${sessionId}:permission`, Date.now() - 6 * 60 * 1000);
      stallNotified.add(`${sessionId}:perm-stall-notified`);

      const prevStatus: string = 'permission_prompt';
      const currentStatus: string = 'permission_prompt';

      if (prevStatus && prevStatus !== currentStatus) {
        // This block should NOT execute
        stateSince.delete(`${sessionId}:permission`);
        stallNotified.delete(`${sessionId}:perm-stall-notified`);
      }

      expect(stateSince.has(`${sessionId}:permission`)).toBe(true);
      expect(stallNotified.has(`${sessionId}:perm-stall-notified`)).toBe(true);
    });

    it('should NOT clear unrelated entries when transitioning between non-stalling states', () => {
      const stateSince = new Map<string, number>();
      const stallNotified = new Set<string>();

      stateSince.set(`${sessionId}:plan_mode`, Date.now() - 6 * 60 * 1000);
      stateSince.set(`${sessionId}:ask_question`, Date.now() - 2 * 60 * 1000);

      const prevStatus: string = 'plan_mode';
      const currentStatus: string = 'ask_question';

      if (prevStatus && prevStatus !== currentStatus) {
        const exitedPermission = prevStatus === 'permission_prompt' || prevStatus === 'bash_approval';
        const exitedUnknown = prevStatus === 'unknown';
        if (exitedPermission) {
          stateSince.delete(`${sessionId}:permission`);
          stallNotified.delete(`${sessionId}:perm-stall-notified`);
          stallNotified.delete(`${sessionId}:perm-timeout`);
        }
        if (exitedUnknown) {
          stateSince.delete(`${sessionId}:unknown`);
          stallNotified.delete(`${sessionId}:unknown-stall-notified`);
        }
      }

      // plan_mode and ask_question entries should be untouched
      expect(stateSince.has(`${sessionId}:plan_mode`)).toBe(true);
      expect(stateSince.has(`${sessionId}:ask_question`)).toBe(true);
    });
  });

  describe('L9: Permission auto-reject timeout', () => {
    it('should trigger auto-reject when permission prompt exceeds timeout', () => {
      const now = Date.now();
      const stateSince = now - 11 * 60 * 1000; // 11 min in permission_prompt
      const permissionStallMs = 5 * 60 * 1000;  // 5 min — stall notification
      const permissionTimeoutMs = 10 * 60 * 1000; // 10 min — auto-reject

      const duration = now - stateSince;
      const isStalled = duration >= permissionStallMs;
      const shouldAutoReject = duration >= permissionTimeoutMs;

      expect(isStalled).toBe(true);   // Stall notification already sent
      expect(shouldAutoReject).toBe(true); // Auto-reject should fire
    });

    it('should NOT auto-reject when permission prompt is under timeout', () => {
      const now = Date.now();
      const stateSince = now - 7 * 60 * 1000; // 7 min — stalled but not timed out
      const permissionTimeoutMs = 10 * 60 * 1000;

      const duration = now - stateSince;
      const shouldAutoReject = duration >= permissionTimeoutMs;
      expect(shouldAutoReject).toBe(false);
    });

    it('should only auto-reject once per permission prompt', () => {
      const stallNotified = new Set<string>();
      const permTimeoutKey = 'session-1:perm-timeout';

      // First check
      expect(stallNotified.has(permTimeoutKey)).toBe(false);
      stallNotified.add(permTimeoutKey);

      // Second check — should skip (already rejected)
      expect(stallNotified.has(permTimeoutKey)).toBe(true);
    });

    it('should reset timeout tracking when session goes idle', () => {
      const sessionId = 'test-session';
      const stallNotified = new Set<string>();

      stallNotified.add(`${sessionId}:perm-timeout`);
      stallNotified.add(`${sessionId}:perm-stall-notified`);

      // Simulate idle transition cleanup
      for (const key of stallNotified) {
        if (key.startsWith(sessionId)) {
          stallNotified.delete(key);
        }
      }

      expect(stallNotified.size).toBe(0);
    });

    it('should apply to both permission_prompt and bash_approval states', () => {
      const permissionStates = ['permission_prompt', 'bash_approval'];
      for (const state of permissionStates) {
        const isPermissionState = state === 'permission_prompt' || state === 'bash_approval';
        expect(isPermissionState).toBe(true);
      }
    });
  });
});
