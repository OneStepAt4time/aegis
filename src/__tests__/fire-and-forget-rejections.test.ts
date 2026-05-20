/**
 * fire-and-forget-rejections.test.ts — Tests for Issue #404 + #3837:
 * Unhandled promise rejections in fire-and-forget monitor paths.
 *
 * After #3837, ChannelManager methods (message, statusChange, etc.) are
 * fire-and-forget (return void). Errors are caught inside fanOut's try/catch.
 *
 * Verifies that:
 * - Channel failures inside fanOut are caught (no unhandled rejection)
 * - forwardMessage continues processing after channel failures
 * - broadcastStatusChange debounce continues after channel failures
 * - No unhandled promise rejections from fire-and-forget paths
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SessionInfo } from '../session.js';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG } from '../monitor.js';
import { ChannelManager } from '../channels/manager.js';
import type { Channel, SessionEventPayload } from '../channels/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-1',
    windowId: '@0',
    displayName: 'test-session',
    workDir: '/tmp/test',
    claudeSessionId: 'claude-abc',
    jsonlPath: '/tmp/test/session.jsonl',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now() - 60_000,
    lastActivity: Date.now() - 10_000,
    stallThresholdMs: 5 * 60 * 1000,
    permissionStallMs: 5 * 60_000,
    permissionMode: 'default',
    tenantId: '_system',
    ownerKeyId: 'master',
    ...overrides,
  } as SessionInfo;
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    role: 'assistant',
    contentType: 'text',
    text: 'Hello',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/** Flush all pending microtasks and timers. */
async function flushAll(ms = 100): Promise<void> {
  await new Promise(r => setTimeout(r, ms));
}

/**
 * Create a ChannelManager with a registered channel that rejects all calls.
 */
function createFailingChannelManager() {
  const failingChannel: Channel = {
    name: 'mock-failing',
    onSessionCreated: vi.fn(async (_payload: SessionEventPayload) => {
      throw new Error('Channel delivery failed');
    }),
    onSessionEnded: vi.fn(async (_payload: SessionEventPayload) => {
      throw new Error('Channel ended failed');
    }),
    onMessage: vi.fn(async (_payload: SessionEventPayload) => {
      throw new Error('Channel message failed');
    }),
    onStatusChange: vi.fn(async (_payload: SessionEventPayload) => {
      throw new Error('Channel status failed');
    }),
  };

  const mgr = new ChannelManager();
  mgr.register(failingChannel);

  return { mgr, failingChannel };
}

function mockSessionManager(sessions: SessionInfo[] = []) {
  const sessionMap = new Map<string, SessionInfo>();
  for (const s of sessions) sessionMap.set(s.id, { ...s });

  return {
    listSessions: vi.fn(() => [...sessionMap.values()]),
    getSession: vi.fn((id: string) => sessionMap.get(id) ?? null),
    readMessagesForMonitor: vi.fn(async () => ({
      messages: [],
      status: 'working',
      statusText: null,
      interactiveContent: null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Issue #404/#3837: Fire-and-forget rejection handling', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('handleWatcherEvent → forwardMessage', () => {
    it('does not throw unhandled rejection when channel fails', async () => {
      const session = makeSession({ id: 'fw-nothrow-1' });
      const sessions = mockSessionManager([session]);
      const { mgr: channels } = createFailingChannelManager();

      const watcher = {
        watch: vi.fn(),
        unwatch: vi.fn(),
        isWatching: vi.fn(() => false),
        onEntries: vi.fn(),
      };

      const monitor = new SessionMonitor(
        sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
        channels as unknown as import('../channels/index.js').ChannelManager,
      );
      monitor.setJsonlWatcher(watcher as unknown as import('../jsonl-watcher.js').JsonlWatcher);

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
      const { mgr: channels, failingChannel } = createFailingChannelManager();

      const watcher = {
        watch: vi.fn(),
        unwatch: vi.fn(),
        isWatching: vi.fn(() => false),
        onEntries: vi.fn(),
      };

      const monitor = new SessionMonitor(
        sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
        channels as unknown as import('../channels/index.js').ChannelManager,
      );
      monitor.setJsonlWatcher(watcher as unknown as import('../jsonl-watcher.js').JsonlWatcher);

      const onEntries = watcher.onEntries.mock.calls[0][0] as (event: any) => void;
      onEntries({
        sessionId: 'fw-continue-1',
        newOffset: 500,
        messages: [
          makeMessage({ text: 'msg1' }),
          makeMessage({ text: 'msg2' }),
        ],
      });

      await flushAll(200);

      // Both messages should have been attempted
      expect(failingChannel.onMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('debounced broadcastStatusChange', () => {
    it('does not throw unhandled rejection when broadcastStatusChange channel fails', async () => {
      const session = makeSession({ id: 'bc-nothrow-1' });
      const sessions = mockSessionManager([session]);
      const { mgr: channels } = createFailingChannelManager();

      const monitor = new SessionMonitor(
        sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
        channels as unknown as import('../channels/index.js').ChannelManager,
      );

      sessions.readMessagesForMonitor.mockResolvedValue({
        messages: [],
        status: 'idle',
        statusText: null,
        interactiveContent: null,
      } as any);

      (monitor as any).lastStatus.set('bc-nothrow-1', 'working');
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
      const { mgr: channels, failingChannel } = createFailingChannelManager();

      const monitor = new SessionMonitor(
        sessions as unknown as ConstructorParameters<typeof SessionMonitor>[0],
        channels as unknown as import('../channels/index.js').ChannelManager,
        { ...DEFAULT_MONITOR_CONFIG, pollIntervalMs: 10, deadCheckIntervalMs: 100_000, stallCheckIntervalMs: 100_000 },
      );

      // First check: trigger a permission_prompt change
      sessions.readMessagesForMonitor.mockResolvedValue({
        messages: [],
        status: 'permission_prompt',
        statusText: null,
        interactiveContent: 'Allow?',
      } as any);
      await (monitor as any).checkSession(session);
      await flushAll(700);

      // Channel should have been called
      expect(failingChannel.onStatusChange).toHaveBeenCalled();
      const firstCallCount = (failingChannel.onStatusChange as ReturnType<typeof vi.fn>).mock.calls.length;

      // Second check: trigger a different status change
      (monitor as any).lastStatus.delete('bc-continue-1');
      sessions.readMessagesForMonitor.mockResolvedValue({
        messages: [],
        status: 'permission_prompt',
        statusText: null,
        interactiveContent: 'Another permission?',
      } as any);
      await (monitor as any).checkSession(session);
      await flushAll(700);

      // Second call should have happened (monitor continued)
      expect((failingChannel.onStatusChange as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(firstCallCount);
    });
  });
});
