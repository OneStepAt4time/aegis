/**
 * fire-and-forget-rejections.test.ts — Tests for Issue #404:
 * Unhandled promise rejections in fire-and-forget monitor paths.
 *
 * Verifies that:
 * - handleWatcherEvent catches forwardMessage rejections (logs, doesn't crash)
 * - debounced broadcastStatusChange catches rejections (logs, doesn't crash)
 * - Rejections do not propagate as unhandled promise rejections
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SessionInfo } from '../session.js';
import type { ChannelManager, SessionEventPayload } from '../channels/index.js';
import type { SessionEventBus } from '../events.js';
import type { JsonlWatcher } from '../jsonl-watcher.js';
import type { ParsedEntry } from '../transcript.js';
import type { UIState } from '../terminal-parser.js';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG } from '../monitor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function mockSessionManager(sessions: SessionInfo[] = []) {
  const sessionMap = new Map<string, SessionInfo>();
  for (const s of sessions) sessionMap.set(s.id, { ...s });

  return {
    listSessions: vi.fn(() => [...sessionMap.values()]),
    getSession: vi.fn((id: string) => sessionMap.get(id) ?? null),
    isWindowAlive: vi.fn<(id: string) => Promise<boolean>>(async () => true),
    killSession: vi.fn(async () => {}),
    readMessagesForMonitor: vi.fn(async () => ({
      messages: [] as ParsedEntry[],
      status: 'idle' as UIState,
      statusText: null as string | null,
      interactiveContent: null as string | null,
    })),
    approve: vi.fn(async () => {}),
    reject: vi.fn(async () => {}),
  };
}

function mockChannelManager() {
  return {
    statusChange: vi.fn(async (_payload: SessionEventPayload) => {}),
    message: vi.fn(async (_payload: SessionEventPayload) => {}),
  };
}

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

function makeMessage(overrides: Partial<ParsedEntry> = {}): ParsedEntry {
  return {
    role: 'assistant',
    contentType: 'text',
    text: 'Hello world',
    ...overrides,
  };
}

/** Flush pending timers and microtasks. */
async function flushAll(ms = 50): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Issue #404: Fire-and-forget rejection handling', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('handleWatcherEvent → forwardMessage rejection', () => {
    it('logs error when forwardMessage rejects (channel failure)', async () => {
      const session = makeSession({ id: 'fw-reject-1' });
      const sessions = mockSessionManager([session]);
      const channels = mockChannelManager();
      // Simulate channel failure
      channels.message.mockRejectedValue(new Error('Channel delivery failed'));
      const bus = mockEventBus();
      const watcher = {
        watch: vi.fn(),
        unwatch: vi.fn(),
        isWatching: vi.fn(() => false),
        onEntries: vi.fn(),
      };

      const monitor = new SessionMonitor(
        sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
        channels as unknown as ChannelManager,
      );
      monitor.setEventBus(bus as unknown as SessionEventBus);
      monitor.setJsonlWatcher(watcher as unknown as JsonlWatcher);

      // Trigger handleWatcherEvent with a message that will cause forwardMessage to reject
      const onEntries = watcher.onEntries.mock.calls[0][0] as (event: any) => void;
      onEntries({
        sessionId: 'fw-reject-1',
        newOffset: 500,
        messages: [makeMessage()],
      });

      // Wait for the fire-and-forget promise to settle
      await flushAll(100);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('forwardMessage failed for fw-reject-1'),
        expect.any(Error),
      );
    });

    it('does not throw unhandled rejection when forwardMessage fails', async () => {
      const session = makeSession({ id: 'fw-nothrow-1' });
      const sessions = mockSessionManager([session]);
      const channels = mockChannelManager();
      channels.message.mockRejectedValue(new Error('Network error'));

      const watcher = {
        watch: vi.fn(),
        unwatch: vi.fn(),
        isWatching: vi.fn(() => false),
        onEntries: vi.fn(),
      };

      const monitor = new SessionMonitor(
        sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
        channels as unknown as ChannelManager,
      );
      monitor.setJsonlWatcher(watcher as unknown as JsonlWatcher);

      const rejectionHandler = vi.fn();
      process.on('unhandledRejection', rejectionHandler);

      try {
        const onEntries = watcher.onEntries.mock.calls[0][0] as (event: any) => void;
        onEntries({
          sessionId: 'fw-nothrow-1',
          newOffset: 500,
          messages: [makeMessage()],
        });

        await flushAll(200);

        expect(rejectionHandler).not.toHaveBeenCalled();
      } finally {
        process.removeListener('unhandledRejection', rejectionHandler);
      }
    });

    it('continues processing subsequent messages after one fails', async () => {
      const session = makeSession({ id: 'fw-continue-1' });
      const sessions = mockSessionManager([session]);
      const channels = mockChannelManager();
      let callCount = 0;
      channels.message.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('First call fails');
      });

      const watcher = {
        watch: vi.fn(),
        unwatch: vi.fn(),
        isWatching: vi.fn(() => false),
        onEntries: vi.fn(),
      };

      const monitor = new SessionMonitor(
        sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
        channels as unknown as ChannelManager,
      );
      monitor.setJsonlWatcher(watcher as unknown as JsonlWatcher);

      const onEntries = watcher.onEntries.mock.calls[0][0] as (event: any) => void;
      onEntries({
        sessionId: 'fw-continue-1',
        newOffset: 500,
        messages: [
          makeMessage({ text: 'msg1' }),
          makeMessage({ text: 'msg2' }),
        ],
      });

      await flushAll(100);

      // Both messages should have been attempted
      expect(channels.message).toHaveBeenCalledTimes(2);
      // Error logged for first, not second
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('debounced broadcastStatusChange rejection', () => {
    it('logs error when broadcastStatusChange rejects', async () => {
      const session = makeSession({ id: 'bc-reject-1' });
      const sessions = mockSessionManager([session]);
      const channels = mockChannelManager();
      channels.statusChange.mockRejectedValue(new Error('Webhook delivery failed'));

      const monitor = new SessionMonitor(
        sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
        channels as unknown as ChannelManager,
      );

      // Simulate a status change via checkSession — need readMessagesForMonitor
      sessions.readMessagesForMonitor.mockResolvedValue({
        messages: [],
        status: 'permission_prompt',
        statusText: null,
        interactiveContent: 'Allow tool use?',
      });

      // Set previous status so a change is detected
      (monitor as any).lastStatus.set('bc-reject-1', 'working');

      // checkSession triggers debounced broadcastStatusChange
      await (monitor as any).checkSession(session);

      // Wait for debounce (500ms) + catch handler
      await flushAll(700);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('broadcastStatusChange failed for bc-reject-1'),
        expect.any(Error),
      );
    });

    it('does not throw unhandled rejection when broadcastStatusChange fails', async () => {
      const session = makeSession({ id: 'bc-nothrow-1' });
      const sessions = mockSessionManager([session]);
      const channels = mockChannelManager();
      channels.statusChange.mockRejectedValue(new Error('Telegram API error'));

      const monitor = new SessionMonitor(
        sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
        channels as unknown as ChannelManager,
      );

      sessions.readMessagesForMonitor.mockResolvedValue({
        messages: [],
        status: 'idle',
        statusText: 'Done',
        interactiveContent: null,
      });

      (monitor as any).lastStatus.set('bc-nothrow-1', 'working');
      // Set idleSince so idle debounce passes (>3s)
      (monitor as any).idleSince.set('bc-nothrow-1', Date.now() - 5_000);

      const rejectionHandler = vi.fn();
      process.on('unhandledRejection', rejectionHandler);

      try {
        await (monitor as any).checkSession(session);
        await flushAll(700);

        expect(rejectionHandler).not.toHaveBeenCalled();
      } finally {
        process.removeListener('unhandledRejection', rejectionHandler);
      }
    });

    it('monitor continues polling after broadcast rejection', async () => {
      const session = makeSession({ id: 'bc-continue-1' });
      const sessions = mockSessionManager([session]);
      const channels = mockChannelManager();
      let statusCallCount = 0;
      channels.statusChange.mockImplementation(async () => {
        statusCallCount++;
        if (statusCallCount === 1) throw new Error('First broadcast fails');
      });

      const monitor = new SessionMonitor(
        sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
        channels as unknown as ChannelManager,
        { ...DEFAULT_MONITOR_CONFIG, pollIntervalMs: 10, deadCheckIntervalMs: 100_000, stallCheckIntervalMs: 100_000 },
      );

      // First check: trigger a permission_prompt change that will reject
      sessions.readMessagesForMonitor.mockResolvedValue({
        messages: [],
        status: 'permission_prompt' as UIState,
        statusText: null as string | null,
        interactiveContent: 'Allow?',
      });
      await (monitor as any).checkSession(session);
      await flushAll(700);

      // Error should have been logged for the first rejection
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

      // Second check: trigger a different status change
      // Reset lastStatus so a new change is detected
      (monitor as any).lastStatus.delete('bc-continue-1');
      sessions.readMessagesForMonitor.mockResolvedValue({
        messages: [],
        status: 'permission_prompt' as UIState,
        statusText: null as string | null,
        interactiveContent: 'Another permission?',
      });
      await (monitor as any).checkSession(session);
      await flushAll(700);

      // Second call should have succeeded (no more errors)
      expect(channels.statusChange).toHaveBeenCalledTimes(2);
      // Only one error logged
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });
});
