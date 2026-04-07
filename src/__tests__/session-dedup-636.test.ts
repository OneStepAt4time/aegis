/**
 * session-dedup-636.test.ts — Tests for Issue #636: verify tmux window alive
 * in findIdleSessionByWorkDir.
 *
 * When a tmux window is killed externally (user ran `tmux kill-window`, tmux
 * crashed, etc.) the in-memory session state still marks it as idle.
 * findIdleSessionByWorkDir must call tmux.windowExists() to filter out dead
 * sessions before returning a candidate.
 */

import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';

function makeSession(overrides: Partial<SessionInfo> & { workDir: string; status: SessionInfo['status']; windowId?: string }): SessionInfo {
  return {
    id: crypto.randomUUID(),
    windowId: '@1',
    windowName: 'test',
    byteOffset: 0,
    monitorOffset: 0,
    createdAt: Date.now() - 60_000,
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  };
}

function mockTmuxManager(windowExistsMap: Record<string, boolean> = {}) {
  return {
    windowExists: vi.fn(async (windowId: string) => windowExistsMap[windowId] ?? false),
    listWindows: vi.fn(async () => []),
    isServerHealthy: vi.fn(async () => ({ healthy: true, error: null })),
    isTmuxServerError: vi.fn(() => false),
    killWindow: vi.fn(async () => {}),
    sendKeys: vi.fn(async () => {}),
    sendKeysVerified: vi.fn(async () => ({ delivered: true, attempts: 1 })),
    capturePane: vi.fn(async () => ''),
    sendSpecialKey: vi.fn(async () => {}),
    listPanePid: vi.fn(async () => null),
    isPidAlive: vi.fn(() => true),
    ensureSession: vi.fn(async () => {}),
    createWindow: vi.fn(async () => ({ windowId: '@1', windowName: 'cc-test' })),
    killSession: vi.fn(async () => {}),
    getWindowHealth: vi.fn(async () => ({
      windowExists: true, paneCommand: 'claude', claudeRunning: true,
    })),
  } as any;
}

function mockConfig() {
  return { stateDir: '/tmp/aegis-test-636' } as any;
}

/**
 * Create a SessionManager with sessions pre-loaded into its internal state.
 * We use Object.assign to inject sessions without going through createSession.
 */
function createSessionManagerWithSessions(
  sessions: SessionInfo[],
  windowExistsMap: Record<string, boolean>,
): SessionManager {
  const tmux = mockTmuxManager(windowExistsMap);
  const config = mockConfig();
  const sm = new SessionManager(tmux, config);
  // Inject sessions directly into internal state
  (sm as any).state = { sessions: Object.fromEntries(sessions.map(s => [s.id, s])) };
  return sm;
}

describe('Issue #636: findIdleSessionByWorkDir verifies tmux window', () => {
  it('should return null when the idle session has a dead tmux window', async () => {
    const session = makeSession({ workDir: '/project/a', status: 'idle', windowId: '@99' });
    const sm = createSessionManagerWithSessions([session], { '@99': false });

    const result = await sm.findIdleSessionByWorkDir('/project/a');

    expect(result).toBeNull();
  });

  it('should return the session when the tmux window is alive', async () => {
    const session = makeSession({ workDir: '/project/a', status: 'idle', windowId: '@1' });
    const sm = createSessionManagerWithSessions([session], { '@1': true });

    const result = await sm.findIdleSessionByWorkDir('/project/a');

    expect(result).not.toBeNull();
    expect(result!.id).toBe(session.id);
  });

  it('should skip dead windows and return the first alive one', async () => {
    const deadSession = makeSession({ workDir: '/project/a', status: 'idle', windowId: '@10', lastActivity: 3000 });
    const aliveSession = makeSession({ workDir: '/project/a', status: 'idle', windowId: '@11', lastActivity: 2000 });
    const sm = createSessionManagerWithSessions(
      [deadSession, aliveSession],
      { '@10': false, '@11': true },
    );

    const result = await sm.findIdleSessionByWorkDir('/project/a');

    expect(result).not.toBeNull();
    expect(result!.id).toBe(aliveSession.id);
  });

  it('should return null when all idle sessions have dead windows', async () => {
    const s1 = makeSession({ workDir: '/project/a', status: 'idle', windowId: '@20' });
    const s2 = makeSession({ workDir: '/project/a', status: 'idle', windowId: '@21' });
    const sm = createSessionManagerWithSessions(
      [s1, s2],
      { '@20': false, '@21': false },
    );

    const result = await sm.findIdleSessionByWorkDir('/project/a');

    expect(result).toBeNull();
  });

  it('should return null when no sessions match workDir', async () => {
    const session = makeSession({ workDir: '/project/b', status: 'idle', windowId: '@1' });
    const sm = createSessionManagerWithSessions([session], { '@1': true });

    const result = await sm.findIdleSessionByWorkDir('/project/a');

    expect(result).toBeNull();
  });
});
