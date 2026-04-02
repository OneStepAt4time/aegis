import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo, SessionManager } from '../session.js';
import type { ChannelManager, SessionEventPayload } from '../channels/index.js';
import type { JsonlWatcher } from '../jsonl-watcher.js';
import type { ParsedEntry } from '../transcript.js';
import type { UIState } from '../terminal-parser.js';
import { SessionMonitor } from '../monitor.js';
import {
  addFaultRule,
  clearFaultRules,
  InjectedFatalFaultError,
  maybeInjectFault,
  resetFaultInjection,
  setFaultInjectionEnabledForTest,
  setFaultInjectionSeedForTest,
} from '../fault-injection.js';
import { SessionManager as RealSessionManager } from '../session.js';

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

function makeMessage(overrides: Partial<ParsedEntry> = {}): ParsedEntry {
  return {
    role: 'assistant',
    contentType: 'text',
    text: 'Hello world',
    ...overrides,
  };
}

async function flushAll(ms = 50): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

describe('Issue #901: deterministic fault-injection integration harness', () => {
  beforeEach(() => {
    setFaultInjectionEnabledForTest(true);
    setFaultInjectionSeedForTest(901);
    clearFaultRules();
    resetFaultInjection();
  });

  afterEach(() => {
    clearFaultRules();
    setFaultInjectionEnabledForTest(false);
    resetFaultInjection();
    vi.restoreAllMocks();
  });

  it('injects deterministic transient fault in monitor forwardMessage fire-and-forget path', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    addFaultRule({
      point: 'monitor.forwardMessage.channels.message',
      mode: 'transient',
      every: 1,
      errorMessage: 'Injected monitor transient',
    });

    const session = makeSession({ id: 'fi-msg-1' });
    const sessions = mockSessionManager([session]);
    const channels = mockChannelManager();
    const watcher = {
      watch: vi.fn(),
      unwatch: vi.fn(),
      isWatching: vi.fn(() => false),
      onEntries: vi.fn(),
    };

    const monitor = new SessionMonitor(
      sessions as unknown as SessionManager,
      channels as unknown as ChannelManager,
    );
    monitor.setJsonlWatcher(watcher as unknown as JsonlWatcher);

    const onEntries = watcher.onEntries.mock.calls[0][0] as (event: unknown) => void;
    onEntries({
      sessionId: 'fi-msg-1',
      newOffset: 500,
      messages: [makeMessage()],
    });

    await flushAll(120);

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(channels.message).toHaveBeenCalledTimes(0);
  });

  it('injects deterministic fatal fault in session acquisition path', async () => {
    addFaultRule({
      point: 'session.findIdleSessionByWorkDir.start',
      mode: 'fatal',
      every: 1,
      errorMessage: 'Injected acquisition fatal',
    });

    const tmux = {
      windowExists: vi.fn(async () => true),
    };

    const manager = new RealSessionManager(
      tmux as any,
      { stateDir: '/tmp/aegis-test' } as any,
    );

    (manager as any).state.sessions = {
      s1: makeSession({ id: 's1', workDir: '/tmp/project', status: 'idle' }),
    };

    await expect(manager.findIdleSessionByWorkDir('/tmp/project')).rejects.toBeInstanceOf(InjectedFatalFaultError);

    clearFaultRules();
    const acquired = await manager.findIdleSessionByWorkDir('/tmp/project');
    expect(acquired?.id).toBe('s1');
  });

  it('supports deterministic delay injection for CI-friendly timing scenarios', async () => {
    addFaultRule({
      point: 'fault.harness.delay.sample',
      mode: 'delay',
      every: 1,
      delayMs: 30,
    });

    const start = Date.now();
    await maybeInjectFault('fault.harness.delay.sample');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(20);
  });

  it('has zero behavior change when harness is disabled', async () => {
    setFaultInjectionEnabledForTest(false);
    addFaultRule({
      point: 'fault.harness.disabled.sample',
      mode: 'fatal',
      every: 1,
      errorMessage: 'should not throw when disabled',
    });

    await expect(maybeInjectFault('fault.harness.disabled.sample')).resolves.toBeUndefined();
  });
});
