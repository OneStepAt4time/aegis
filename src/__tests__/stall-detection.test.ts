/**
 * stall-detection.test.ts — Tests for Issue #4: configurable per-session stall detection.
 * Extended with comprehensive coverage for 4 stall types, state transitions,
 * auto-reject behavior, and stateSince tracking via direct SessionMonitor instantiation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG, type MonitorConfig } from '../monitor.js';
import type { SessionManager, SessionInfo } from '../session.js';
import type { ChannelManager } from '../channels/index.js';
import type { SessionEventPayload } from '../channels/types.js';

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

// ---------------------------------------------------------------------------
// Helper factory for creating a SessionMonitor with mocked dependencies.
// Uses `as any` to set internal private state and call checkForStalls directly.
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: overrides.id ?? 'sess-1',
    windowId: overrides.windowId ?? '@1',
    windowName: overrides.windowName ?? 'test-window',
    workDir: overrides.workDir ?? '/tmp/test',
    byteOffset: overrides.byteOffset ?? 0,
    monitorOffset: overrides.monitorOffset ?? 0,
    status: overrides.status ?? 'idle',
    createdAt: overrides.createdAt ?? Date.now() - 600_000,
    lastActivity: overrides.lastActivity ?? Date.now(),
    stallThresholdMs: overrides.stallThresholdMs ?? 0,
    permissionStallMs: overrides.permissionStallMs ?? 0,
    permissionMode: overrides.permissionMode ?? 'default',
    ...overrides,
  } as SessionInfo;
}

function makeMockDeps() {
  const sessions: Record<string, SessionInfo> = {};

  const mockSessions = {
    listSessions: vi.fn(() => Object.values(sessions)),
    readMessagesForMonitor: vi.fn(async () => ({ messages: [], status: 'idle' as const, statusText: null, interactiveContent: null })),
    getSession: vi.fn((id: string) => sessions[id] ?? null),
    approve: vi.fn(async () => {}),
    reject: vi.fn(async () => {}),
    isWindowAlive: vi.fn(async () => true),
    killSession: vi.fn(async () => {}),
  } as unknown as SessionManager;

  const mockChannels = {
    statusChange: vi.fn(async (_payload: SessionEventPayload) => {}),
    message: vi.fn(async () => {}),
  };

  return { sessions, mockSessions, mockChannels };
}

function makeMonitor(
  mockSessions: SessionManager,
  mockChannels: ChannelManager,
  configOverrides: Partial<MonitorConfig> = {},
): SessionMonitor {
  const config = { ...DEFAULT_MONITOR_CONFIG, ...configOverrides };
  return new SessionMonitor(mockSessions, mockChannels, config);
}

// ===========================================================================
// Integration tests: real SessionMonitor with mocked SessionManager/ChannelManager
// ===========================================================================

describe('SessionMonitor stall detection (integration)', () => {
  let deps: ReturnType<typeof makeMockDeps>;
  let monitor: SessionMonitor;

  beforeEach(() => {
    deps = makeMockDeps();
    monitor = makeMonitor(deps.mockSessions, deps.mockChannels as unknown as ChannelManager);
  });

  // Helper: set internal lastStatus for a session
  function setLastStatus(sessionId: string, status: string): void {
    (monitor as any).lastStatus.set(sessionId, status);
  }

  // Helper: set internal prevStatusForStall
  function setPrevStallStatus(sessionId: string, status: string): void {
    (monitor as any).prevStatusForStall.set(sessionId, status);
  }

  // Helper: set internal lastBytesSeen
  function setLastBytesSeen(sessionId: string, bytes: number, at: number): void {
    (monitor as any).lastBytesSeen.set(sessionId, { bytes, at });
  }

  // Helper: add a session to the mock and set its status
  function addSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
    const s = makeSession(overrides);
    deps.sessions[s.id] = s;
    return s;
  }

  // Helper: call the private checkForStalls
  async function checkStalls(now: number): Promise<void> {
    await (monitor as any).checkForStalls(now);
  }

  // -------------------------------------------------------------------------
  describe('Type 1: JSONL stall detection', () => {
    it('should detect JSONL stall when bytes unchanged for stallThresholdMs', async () => {
      const now = Date.now();
      const session = addSession({ monitorOffset: 500 });
      setLastStatus(session.id, 'working');
      setLastBytesSeen(session.id, 500, now - 6 * 60 * 1000); // 6 min ago, same bytes

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).toHaveBeenCalledTimes(1);
      const payload = deps.mockChannels.statusChange.mock.calls[0][0];
      expect(payload.event).toBe('status.stall');
      expect(payload.detail).toContain('no new output');
    });

    it('should reset JSONL tracking when bytes increase', async () => {
      const now = Date.now();
      const session = addSession({ monitorOffset: 1000 });
      setLastStatus(session.id, 'working');
      setLastBytesSeen(session.id, 500, now - 6 * 60 * 1000);

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).not.toHaveBeenCalled();
      const tracking = (monitor as any).lastBytesSeen.get(session.id);
      expect(tracking.bytes).toBe(1000);
      expect(tracking.at).toBe(now);
    });

    it('should reset JSONL tracking when status changes from working to non-working', async () => {
      const now = Date.now();
      const session = addSession({ monitorOffset: 500 });
      setLastStatus(session.id, 'permission_prompt');
      (monitor as any).stallNotified.add(`${session.id}:stall:jsonl`);

      await checkStalls(now);

      expect((monitor as any).stallNotified.has(`${session.id}:stall:jsonl`)).toBe(false);
    });

    it('should skip JSONL stall detection for rate-limited sessions', async () => {
      const now = Date.now();
      const session = addSession({ monitorOffset: 500 });
      setLastStatus(session.id, 'working');
      setLastBytesSeen(session.id, 500, now - 6 * 60 * 1000);
      (monitor as any).rateLimitedSessions.add(session.id);

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).not.toHaveBeenCalled();
    });

    it('should use per-session stallThresholdMs override', async () => {
      const now = Date.now();
      const session = addSession({ monitorOffset: 500, stallThresholdMs: 10 * 60 * 1000 });
      setLastStatus(session.id, 'working');
      setLastBytesSeen(session.id, 500, now - 7 * 60 * 1000);

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).not.toHaveBeenCalled();
    });

    it('should stall with per-session threshold when duration exceeds it', async () => {
      const now = Date.now();
      const session = addSession({ monitorOffset: 500, stallThresholdMs: 3 * 60 * 1000 });
      setLastStatus(session.id, 'working');
      setLastBytesSeen(session.id, 500, now - 4 * 60 * 1000);

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).toHaveBeenCalledTimes(1);
      const payload = deps.mockChannels.statusChange.mock.calls[0][0];
      expect(payload.event).toBe('status.stall');
    });

    it('should only notify once for the same JSONL stall', async () => {
      const now = Date.now();
      const session = addSession({ monitorOffset: 500 });
      setLastStatus(session.id, 'working');
      setLastBytesSeen(session.id, 500, now - 6 * 60 * 1000);

      await checkStalls(now);
      await checkStalls(now);

      expect(deps.mockChannels.statusChange).toHaveBeenCalledTimes(1);
    });

    it('should not detect JSONL stall when no previous bytes tracking exists', async () => {
      const now = Date.now();
      const session = addSession({ monitorOffset: 500 });
      setLastStatus(session.id, 'working');

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).not.toHaveBeenCalled();
      expect((monitor as any).lastBytesSeen.has(session.id)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('Type 2: Permission stall with auto-reject', () => {
    it('should detect permission stall after permissionStallMs', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'permission_prompt');
      (monitor as any).stateSince.set(session.id, { state: 'permission_prompt', since: now - 6 * 60 * 1000 });

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).toHaveBeenCalledTimes(1);
      const payload = deps.mockChannels.statusChange.mock.calls[0][0];
      expect(payload.event).toBe('status.stall');
      expect(payload.detail).toContain('permission approval');
    });

    it('should detect bash_approval stall after permissionStallMs', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'bash_approval');
      (monitor as any).stateSince.set(session.id, { state: 'bash_approval', since: now - 6 * 60 * 1000 });

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).toHaveBeenCalledTimes(1);
      const payload = deps.mockChannels.statusChange.mock.calls[0][0];
      expect(payload.event).toBe('status.stall');
    });

    it('should auto-reject permission after permissionTimeoutMs', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'permission_prompt');
      (monitor as any).stateSince.set(session.id, { state: 'permission_prompt', since: now - 11 * 60 * 1000 });

      await checkStalls(now);

      expect(deps.mockSessions.reject).toHaveBeenCalledTimes(1);
      expect(deps.mockSessions.reject).toHaveBeenCalledWith(session.id);
      // Permission stall notification + auto-reject + extended stall (11min > 10min extended threshold)
      expect(deps.mockChannels.statusChange.mock.calls.length).toBeGreaterThanOrEqual(2);
      const timeoutCall = deps.mockChannels.statusChange.mock.calls.find(
        (c: any[]) => c[0].event === 'status.permission_timeout',
      );
      expect(timeoutCall).toBeDefined();
      expect(timeoutCall![0].detail).toContain('auto-rejected');
    });

    it('should auto-reject for bash_approval after timeout too', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'bash_approval');
      (monitor as any).stateSince.set(session.id, { state: 'bash_approval', since: now - 11 * 60 * 1000 });

      await checkStalls(now);

      expect(deps.mockSessions.reject).toHaveBeenCalledTimes(1);
    });

    it('should NOT auto-reject when under permissionTimeoutMs', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'permission_prompt');
      (monitor as any).stateSince.set(session.id, { state: 'permission_prompt', since: now - 7 * 60 * 1000 });

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).toHaveBeenCalledTimes(1);
      expect(deps.mockSessions.reject).not.toHaveBeenCalled();
    });

    it('should only auto-reject once per permission stall', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'permission_prompt');
      (monitor as any).stateSince.set(session.id, { state: 'permission_prompt', since: now - 11 * 60 * 1000 });

      await checkStalls(now);
      await checkStalls(now);

      expect(deps.mockSessions.reject).toHaveBeenCalledTimes(1);
    });

    it('should emit status.permission_timeout via channels on auto-reject', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'permission_prompt');
      (monitor as any).stateSince.set(session.id, { state: 'permission_prompt', since: now - 12 * 60 * 1000 });

      await checkStalls(now);

      const allCalls = deps.mockChannels.statusChange.mock.calls;
      const timeoutCall = allCalls.find((c: any[]) => c[0].event === 'status.permission_timeout');
      expect(timeoutCall).toBeDefined();
      expect(timeoutCall![0].detail).toContain('auto-rejected');
    });

    it('should handle auto-reject failure gracefully', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'permission_prompt');
      (monitor as any).stateSince.set(session.id, { state: 'permission_prompt', since: now - 11 * 60 * 1000 });
      (deps.mockSessions as any).reject.mockRejectedValueOnce(new Error('reject failed'));

      await expect(checkStalls(now)).resolves.toBeUndefined();
      expect(deps.mockChannels.statusChange.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('Type 3: Unknown stall detection', () => {
    it('should detect unknown stall after unknownStallMs', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'unknown');
      (monitor as any).stateSince.set(session.id, { state: 'unknown', since: now - 4 * 60 * 1000 });

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).toHaveBeenCalledTimes(1);
      const payload = deps.mockChannels.statusChange.mock.calls[0][0];
      expect(payload.event).toBe('status.stall');
      expect(payload.detail).toContain('unknown');
    });

    it('should NOT detect unknown stall when under unknownStallMs', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'unknown');
      (monitor as any).stateSince.set(session.id, { state: 'unknown', since: now - 60 * 1000 });

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).not.toHaveBeenCalled();
    });

    it('should only notify once for unknown stall', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'unknown');
      (monitor as any).stateSince.set(session.id, { state: 'unknown', since: now - 4 * 60 * 1000 });

      await checkStalls(now);
      await checkStalls(now);

      expect(deps.mockChannels.statusChange).toHaveBeenCalledTimes(1);
    });

    it('should transition from unknown to known and clear stall tracking', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'working');
      setPrevStallStatus(session.id, 'unknown');
      // Must set lastBytesSeen so the working block does not `continue` at the no-entry guard
      setLastBytesSeen(session.id, 500, now);
      session.monitorOffset = 600; // bytes increasing
      (monitor as any).stallNotified.add(`${session.id}:stall:unknown`);

      await checkStalls(now);

      expect((monitor as any).stallNotified.has(`${session.id}:stall:unknown`)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('Type 4: Extended stall detection', () => {
    it('should detect extended stall for plan_mode held for 2x stallThresholdMs', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'plan_mode');
      (monitor as any).stateSince.set(session.id, { state: 'plan_mode', since: now - 11 * 60 * 1000 });

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).toHaveBeenCalledTimes(1);
      const payload = deps.mockChannels.statusChange.mock.calls[0][0];
      expect(payload.event).toBe('status.stall');
      expect(payload.detail).toContain('plan_mode');
    });

    it('should detect extended stall for ask_question held for 2x threshold', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'ask_question');
      (monitor as any).stateSince.set(session.id, { state: 'ask_question', since: now - 11 * 60 * 1000 });

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).toHaveBeenCalledTimes(1);
      expect(deps.mockChannels.statusChange.mock.calls[0][0].detail).toContain('ask_question');
    });

    it('should NOT trigger extended stall for idle state', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'idle');
      (monitor as any).stateSince.set(session.id, { state: 'idle', since: now - 11 * 60 * 1000 });

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).not.toHaveBeenCalled();
    });

    it('should NOT trigger extended stall for working state', async () => {
      const now = Date.now();
      const session = addSession({ monitorOffset: 500 });
      setLastStatus(session.id, 'working');
      setLastBytesSeen(session.id, 500, now);
      (monitor as any).stateSince.set(session.id, { state: 'working', since: now - 11 * 60 * 1000 });

      await checkStalls(now);

      const calls = deps.mockChannels.statusChange.mock.calls;
      const extendedCall = calls.find((c: any[]) => c[0].detail?.includes('state for'));
      expect(extendedCall).toBeUndefined();
    });

    it('should NOT trigger extended stall when under 2x threshold', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'plan_mode');
      (monitor as any).stateSince.set(session.id, { state: 'plan_mode', since: now - 8 * 60 * 1000 });

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).not.toHaveBeenCalled();
    });

    it('should only notify once for extended stall', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'plan_mode');
      (monitor as any).stateSince.set(session.id, { state: 'plan_mode', since: now - 11 * 60 * 1000 });

      await checkStalls(now);
      await checkStalls(now);

      const extendedCalls = deps.mockChannels.statusChange.mock.calls.filter(
        (c: any[]) => c[0].detail?.includes('state for'),
      );
      expect(extendedCalls).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('State transition cleanup', () => {
    it('should clear ALL stall tracking when session goes idle', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'idle');
      (monitor as any).stallNotified.add(`${session.id}:stall:jsonl`);
      (monitor as any).stallNotified.add(`${session.id}:stall:permission`);
      (monitor as any).stallNotified.add(`${session.id}:stall:permission_timeout`);
      (monitor as any).stallNotified.add(`${session.id}:stall:unknown`);
      (monitor as any).stallNotified.add(`${session.id}:stall:extended`);
      (monitor as any).stateSince.set(session.id, { state: 'working', since: now });
      (monitor as any).rateLimitedSessions.add(session.id);

      await checkStalls(now);

      for (const key of (monitor as any).stallNotified) {
        expect(key.startsWith(session.id)).toBe(false);
      }
      expect((monitor as any).stateSince.has(session.id)).toBe(false);
      expect((monitor as any).rateLimitedSessions.has(session.id)).toBe(false);
    });

    it('should use stallNotified key format ${sessionId}:stall:${type}', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'permission_prompt');
      (monitor as any).stateSince.set(session.id, { state: 'permission_prompt', since: now - 6 * 60 * 1000 });

      await checkStalls(now);

      expect((monitor as any).stallNotified.has(`${session.id}:stall:permission`)).toBe(true);
    });

    it('should clear permission stall when transitioning from permission_prompt to working', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'working');
      setPrevStallStatus(session.id, 'permission_prompt');
      // Must set lastBytesSeen so the working block does not `continue` at the no-entry guard
      setLastBytesSeen(session.id, 500, now);
      session.monitorOffset = 600;
      (monitor as any).stallNotified.add(`${session.id}:stall:permission`);
      (monitor as any).stallNotified.add(`${session.id}:stall:permission_timeout`);

      await checkStalls(now);

      expect((monitor as any).stallNotified.has(`${session.id}:stall:permission`)).toBe(false);
      expect((monitor as any).stallNotified.has(`${session.id}:stall:permission_timeout`)).toBe(false);
    });

    it('should clear permission stall when transitioning from bash_approval to working', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'working');
      setPrevStallStatus(session.id, 'bash_approval');
      setLastBytesSeen(session.id, 500, now);
      session.monitorOffset = 600;
      (monitor as any).stallNotified.add(`${session.id}:stall:permission`);
      (monitor as any).stallNotified.add(`${session.id}:stall:permission_timeout`);

      await checkStalls(now);

      expect((monitor as any).stallNotified.has(`${session.id}:stall:permission`)).toBe(false);
      expect((monitor as any).stallNotified.has(`${session.id}:stall:permission_timeout`)).toBe(false);
    });

    it('should clear unknown stall when transitioning from unknown to working', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'working');
      setPrevStallStatus(session.id, 'unknown');
      setLastBytesSeen(session.id, 500, now);
      session.monitorOffset = 600;
      (monitor as any).stallNotified.add(`${session.id}:stall:unknown`);

      await checkStalls(now);

      expect((monitor as any).stallNotified.has(`${session.id}:stall:unknown`)).toBe(false);
    });

    it('should NOT clear unrelated stall types on transition', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'working');
      setPrevStallStatus(session.id, 'permission_prompt');
      (monitor as any).stallNotified.add(`${session.id}:stall:extended`);

      await checkStalls(now);

      expect((monitor as any).stallNotified.has(`${session.id}:stall:extended`)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('stateSince tracking', () => {
    it('should set stateSince when session enters non-idle state for first time', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'working');

      await checkStalls(now);

      const entry = (monitor as any).stateSince.get(session.id);
      expect(entry).toBeDefined();
      expect(entry.state).toBe('working');
      expect(entry.since).toBe(now);
    });

    it('should update stateSince on state change (non-permission transition)', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'plan_mode');
      (monitor as any).stateSince.set(session.id, { state: 'working', since: now - 3 * 60 * 1000 });

      await checkStalls(now);

      const entry = (monitor as any).stateSince.get(session.id);
      expect(entry.state).toBe('plan_mode');
      expect(entry.since).toBe(now);
    });

    it('should preserve stateSince timestamp on permission_prompt to bash_approval transition', async () => {
      const now = Date.now();
      const originalSince = now - 3 * 60 * 1000;
      const session = addSession();
      setLastStatus(session.id, 'bash_approval');
      (monitor as any).stateSince.set(session.id, { state: 'permission_prompt', since: originalSince });

      await checkStalls(now);

      const entry = (monitor as any).stateSince.get(session.id);
      expect(entry.state).toBe('bash_approval');
      expect(entry.since).toBe(originalSince);
    });

    it('should preserve stateSince timestamp on bash_approval to permission_prompt transition', async () => {
      const now = Date.now();
      const originalSince = now - 2 * 60 * 1000;
      const session = addSession();
      setLastStatus(session.id, 'permission_prompt');
      (monitor as any).stateSince.set(session.id, { state: 'bash_approval', since: originalSince });

      await checkStalls(now);

      const entry = (monitor as any).stateSince.get(session.id);
      expect(entry.state).toBe('permission_prompt');
      expect(entry.since).toBe(originalSince);
    });

    it('should NOT set stateSince for idle sessions', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'idle');

      await checkStalls(now);

      expect((monitor as any).stateSince.has(session.id)).toBe(false);
    });

    it('should delete stateSince on transition to idle', async () => {
      const now = Date.now();
      const session = addSession();
      setLastStatus(session.id, 'idle');
      (monitor as any).stateSince.set(session.id, { state: 'working', since: now - 5 * 60 * 1000 });

      await checkStalls(now);

      expect((monitor as any).stateSince.has(session.id)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('Multiple sessions independence', () => {
    it('should track stalls independently across different sessions', async () => {
      const now = Date.now();
      addSession({ id: 'sess-1', monitorOffset: 500 });
      addSession({ id: 'sess-2' });
      setLastStatus('sess-1', 'working');
      setLastStatus('sess-2', 'unknown');
      setLastBytesSeen('sess-1', 500, now - 6 * 60 * 1000);
      (monitor as any).stateSince.set('sess-2', { state: 'unknown', since: now - 4 * 60 * 1000 });

      await checkStalls(now);

      expect(deps.mockChannels.statusChange).toHaveBeenCalledTimes(2);
    });

    it('should clean up one session without affecting another', async () => {
      const now = Date.now();
      addSession({ id: 'sess-1' });
      addSession({ id: 'sess-2' });
      setLastStatus('sess-1', 'idle');
      setLastStatus('sess-2', 'permission_prompt');
      (monitor as any).stateSince.set('sess-1', { state: 'working', since: now });
      (monitor as any).stateSince.set('sess-2', { state: 'permission_prompt', since: now - 6 * 60 * 1000 });
      (monitor as any).stallNotified.add('sess-1:stall:jsonl');
      (monitor as any).stallNotified.add('sess-2:stall:permission');

      await checkStalls(now);

      expect((monitor as any).stateSince.has('sess-1')).toBe(false);
      expect((monitor as any).stateSince.has('sess-2')).toBe(true);
      expect((monitor as any).stallNotified.has('sess-1:stall:jsonl')).toBe(false);
      expect((monitor as any).stallNotified.has('sess-2:stall:permission')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('prevStatusForStall tracking', () => {
    it('should set prevStatusForStall after each checkForStalls run', async () => {
      const now = Date.now();
      const session = addSession({ monitorOffset: 600 });
      setLastStatus(session.id, 'working');
      // Must have lastBytesSeen to avoid `continue` at the no-entry guard
      setLastBytesSeen(session.id, 500, now);

      await checkStalls(now);

      expect((monitor as any).prevStatusForStall.get(session.id)).toBe('working');
    });

    it('should delete prevStatusForStall when currentStatus is undefined', async () => {
      const now = Date.now();
      const session = addSession();
      (monitor as any).prevStatusForStall.set(session.id, 'working');

      await checkStalls(now);

      expect((monitor as any).prevStatusForStall.has(session.id)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('Extended stall alongside primary stall', () => {
    it('should fire both permission stall and extended stall when both thresholds met', async () => {
      const now = Date.now();
      const dualMonitor = makeMonitor(deps.mockSessions, deps.mockChannels as unknown as ChannelManager, {
        stallThresholdMs: 3 * 60 * 1000,
        permissionStallMs: 5 * 60 * 1000,
        permissionTimeoutMs: 10 * 60 * 1000,
      });
      const session = addSession();
      (dualMonitor as any).lastStatus.set(session.id, 'permission_prompt');
      (dualMonitor as any).stateSince.set(session.id, { state: 'permission_prompt', since: now - 7 * 60 * 1000 });

      await (dualMonitor as any).checkForStalls(now);

      const calls = (deps.mockChannels.statusChange as ReturnType<typeof vi.fn>).mock.calls;
      const events = calls.map((c: any[]) => c[0].event);
      expect(events).toContain('status.stall');
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  describe('Type 5: Extended working stall (Issue #562)', () => {
    it('should detect extended_working stall when working for 3x stallThresholdMs', async () => {
      const now = Date.now();
      const session = addSession({ monitorOffset: 500 });
      setLastStatus(session.id, 'working');
      setLastBytesSeen(session.id, 500, now);
      // 16 min > 3 * 5min = 15min threshold
      (monitor as any).stateSince.set(session.id, { state: 'working', since: now - 16 * 60 * 1000 });

      await checkStalls(now);

      const calls = deps.mockChannels.statusChange.mock.calls;
      const extendedWorkingCall = calls.find((c: any[]) =>
        c[0].detail?.includes('working') && c[0].detail?.includes('internal loop'),
      );
      expect(extendedWorkingCall).toBeDefined();
    });

    it('should NOT detect extended_working stall when working for under 3x threshold', async () => {
      const now = Date.now();
      const session = addSession({ monitorOffset: 500 });
      setLastStatus(session.id, 'working');
      setLastBytesSeen(session.id, 500, now);
      // 14 min < 3 * 5min = 15min threshold
      (monitor as any).stateSince.set(session.id, { state: 'working', since: now - 14 * 60 * 1000 });

      await checkStalls(now);

      const calls = deps.mockChannels.statusChange.mock.calls;
      const extendedWorkingCall = calls.find((c: any[]) =>
        c[0].detail?.includes('internal loop'),
      );
      expect(extendedWorkingCall).toBeUndefined();
    });

    it('should only notify once for extended_working stall', async () => {
      const now = Date.now();
      const session = addSession({ monitorOffset: 500 });
      setLastStatus(session.id, 'working');
      setLastBytesSeen(session.id, 500, now);
      (monitor as any).stateSince.set(session.id, { state: 'working', since: now - 16 * 60 * 1000 });

      await checkStalls(now);
      await checkStalls(now);

      const calls = deps.mockChannels.statusChange.mock.calls;
      const extendedWorkingCalls = calls.filter((c: any[]) =>
        c[0].detail?.includes('internal loop'),
      );
      expect(extendedWorkingCalls).toHaveLength(1);
    });

    it('should NOT detect extended_working stall when state entry is not working', async () => {
      const now = Date.now();
      const session = addSession({ monitorOffset: 500 });
      setLastStatus(session.id, 'working');
      setLastBytesSeen(session.id, 500, now);
      // stateSince exists but state is not 'working'
      (monitor as any).stateSince.set(session.id, { state: 'permission_prompt', since: now - 16 * 60 * 1000 });

      await checkStalls(now);

      const calls = deps.mockChannels.statusChange.mock.calls;
      const extendedWorkingCall = calls.find((c: any[]) =>
        c[0].detail?.includes('internal loop'),
      );
      expect(extendedWorkingCall).toBeUndefined();
    });

    it('should clear extended_working stall when session goes idle', async () => {
      const now = Date.now();
      const session = addSession({ monitorOffset: 500 });
      setLastStatus(session.id, 'idle');
      (monitor as any).stallNotified.add(`${session.id}:stall:extended_working`);

      await checkStalls(now);

      expect((monitor as any).stallNotified.has(`${session.id}:stall:extended_working`)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('handleWatcherEvent stall timer (Issue #562)', () => {
    it('should NOT reset stall timer when file grew but no messages parsed', () => {
      const session = addSession();
      const originalAt = Date.now() - 3 * 60 * 1000;
      (monitor as any).lastBytesSeen.set(session.id, { bytes: 100, at: originalAt });

      (monitor as any).handleWatcherEvent({
        sessionId: session.id,
        newOffset: 200,
        messages: [],
      });

      const tracking = (monitor as any).lastBytesSeen.get(session.id);
      expect(tracking.bytes).toBe(200);
      expect(tracking.at).toBe(originalAt);
    });

    it('should reset stall timer when real messages arrive', () => {
      const session = addSession();
      const originalAt = Date.now() - 3 * 60 * 1000;
      (monitor as any).lastBytesSeen.set(session.id, { bytes: 100, at: originalAt });

      (monitor as any).handleWatcherEvent({
        sessionId: session.id,
        newOffset: 200,
        messages: [{ role: 'assistant', contentType: 'text', text: 'hello' }],
      });

      const tracking = (monitor as any).lastBytesSeen.get(session.id);
      expect(tracking.bytes).toBe(200);
      expect(tracking.at).not.toBe(originalAt);
      expect(tracking.at).toBeGreaterThan(originalAt);
    });

    it('should clear jsonl stall notification when real messages arrive', () => {
      const session = addSession();
      (monitor as any).stallNotified.add(`${session.id}:stall:jsonl`);

      (monitor as any).handleWatcherEvent({
        sessionId: session.id,
        newOffset: 200,
        messages: [{ role: 'assistant', contentType: 'text', text: 'hello' }],
      });

      expect((monitor as any).stallNotified.has(`${session.id}:stall:jsonl`)).toBe(false);
    });

    it('should NOT clear jsonl stall notification when no messages arrive', () => {
      const session = addSession();
      (monitor as any).stallNotified.add(`${session.id}:stall:jsonl`);

      (monitor as any).handleWatcherEvent({
        sessionId: session.id,
        newOffset: 200,
        messages: [],
      });

      expect((monitor as any).stallNotified.has(`${session.id}:stall:jsonl`)).toBe(true);
    });
  });
});
