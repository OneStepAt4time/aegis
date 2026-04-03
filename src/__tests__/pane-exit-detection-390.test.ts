import { describe, it, expect, vi } from 'vitest';
import { SessionManager, type SessionInfo } from '../session.js';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 's-1',
    windowId: '@1',
    windowName: 'cc-test',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'working',
    createdAt: Date.now() - 60_000,
    lastActivity: Date.now() - 10_000,
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  };
}

function makeConfig() {
  return {
    stateDir: '/tmp/aegis-test',
    host: '127.0.0.1',
    port: 9100,
    tmuxSession: 'aegis',
    claudeProjectsDir: '/tmp/.claude/projects',
    maxSessionAgeMs: 7200000,
    reaperIntervalMs: 60000,
    defaultPermissionMode: 'default',
    defaultSessionEnv: {},
    allowedWorkDirs: [],
    sseMaxConnections: 50,
    sseMaxPerIp: 5,
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
  } as any;
}

function makeTmux() {
  return {
    listWindows: vi.fn(async () => []),
    windowExists: vi.fn(async () => true),
    listPanePid: vi.fn(async () => 1234),
    isPidAlive: vi.fn(() => true),
    getWindowHealth: vi.fn(async () => ({
      windowExists: true,
      paneCommand: 'claude',
      claudeRunning: true,
      paneDead: false,
    })),
    capturePane: vi.fn(async () => ''),
  } as any;
}

describe('Issue #390 pane-exit detection', () => {
  it('treats pane_dead as immediate dead signal in isWindowAlive', async () => {
    const tmux = makeTmux();
    tmux.getWindowHealth.mockResolvedValue({
      windowExists: true,
      paneCommand: 'bash',
      claudeRunning: false,
      paneDead: true,
    });

    const manager = new SessionManager(tmux, makeConfig());
    (manager as any).state.sessions = { 's-1': makeSession({ id: 's-1' }) };

    const alive = await manager.isWindowAlive('s-1');

    expect(alive).toBe(false);
    expect(tmux.listPanePid).not.toHaveBeenCalled();
  });

  it('does not produce false positives during normal idle periods', async () => {
    const tmux = makeTmux();
    tmux.getWindowHealth.mockResolvedValue({
      windowExists: true,
      paneCommand: 'claude',
      claudeRunning: true,
      paneDead: false,
    });

    const manager = new SessionManager(tmux, makeConfig());
    (manager as any).state.sessions = { 's-2': makeSession({ id: 's-2', status: 'idle' }) };

    const alive = await manager.isWindowAlive('s-2');

    expect(alive).toBe(true);
  });

  it('surfaces pane exit in session health details', async () => {
    const tmux = makeTmux();
    tmux.getWindowHealth.mockResolvedValue({
      windowExists: true,
      paneCommand: 'bash',
      claudeRunning: false,
      paneDead: true,
    });

    const manager = new SessionManager(tmux, makeConfig());
    (manager as any).state.sessions = { 's-3': makeSession({ id: 's-3' }) };

    const health = await manager.getHealth('s-3');

    expect(health.alive).toBe(false);
    expect(health.details).toContain('pane has exited');
  });
});
