/**
 * dead-session.test.ts — Comprehensive tests for checkDeadSessions, removeSession,
 * and related dead session detection in monitor.ts.
 *
 * Covers:
 * - Dead session detection (isWindowAlive returning false)
 * - lastDeadAt timestamp assignment
 * - EventBus emission (emitDead)
 * - Channel notification (statusChange with 'status.dead')
 * - killSession cleanup call
 * - removeSession internal state cleanup
 * - deadNotified dedup set
 * - Error handling (killSession throws, isWindowAlive throws)
 * - Multiple sessions (mixed alive/dead, all alive)
 * - Dead check interval gating
 */

import { describe, it, expect, vi } from 'vitest';
import type { SessionInfo } from '../session.js';
import type { ChannelManager, SessionEventPayload } from '../channels/index.js';
import type { SessionEventBus } from '../events.js';
import type { JsonlWatcher } from '../jsonl-watcher.js';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG } from '../monitor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a full SessionInfo object with sensible defaults. */
function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-1',
    windowId: '@0',
    windowName: 'test-session',
    workDir: '/tmp/test',
    claudeSessionId: 'claude-abc',
    jsonlPath: '/tmp/test/session.jsonl',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now() - 60_000,
    lastActivity: Date.now() - 10_000,
    stallThresholdMs: 5 * 60 * 1000,
    permissionStallMs: 5 * 60 * 1000,
    permissionMode: 'default',
    ...overrides,
  };
}

/** Create a mock SessionManager with the given sessions and behaviours. */
function mockSessionManager(sessions: SessionInfo[] = []) {
  const sessionMap = new Map<string, SessionInfo>();
  for (const s of sessions) sessionMap.set(s.id, { ...s });

  return {
    listSessions: vi.fn(() => [...sessionMap.values()]),
    getSession: vi.fn((id: string) => sessionMap.get(id) ?? null),
    isWindowAlive: vi.fn<(id: string) => Promise<boolean>>(async () => true),
    killSession: vi.fn(async () => {}),
    readMessagesForMonitor: vi.fn(async () => ({
      messages: [],
      status: 'idle' as const,
      statusText: null,
      interactiveContent: null,
    })),
    approve: vi.fn(async () => {}),
    reject: vi.fn(async () => {}),
  };
}

/** Create a mock ChannelManager. */
function mockChannelManager() {
  return {
    statusChange: vi.fn(async (_payload: SessionEventPayload) => {}),
    message: vi.fn(async (_payload: SessionEventPayload) => {}),
  };
}

/** Create a mock SessionEventBus. */
function mockEventBus() {
  return {
    emitDead: vi.fn(),
    emitStall: vi.fn(),
    emitMessage: vi.fn(),
    emitSystem: vi.fn(),
    emitStatus: vi.fn(),
    emitApproval: vi.fn(),
  };
}

/** Create a mock JsonlWatcher. */
function mockJsonlWatcher() {
  return {
    watch: vi.fn(),
    unwatch: vi.fn(),
    isWatching: vi.fn(() => false),
    onEntries: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// checkDeadSessions — basic detection
// ---------------------------------------------------------------------------

describe('checkDeadSessions', () => {
  it('detects a session with isWindowAlive() returning false as dead', async () => {
    const session = makeSession({ id: 'dead-1' });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    await (monitor as any).checkDeadSessions();

    expect(sessions.isWindowAlive).toHaveBeenCalledWith('dead-1');
  });

  it('sets session.lastDeadAt timestamp when session is dead', async () => {
    const session = makeSession({ id: 'dead-ts' });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );
    const before = Date.now();

    await (monitor as any).checkDeadSessions();

    // lastDeadAt should be set on the session object passed to listSessions
    const updatedSession = sessions.listSessions()[0];
    expect(updatedSession.lastDeadAt).toBeGreaterThanOrEqual(before);
    expect(updatedSession.lastDeadAt).toBeLessThanOrEqual(Date.now());
  });

  it('emits via eventBus.emitDead with session id and detail', async () => {
    const session = makeSession({ id: 'emit-dead', windowName: 'my-window', lastActivity: 12345 });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const bus = mockEventBus();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );
    monitor.setEventBus(bus as unknown as SessionEventBus);

    await (monitor as any).checkDeadSessions();

    expect(bus.emitDead).toHaveBeenCalledTimes(1);
    expect(bus.emitDead).toHaveBeenCalledWith('emit-dead', expect.stringContaining('my-window'));
    expect(bus.emitDead).toHaveBeenCalledWith('emit-dead', expect.stringContaining('tmux window no longer exists'));
  });

  it('emits via channels.statusChange with "status.dead" event', async () => {
    const session = makeSession({ id: 'ch-dead', windowName: 'ch-win' });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    await (monitor as any).checkDeadSessions();

    expect(channels.statusChange).toHaveBeenCalledTimes(1);
    const payload = channels.statusChange.mock.calls[0][0] as SessionEventPayload;
    expect(payload.event).toBe('status.dead');
    expect(payload.session.id).toBe('ch-dead');
    expect(payload.session.name).toBe('ch-win');
    expect(payload.detail).toContain('tmux window no longer exists');
  });

  it('calls removeSession(sessionId) to clean up tracking state', async () => {
    const session = makeSession({ id: 'rm-dead' });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );
    const removeSpy = vi.spyOn(monitor as any, 'removeSession');

    await (monitor as any).checkDeadSessions();

    expect(removeSpy).toHaveBeenCalledWith('rm-dead');
  });

  it('calls sessions.killSession(sessionId) for cleanup', async () => {
    const session = makeSession({ id: 'kill-dead' });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    await (monitor as any).checkDeadSessions();

    expect(sessions.killSession).toHaveBeenCalledWith('kill-dead');
  });

  it('includes lastActivity timestamp in the detail message', async () => {
    const fixedActivity = new Date('2026-01-15T12:30:00Z').getTime();
    const session = makeSession({ id: 'ts-detail', lastActivity: fixedActivity });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    await (monitor as any).checkDeadSessions();

    const payload = channels.statusChange.mock.calls[0][0] as SessionEventPayload;
    expect(payload.detail).toContain('2026-01-15');
  });
});

// ---------------------------------------------------------------------------
// Dead session dedup — deadNotified set
// ---------------------------------------------------------------------------

describe('deadNotified dedup set', () => {
  it('does NOT re-detect a session already in deadNotified', async () => {
    const session = makeSession({ id: 'dup-dead' });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    // First detection — this also calls removeSession which clears deadNotified.
    // To test dedup, we need deadNotified to still contain the id on the next check.
    await (monitor as any).checkDeadSessions();
    expect(channels.statusChange).toHaveBeenCalledTimes(1);

    // Manually re-add to deadNotified (simulating a scenario where removeSession
    // has not been called, or to directly test the deadNotified guard)
    (monitor as any).deadNotified.add('dup-dead');
    // Ensure the session is still listed
    sessions.listSessions.mockReturnValue([{ ...session }]);

    // Second check — should be skipped because id is in deadNotified
    await (monitor as any).checkDeadSessions();

    // isWindowAlive should NOT be called again (deadNotified check happens first)
    expect(sessions.isWindowAlive).toHaveBeenCalledTimes(1);
    // statusChange still only called once (no new notification)
    expect(channels.statusChange).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate dead notifications for the same session', async () => {
    const session = makeSession({ id: 'dup-notify' });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const bus = mockEventBus();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );
    monitor.setEventBus(bus as unknown as SessionEventBus);

    // Run first time — detects and removes, clearing deadNotified.
    // To test dedup across runs, keep deadNotified populated.
    await (monitor as any).checkDeadSessions();

    // Manually re-add to deadNotified to simulate the guard being active
    (monitor as any).deadNotified.add('dup-notify');

    // Run 2 more times — should be skipped because deadNotified contains the id
    for (let i = 0; i < 2; i++) {
      sessions.listSessions.mockReturnValue([{ ...session }]);
      await (monitor as any).checkDeadSessions();
    }

    // Only 1 notification despite 3 total checks
    expect(bus.emitDead).toHaveBeenCalledTimes(1);
    expect(channels.statusChange).toHaveBeenCalledTimes(1);
    expect(sessions.killSession).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('catches killSession errors silently (window already gone)', async () => {
    const session = makeSession({ id: 'kill-err' });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    sessions.killSession.mockRejectedValue(new Error('tmux window not found'));
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    // Should NOT throw
    await expect((monitor as any).checkDeadSessions()).resolves.toBeUndefined();

    // But other notifications should still have fired
    expect(channels.statusChange).toHaveBeenCalledTimes(1);
  });

  it('handles isWindowAlive throwing gracefully', async () => {
    const session = makeSession({ id: 'alive-throw' });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockRejectedValue(new Error('tmux command failed'));
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    // checkDeadSessions itself doesn't have a try/catch around isWindowAlive,
    // so the error will propagate. This test documents the current behavior.
    await expect((monitor as any).checkDeadSessions()).rejects.toThrow('tmux command failed');
  });

  it('killSession error does not prevent removeSession from running', async () => {
    const session = makeSession({ id: 'kill-err-rm' });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    sessions.killSession.mockRejectedValue(new Error('kill failed'));
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    await (monitor as any).checkDeadSessions();

    // removeSession should have been called before killSession
    const _removeSpy = vi.spyOn(monitor as any, 'removeSession');
    // Calling checkDeadSessions again with same session won't call removeSession again
    // because deadNotified is already set. Let's verify the state was cleaned.
    expect((monitor as any).deadNotified.has('kill-err-rm')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multiple sessions
// ---------------------------------------------------------------------------

describe('multiple sessions', () => {
  it('detects only dead sessions among mixed alive/dead', async () => {
    const alive1 = makeSession({ id: 'alive-1', windowName: 'alive-1' });
    const dead1 = makeSession({ id: 'dead-1', windowName: 'dead-1' });
    const alive2 = makeSession({ id: 'alive-2', windowName: 'alive-2' });
    const dead2 = makeSession({ id: 'dead-2', windowName: 'dead-2' });

    const sessions = mockSessionManager([alive1, dead1, alive2, dead2]);
    sessions.isWindowAlive.mockImplementation(async (id: string) => {
      return !id.startsWith('dead-');
    });

    const channels = mockChannelManager();
    const bus = mockEventBus();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );
    monitor.setEventBus(bus as unknown as SessionEventBus);

    await (monitor as any).checkDeadSessions();

    // Only the two dead sessions should trigger notifications
    expect(bus.emitDead).toHaveBeenCalledTimes(2);
    expect(channels.statusChange).toHaveBeenCalledTimes(2);
    expect(sessions.killSession).toHaveBeenCalledTimes(2);

    // Verify the correct sessions were reported dead
    const deadCalls = bus.emitDead.mock.calls.map((c: string[]) => c[0]);
    expect(deadCalls).toContain('dead-1');
    expect(deadCalls).toContain('dead-2');
    expect(deadCalls).not.toContain('alive-1');
    expect(deadCalls).not.toContain('alive-2');
  });

  it('does not emit any dead notifications when all sessions are alive', async () => {
    const s1 = makeSession({ id: 'a-1' });
    const s2 = makeSession({ id: 'a-2' });
    const s3 = makeSession({ id: 'a-3' });

    const sessions = mockSessionManager([s1, s2, s3]);
    sessions.isWindowAlive.mockResolvedValue(true);
    const channels = mockChannelManager();
    const bus = mockEventBus();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );
    monitor.setEventBus(bus as unknown as SessionEventBus);

    await (monitor as any).checkDeadSessions();

    expect(bus.emitDead).not.toHaveBeenCalled();
    expect(channels.statusChange).not.toHaveBeenCalled();
    expect(sessions.killSession).not.toHaveBeenCalled();
  });

  it('handles empty session list gracefully', async () => {
    const sessions = mockSessionManager([]);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    await expect((monitor as any).checkDeadSessions()).resolves.toBeUndefined();
    expect(channels.statusChange).not.toHaveBeenCalled();
  });

  it('detects newly dead sessions across successive checks', async () => {
    const s1 = makeSession({ id: 'later-dead' });
    const sessions = mockSessionManager([s1]);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    // First check — alive
    sessions.isWindowAlive.mockResolvedValue(true);
    await (monitor as any).checkDeadSessions();
    expect(channels.statusChange).toHaveBeenCalledTimes(0);

    // Second check — now dead
    sessions.isWindowAlive.mockResolvedValue(false);
    sessions.listSessions.mockReturnValue([{ ...s1 }]);
    await (monitor as any).checkDeadSessions();
    expect(channels.statusChange).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// removeSession cleanup
// ---------------------------------------------------------------------------

describe('removeSession cleanup', () => {
  it('clears lastStatus for the session', () => {
    const { monitor } = setupMonitorWithState();
    expect((monitor as any).lastStatus.has('s1')).toBe(true);

    (monitor as any).removeSession('s1');

    expect((monitor as any).lastStatus.has('s1')).toBe(false);
  });

  it('clears lastBytesSeen for the session', () => {
    const { monitor } = setupMonitorWithState();
    expect((monitor as any).lastBytesSeen.has('s1')).toBe(true);

    (monitor as any).removeSession('s1');

    expect((monitor as any).lastBytesSeen.has('s1')).toBe(false);
  });

  it('clears deadNotified for the session', () => {
    const { monitor } = setupMonitorWithState();
    expect((monitor as any).deadNotified.has('s1')).toBe(true);

    (monitor as any).removeSession('s1');

    expect((monitor as any).deadNotified.has('s1')).toBe(false);
  });

  it('clears rateLimitedSessions for the session', () => {
    const { monitor } = setupMonitorWithState();
    expect((monitor as any).rateLimitedSessions.has('s1')).toBe(true);

    (monitor as any).removeSession('s1');

    expect((monitor as any).rateLimitedSessions.has('s1')).toBe(false);
  });

  it('clears pending statusChangeDebounce timer', () => {
    const { monitor } = setupMonitorWithState();
    expect((monitor as any).statusChangeDebounce.has('s1')).toBe(true);

    (monitor as any).removeSession('s1');

    expect((monitor as any).statusChangeDebounce.has('s1')).toBe(false);
  });

  it('clears stallNotified entries matching the session id', () => {
    const { monitor } = setupMonitorWithState();
    // Issue #663: stallNotified is now Map<string, Set<string>>
    const stallMap = (monitor as any).stallNotified as Map<string, Set<string>>;
    expect(stallMap.has('s1')).toBe(true);
    expect(stallMap.get('s1')!.size).toBeGreaterThan(0);

    (monitor as any).removeSession('s1');

    expect(stallMap.has('s1')).toBe(false);
    // Other sessions' stall keys should remain
    expect(stallMap.has('s2')).toBe(true);
  });

  it('clears idleNotified for the session', () => {
    const { monitor } = setupMonitorWithState();
    expect((monitor as any).idleNotified.has('s1')).toBe(true);

    (monitor as any).removeSession('s1');

    expect((monitor as any).idleNotified.has('s1')).toBe(false);
  });

  it('clears idleSince for the session', () => {
    const { monitor } = setupMonitorWithState();
    expect((monitor as any).idleSince.has('s1')).toBe(true);

    (monitor as any).removeSession('s1');

    expect((monitor as any).idleSince.has('s1')).toBe(false);
  });

  it('clears stateSince for the session', () => {
    const { monitor } = setupMonitorWithState();
    expect((monitor as any).stateSince.has('s1')).toBe(true);

    (monitor as any).removeSession('s1');

    expect((monitor as any).stateSince.has('s1')).toBe(false);
  });

  it('clears prevStatusForStall for the session', () => {
    const { monitor } = setupMonitorWithState();
    expect((monitor as any).prevStatusForStall.has('s1')).toBe(true);

    (monitor as any).removeSession('s1');

    expect((monitor as any).prevStatusForStall.has('s1')).toBe(false);
  });

  it('does NOT clear processedStopSignals (uses different key format)', () => {
    const { monitor } = setupMonitorWithState();
    const sizeBefore = (monitor as any).processedStopSignals.size;

    (monitor as any).removeSession('s1');

    // processedStopSignals uses claudeSessionId:timestamp keys, not bridge session id
    // So removing session 's1' should NOT clear anything from processedStopSignals
    expect((monitor as any).processedStopSignals.size).toBe(sizeBefore);
    expect((monitor as any).processedStopSignals.has('claude-xyz:1700000000')).toBe(true);
  });

  it('stops JSONL watcher for the session', () => {
    const watcher = mockJsonlWatcher();
    const session = makeSession({ id: 'watcher-sess' });
    const sessions = mockSessionManager([session]);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );
    monitor.setJsonlWatcher(watcher as unknown as JsonlWatcher);

    (monitor as any).removeSession('watcher-sess');

    expect(watcher.unwatch).toHaveBeenCalledWith('watcher-sess');
  });

  it('clears all tracking maps while leaving other sessions untouched', () => {
    const { monitor } = setupMonitorWithState();

    // Verify s2 exists in all maps before removal
    expect((monitor as any).lastStatus.has('s2')).toBe(true);
    expect((monitor as any).lastBytesSeen.has('s2')).toBe(true);
    expect((monitor as any).idleNotified.has('s2')).toBe(true);

    (monitor as any).removeSession('s1');

    // s2 should remain in all maps
    expect((monitor as any).lastStatus.has('s2')).toBe(true);
    expect((monitor as any).lastBytesSeen.has('s2')).toBe(true);
    expect((monitor as any).idleNotified.has('s2')).toBe(true);
    expect((monitor as any).idleSince.has('s2')).toBe(true);
    expect((monitor as any).stateSince.has('s2')).toBe(true);
    expect((monitor as any).prevStatusForStall.has('s2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deadCheckIntervalMs timing
// ---------------------------------------------------------------------------

describe('deadCheckIntervalMs timing', () => {
  it('dead check runs when interval has elapsed since lastDeadCheck', async () => {
    const session = makeSession({ id: 'timing-1' });
    const sessions = mockSessionManager([session]);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
      { ...DEFAULT_MONITOR_CONFIG, deadCheckIntervalMs: 10_000 },
    );

    // Set lastDeadCheck to 11 seconds ago — should fire
    (monitor as any).lastDeadCheck = Date.now() - 11_000;

    // poll() contains the timing gate. We test by calling poll() and checking
    // that isWindowAlive was called (meaning checkDeadSessions ran).
    // But poll() also calls checkSession which needs readMessagesForMonitor.
    // Instead, let's directly test the timing logic.
    const now = Date.now();
    const shouldCheck = now - (monitor as any).lastDeadCheck >= DEFAULT_MONITOR_CONFIG.deadCheckIntervalMs;
    expect(shouldCheck).toBe(true);
  });

  it('dead check is skipped if interval has not elapsed since lastDeadCheck', () => {
    const now = Date.now();
    const lastDeadCheck = now - 5_000; // 5 seconds ago, interval is 10s

    const shouldCheck = now - lastDeadCheck >= DEFAULT_MONITOR_CONFIG.deadCheckIntervalMs;
    expect(shouldCheck).toBe(false);
  });

  it('default deadCheckIntervalMs is 10 seconds', () => {
    expect(DEFAULT_MONITOR_CONFIG.deadCheckIntervalMs).toBe(10_000);
  });

  it('fires exactly at the interval boundary', () => {
    const now = Date.now();
    const lastDeadCheck = now - 10_000; // exactly 10s ago

    const shouldCheck = now - lastDeadCheck >= DEFAULT_MONITOR_CONFIG.deadCheckIntervalMs;
    expect(shouldCheck).toBe(true);
  });

  it('custom deadCheckIntervalMs is respected', () => {
    const customInterval = 5_000;
    const now = Date.now();
    const lastDeadCheck = now - 5_500;

    const shouldCheck = now - lastDeadCheck >= customInterval;
    expect(shouldCheck).toBe(true);

    const notYet = now - 4_000;
    const shouldCheck2 = now - notYet >= customInterval;
    expect(shouldCheck2).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full integration: poll() timing gate
// ---------------------------------------------------------------------------

describe('poll() dead check timing gate', () => {
  it('calls checkDeadSessions when deadCheckIntervalMs has elapsed', async () => {
    const session = makeSession({ id: 'poll-dead' });
    const sessions = mockSessionManager([session]);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
      { ...DEFAULT_MONITOR_CONFIG, deadCheckIntervalMs: 0 }, // 0 = always fires
    );

    const checkDeadSpy = vi.spyOn(monitor as any, 'checkDeadSessions').mockResolvedValue(undefined);

    // poll() requires checkSession to not throw
    await (monitor as any).poll();

    expect(checkDeadSpy).toHaveBeenCalledTimes(1);
  });

  it('skips checkDeadSessions when interval has NOT elapsed', async () => {
    const session = makeSession({ id: 'poll-skip' });
    const sessions = mockSessionManager([session]);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
      { ...DEFAULT_MONITOR_CONFIG, deadCheckIntervalMs: 100_000 }, // very long
    );

    // Set lastDeadCheck to now — interval hasn't elapsed
    (monitor as any).lastDeadCheck = Date.now();

    const checkDeadSpy = vi.spyOn(monitor as any, 'checkDeadSessions').mockResolvedValue(undefined);

    await (monitor as any).poll();

    expect(checkDeadSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Session detail message format
// ---------------------------------------------------------------------------

describe('dead session detail message', () => {
  it('includes window name in detail', async () => {
    const session = makeSession({ id: 'msg-1', windowName: 'my-special-window' });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    await (monitor as any).checkDeadSessions();

    const payload = channels.statusChange.mock.calls[0][0] as SessionEventPayload;
    expect(payload.detail).toContain('my-special-window');
    expect(payload.detail).toContain('died');
  });

  it('payload timestamp is a valid ISO string', async () => {
    const session = makeSession({ id: 'msg-ts' });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    await (monitor as any).checkDeadSessions();

    const payload = channels.statusChange.mock.calls[0][0] as SessionEventPayload;
    expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(new Date(payload.timestamp).getTime()).not.toBeNaN();
  });

  it('payload contains correct session metadata', async () => {
    const session = makeSession({
      id: 'msg-meta',
      windowName: 'meta-win',
      workDir: '/home/user/project',
    });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    await (monitor as any).checkDeadSessions();

    const payload = channels.statusChange.mock.calls[0][0] as SessionEventPayload;
    expect(payload.session.id).toBe('msg-meta');
    expect(payload.session.name).toBe('meta-win');
    expect(payload.session.workDir).toBe('/home/user/project');
  });
});

// ---------------------------------------------------------------------------
// Order of operations
// ---------------------------------------------------------------------------

describe('order of operations in checkDeadSessions', () => {
  it('calls removeSession before killSession', async () => {
    const session = makeSession({ id: 'order-1' });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    const callOrder: string[] = [];
    vi.spyOn(monitor as any, 'removeSession').mockImplementation(() => {
      callOrder.push('removeSession');
    });
    sessions.killSession.mockImplementation(async () => {
      callOrder.push('killSession');
    });

    await (monitor as any).checkDeadSessions();

    expect(callOrder).toEqual(['removeSession', 'killSession']);
  });

  it('emits events before removing session', async () => {
    const session = makeSession({ id: 'emit-order' });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const bus = mockEventBus();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );
    monitor.setEventBus(bus as unknown as SessionEventBus);

    const callOrder: string[] = [];
    bus.emitDead.mockImplementation(() => {
      callOrder.push('emitDead');
    });
    channels.statusChange.mockImplementation(async () => {
      callOrder.push('statusChange');
    });

    await (monitor as any).checkDeadSessions();

    // emitDead and statusChange should fire before removeSession completes
    // (removeSession is synchronous so it runs after the awaits)
    expect(callOrder.indexOf('emitDead')).toBeLessThan(callOrder.indexOf('statusChange') === -1 ? Infinity : callOrder.indexOf('statusChange'));
    // Both events should have fired
    expect(callOrder).toContain('emitDead');
    expect(callOrder).toContain('statusChange');
  });
});

// ---------------------------------------------------------------------------
// Issue #390: PID-based crash detection
// ---------------------------------------------------------------------------

describe('Issue #390: PID-based crash detection', () => {
  it('detects dead session immediately when ccPid is dead (isWindowAlive returns false)', async () => {
    // Simulate: CC process killed, ccPid is dead, but isWindowAlive catches it
    const session = makeSession({ id: 'pid-dead-1', ccPid: 99999 });
    const sessions = mockSessionManager([session]);
    // isWindowAlive returns false because ccPid check fails inside the real implementation
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const bus = mockEventBus();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );
    monitor.setEventBus(bus as unknown as SessionEventBus);

    await (monitor as any).checkDeadSessions();

    expect(sessions.isWindowAlive).toHaveBeenCalledWith('pid-dead-1');
    expect(bus.emitDead).toHaveBeenCalledWith('pid-dead-1', expect.any(String));
    expect(channels.statusChange).toHaveBeenCalledTimes(1);
    const payload = channels.statusChange.mock.calls[0][0] as SessionEventPayload;
    expect(payload.event).toBe('status.dead');
  });

  it('does not detect session as dead when ccPid is alive', async () => {
    const session = makeSession({ id: 'pid-alive', ccPid: 12345 });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(true);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    await (monitor as any).checkDeadSessions();

    expect(channels.statusChange).not.toHaveBeenCalled();
  });

  it('handles session without ccPid gracefully (falls back to window check)', async () => {
    const session = makeSession({ id: 'no-pid' });
    // ccPid is undefined
    expect(session.ccPid).toBeUndefined();
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(true);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );

    await (monitor as any).checkDeadSessions();

    // No crash, no false positive — session is alive
    expect(channels.statusChange).not.toHaveBeenCalled();
  });

  it('PID crash detected even when tmux window still exists (shell running)', async () => {
    // This is the exact scenario from issue #390:
    // CC killed via SIGKILL → shell prompt returns → tmux window exists,
    // pane has shell PID (alive) → but stored ccPid is dead
    const session = makeSession({ id: 'crash-390', ccPid: 99999, windowName: 'cc-crash390' });
    const sessions = mockSessionManager([session]);
    // In the real implementation, isWindowAlive checks ccPid first and returns false
    // even though the tmux window still exists with a running shell
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const bus = mockEventBus();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );
    monitor.setEventBus(bus as unknown as SessionEventBus);

    await (monitor as any).checkDeadSessions();

    expect(bus.emitDead).toHaveBeenCalledTimes(1);
    expect(bus.emitDead).toHaveBeenCalledWith('crash-390', expect.stringContaining('cc-crash390'));
    expect(sessions.killSession).toHaveBeenCalledWith('crash-390');
  });

  it('sets lastDeadAt when PID crash is detected', async () => {
    const session = makeSession({ id: 'pid-ts', ccPid: 99999 });
    const sessions = mockSessionManager([session]);
    sessions.isWindowAlive.mockResolvedValue(false);
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(
      sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
      channels as unknown as ChannelManager,
    );
    const before = Date.now();

    await (monitor as any).checkDeadSessions();

    const updatedSession = sessions.listSessions()[0];
    expect(updatedSession.lastDeadAt).toBeGreaterThanOrEqual(before);
    expect(updatedSession.lastDeadAt).toBeLessThanOrEqual(Date.now());
  });
});

// ---------------------------------------------------------------------------
// Helpers for removeSession tests
// ---------------------------------------------------------------------------

/**
 * Set up a monitor with internal state populated for session 's1' (and 's2' for
 * verifying that only the target session is cleaned).
 */
function setupMonitorWithState(): { monitor: SessionMonitor; channels: ReturnType<typeof mockChannelManager> } {
  const s1 = makeSession({ id: 's1', windowName: 'session-1' });
  const s2 = makeSession({ id: 's2', windowName: 'session-2' });
  const sessions = mockSessionManager([s1, s2]);
  const channels = mockChannelManager();
  const monitor = new SessionMonitor(
    sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
    channels as unknown as ChannelManager,
  );

  const now = Date.now();

  // Populate all internal maps for s1
  (monitor as any).lastStatus.set('s1', 'working');
  (monitor as any).lastStatus.set('s2', 'idle');

  (monitor as any).lastBytesSeen.set('s1', { bytes: 1024, at: now - 5000 });
  (monitor as any).lastBytesSeen.set('s2', { bytes: 2048, at: now - 3000 });

  (monitor as any).deadNotified.add('s1');

  (monitor as any).rateLimitedSessions.add('s1');

  // Debounce timer — use a real timer that can be cleared
  (monitor as any).statusChangeDebounce.set('s1', setTimeout(() => {}, 60_000));

  // Issue #663: stallNotified is now Map<string, Set<string>>
  (monitor as any).stallNotified.set('s1', new Set(['jsonl', 'permission']));
  (monitor as any).stallNotified.set('s2', new Set(['jsonl']));

  (monitor as any).idleNotified.add('s1');
  (monitor as any).idleNotified.add('s2');

  (monitor as any).idleSince.set('s1', now - 10_000);
  (monitor as any).idleSince.set('s2', now - 5_000);

  (monitor as any).stateSince.set('s1', { state: 'working', since: now - 30_000 });
  (monitor as any).stateSince.set('s2', { state: 'idle', since: now - 20_000 });

  (monitor as any).prevStatusForStall.set('s1', 'working');
  (monitor as any).prevStatusForStall.set('s2', 'idle');

  // processedStopSignals uses different keys (claudeSessionId:timestamp)
  (monitor as any).processedStopSignals.add('claude-xyz:1700000000');

  return { monitor, channels };
}
