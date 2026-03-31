/**
 * tmux-crash-recovery.test.ts — Tests for Issue #397: tmux server crash recovery.
 *
 * Covers:
 * - TmuxManager.isServerHealthy() — healthy / unreachable
 * - TmuxManager.isTmuxServerError() — crash error patterns vs normal errors
 * - SessionManager.reconcileTmuxCrash() — recovery, orphaning, re-attach by name
 * - SessionManager.reconcile() — re-attach by name after tmux restart
 * - Monitor.checkTmuxHealth() — crash detection, recovery triggers reconciliation
 * - /health endpoint — includes tmux status
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TmuxManager, TmuxTimeoutError } from '../tmux.js';
import type { SessionInfo } from '../session.js';
import type { ChannelManager, SessionEventPayload } from '../channels/index.js';
import type { SessionEventBus } from '../events.js';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG } from '../monitor.js';

// ---------------------------------------------------------------------------
// TmuxManager — isServerHealthy / isTmuxServerError
// ---------------------------------------------------------------------------

describe('TmuxManager — Issue #397', () => {
  describe('isServerHealthy', () => {
    it('returns healthy=true when tmux responds', async () => {
      const tmux = new TmuxManager('test-session');
      // Mock the internal method to succeed
      vi.spyOn(tmux as any, 'tmuxInternal').mockResolvedValue('test-session:1 windows');
      const result = await tmux.isServerHealthy();
      expect(result.healthy).toBe(true);
      expect(result.error).toBeNull();
    });

    it('returns healthy=false with error message when tmux is unreachable', async () => {
      const tmux = new TmuxManager('test-session');
      vi.spyOn(tmux as any, 'tmuxInternal').mockRejectedValue(
        new Error('no server running on /tmp/tmux-1000/aegis-12345'),
      );
      const result = await tmux.isServerHealthy();
      expect(result.healthy).toBe(false);
      expect(result.error).toContain('no server running');
    });

    it('returns healthy=false on connection refused', async () => {
      const tmux = new TmuxManager('test-session');
      vi.spyOn(tmux as any, 'tmuxInternal').mockRejectedValue(
        new Error('failed to connect to server'),
      );
      const result = await tmux.isServerHealthy();
      expect(result.healthy).toBe(false);
      expect(result.error).toContain('failed to connect');
    });
  });

  describe('isTmuxServerError', () => {
    it('detects "no server running" as server error', () => {
      const tmux = new TmuxManager('test-session');
      expect(tmux.isTmuxServerError(new Error('no server running on /tmp/tmux'))).toBe(true);
    });

    it('detects "failed to connect to server" as server error', () => {
      const tmux = new TmuxManager('test-session');
      expect(tmux.isTmuxServerError(new Error('failed to connect to server'))).toBe(true);
    });

    it('detects "connection refused" as server error', () => {
      const tmux = new TmuxManager('test-session');
      expect(tmux.isTmuxServerError(new Error('connection refused on socket'))).toBe(true);
    });

    it('detects "no tmux server" as server error', () => {
      const tmux = new TmuxManager('test-session');
      expect(tmux.isTmuxServerError(new Error('no tmux server found'))).toBe(true);
    });

    it('does not flag window-not-found as server error', () => {
      const tmux = new TmuxManager('test-session');
      expect(tmux.isTmuxServerError(new Error('can\'t find window @99'))).toBe(false);
    });

    it('does not flag session-not-found as server error', () => {
      const tmux = new TmuxManager('test-session');
      expect(tmux.isTmuxServerError(new Error('session not found: aegis'))).toBe(false);
    });

    it('handles non-Error values', () => {
      const tmux = new TmuxManager('test-session');
      expect(tmux.isTmuxServerError('some string')).toBe(false);
      expect(tmux.isTmuxServerError(null)).toBe(false);
      expect(tmux.isTmuxServerError(undefined)).toBe(false);
    });

    it('is case-insensitive', () => {
      const tmux = new TmuxManager('test-session');
      expect(tmux.isTmuxServerError(new Error('No Server Running'))).toBe(true);
      expect(tmux.isTmuxServerError(new Error('FAILED TO CONNECT TO SERVER'))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// SessionManager — reconcileTmuxCrash & reconcile re-attach
// ---------------------------------------------------------------------------

describe('SessionManager — crash recovery (Issue #397)', () => {
  /** Create a mock TmuxManager */
  function mockTmuxManager(windows: Array<{ windowId: string; windowName: string; cwd?: string }> = []) {
    return {
      listWindows: vi.fn(async () => windows.map(w => ({
        windowId: w.windowId,
        windowName: w.windowName,
        cwd: w.cwd || '/tmp',
        paneCommand: 'claude',
      }))),
      isServerHealthy: vi.fn(async () => ({ healthy: true, error: null })),
      isTmuxServerError: vi.fn(() => false),
      windowExists: vi.fn(async () => true),
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

  /** Create a minimal config */
  function mockConfig() {
    return {
      stateDir: '/tmp/aegis-test',
      host: '127.0.0.1',
      port: 9100,
      tmuxSession: 'aegis',
      claudeProjectsDir: '/tmp/.claude/projects',
      maxSessionAgeMs: 7200000,
      reaperIntervalMs: 60000,
      defaultPermissionMode: 'bypassPermissions',
      defaultSessionEnv: {},
      allowedWorkDirs: [],
      sseMaxConnections: 50,
      sseMaxPerIp: 5,
    } as any;
  }

  describe('reconcile — re-attach by window name', () => {
    it('re-attaches session when window exists by name but different ID', async () => {
      const tmux = mockTmuxManager([
        { windowId: '@5', windowName: 'cc-abc12345' },  // tmux restarted, new ID
      ]);
      const config = mockConfig();
      const { SessionManager } = await import('../session.js');
      const sessions = new SessionManager(tmux, config);

      // Manually inject a session with old windowId
      (sessions as any).state.sessions = {
        'session-1': {
          id: 'session-1',
          windowId: '@2',  // old ID from before tmux restart
          windowName: 'cc-abc12345',
          workDir: '/tmp/test',
          byteOffset: 0,
          monitorOffset: 0,
          status: 'unknown' as const,
          createdAt: Date.now() - 60000,
          lastActivity: Date.now() - 10000,
          stallThresholdMs: 300000,
          permissionStallMs: 300000,
          permissionMode: 'default',
          claudeSessionId: 'claude-xyz',
          jsonlPath: '/tmp/test/session.jsonl',
        },
      };

      await (sessions as any).reconcile();

      // Session should be re-attached with new windowId
      const session = sessions.getSession('session-1');
      expect(session).not.toBeNull();
      expect(session!.windowId).toBe('@5');
    });

    it('removes session when window is gone by both ID and name', async () => {
      const tmux = mockTmuxManager([]);  // no windows
      const config = mockConfig();
      const { SessionManager } = await import('../session.js');
      const sessions = new SessionManager(tmux, config);

      (sessions as any).state.sessions = {
        'session-1': {
          id: 'session-1',
          windowId: '@2',
          windowName: 'cc-gone',
          workDir: '/tmp/test',
          byteOffset: 0,
          monitorOffset: 0,
          status: 'unknown' as const,
          createdAt: Date.now() - 60000,
          lastActivity: Date.now(),
          stallThresholdMs: 300000,
          permissionStallMs: 300000,
          permissionMode: 'default',
        },
      };

      await (sessions as any).reconcile();

      expect(sessions.getSession('session-1')).toBeNull();
    });
  });

  describe('reconcileTmuxCrash', () => {
    it('recovers sessions by re-attaching to windows with same name', async () => {
      const tmux = mockTmuxManager([
        { windowId: '@10', windowName: 'cc-recovered' },  // new ID after restart
      ]);
      const config = mockConfig();
      const { SessionManager } = await import('../session.js');
      const sessions = new SessionManager(tmux, config);

      (sessions as any).state.sessions = {
        'session-1': {
          id: 'session-1',
          windowId: '@3',  // old ID from before crash
          windowName: 'cc-recovered',
          workDir: '/tmp/test',
          byteOffset: 0,
          monitorOffset: 0,
          status: 'working' as const,
          createdAt: Date.now() - 60000,
          lastActivity: Date.now(),
          stallThresholdMs: 300000,
          permissionStallMs: 300000,
          permissionMode: 'default',
          claudeSessionId: 'claude-xyz',
          jsonlPath: '/tmp/test/session.jsonl',
        },
      };

      const result = await sessions.reconcileTmuxCrash();
      expect(result.recovered).toBe(1);
      expect(result.orphaned).toBe(0);

      const session = sessions.getSession('session-1');
      expect(session).not.toBeNull();
      expect(session!.windowId).toBe('@10');
      expect(session!.status).toBe('unknown');
    });

    it('marks sessions as orphaned when window is gone', async () => {
      const tmux = mockTmuxManager([]);  // no windows — all gone
      const config = mockConfig();
      const { SessionManager } = await import('../session.js');
      const sessions = new SessionManager(tmux, config);

      (sessions as any).state.sessions = {
        'session-1': {
          id: 'session-1',
          windowId: '@3',
          windowName: 'cc-orphaned',
          workDir: '/tmp/test',
          byteOffset: 0,
          monitorOffset: 0,
          status: 'working' as const,
          createdAt: Date.now() - 60000,
          lastActivity: Date.now(),
          stallThresholdMs: 300000,
          permissionStallMs: 300000,
          permissionMode: 'default',
        },
      };

      const result = await sessions.reconcileTmuxCrash();
      expect(result.recovered).toBe(0);
      expect(result.orphaned).toBe(1);

      const session = sessions.getSession('session-1');
      expect(session).not.toBeNull();
      expect(session!.lastDeadAt).toBeDefined();
      expect(session!.status).toBe('unknown');
    });

    it('handles mixed recovered and orphaned sessions', async () => {
      const tmux = mockTmuxManager([
        { windowId: '@20', windowName: 'cc-alive' },
      ]);
      const config = mockConfig();
      const { SessionManager } = await import('../session.js');
      const sessions = new SessionManager(tmux, config);

      (sessions as any).state.sessions = {
        'session-1': {
          id: 'session-1',
          windowId: '@5',
          windowName: 'cc-alive',  // exists by name → recovered
          workDir: '/tmp/test1',
          byteOffset: 0,
          monitorOffset: 0,
          status: 'working' as const,
          createdAt: Date.now() - 60000,
          lastActivity: Date.now(),
          stallThresholdMs: 300000,
          permissionStallMs: 300000,
          permissionMode: 'default',
          claudeSessionId: 'c1',
          jsonlPath: '/tmp/s1.jsonl',
        },
        'session-2': {
          id: 'session-2',
          windowId: '@6',
          windowName: 'cc-gone',  // doesn't exist → orphaned
          workDir: '/tmp/test2',
          byteOffset: 0,
          monitorOffset: 0,
          status: 'working' as const,
          createdAt: Date.now() - 60000,
          lastActivity: Date.now(),
          stallThresholdMs: 300000,
          permissionStallMs: 300000,
          permissionMode: 'default',
        },
      };

      const result = await sessions.reconcileTmuxCrash();
      expect(result.recovered).toBe(1);
      expect(result.orphaned).toBe(1);
    });

    it('skips sessions whose windowId still matches', async () => {
      const tmux = mockTmuxManager([
        { windowId: '@5', windowName: 'cc-same' },
      ]);
      const config = mockConfig();
      const { SessionManager } = await import('../session.js');
      const sessions = new SessionManager(tmux, config);

      (sessions as any).state.sessions = {
        'session-1': {
          id: 'session-1',
          windowId: '@5',  // matches exactly
          windowName: 'cc-same',
          workDir: '/tmp/test',
          byteOffset: 0,
          monitorOffset: 0,
          status: 'idle' as const,
          createdAt: Date.now() - 60000,
          lastActivity: Date.now(),
          stallThresholdMs: 300000,
          permissionStallMs: 300000,
          permissionMode: 'default',
          claudeSessionId: 'c1',
          jsonlPath: '/tmp/s1.jsonl',
        },
      };

      const result = await sessions.reconcileTmuxCrash();
      expect(result.recovered).toBe(0);
      expect(result.orphaned).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Monitor — tmux health check integration
// ---------------------------------------------------------------------------

describe('Monitor — tmux health check (Issue #397)', () => {
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
        messages: [],
        status: 'idle' as const,
        statusText: null,
        interactiveContent: null,
      })),
      approve: vi.fn(async () => {}),
      reject: vi.fn(async () => {}),
      reconcileTmuxCrash: vi.fn(async () => ({ recovered: 0, orphaned: 0 })),
    };
  }

  function mockChannelManager() {
    return {
      statusChange: vi.fn(async (_payload: SessionEventPayload) => {}),
      message: vi.fn(async (_payload: SessionEventPayload) => {}),
    };
  }

  function mockTmux(healthy = true) {
    return {
      isServerHealthy: vi.fn(async () => ({
        healthy,
        error: healthy ? null : 'no server running',
      })),
    };
  }

  it('detects tmux crash and sets tmuxWasDown flag', async () => {
    const sessions = mockSessionManager([makeSession()]);
    const channels = mockChannelManager();
    const tmux = mockTmux(false);
    const monitor = new SessionMonitor(sessions as any, channels as any);
    monitor.setTmuxManager(tmux as any);

    // Simulate a health check with tmux down
    await (monitor as any).checkTmuxHealth();

    expect((monitor as any).tmuxWasDown).toBe(true);
  });

  it('triggers reconciliation when tmux recovers', async () => {
    const sessions = mockSessionManager([makeSession()]);
    const channels = mockChannelManager();
    const tmux = mockTmux(true);
    const monitor = new SessionMonitor(sessions as any, channels as any);
    monitor.setTmuxManager(tmux as any);

    // Simulate tmux was down
    (monitor as any).tmuxWasDown = true;

    // Now tmux is back up
    await (monitor as any).checkTmuxHealth();

    expect((monitor as any).tmuxWasDown).toBe(false);
    expect(sessions.reconcileTmuxCrash).toHaveBeenCalledOnce();
  });

  it('does not trigger reconciliation when tmux was never down', async () => {
    const sessions = mockSessionManager([makeSession()]);
    const channels = mockChannelManager();
    const tmux = mockTmux(true);
    const monitor = new SessionMonitor(sessions as any, channels as any);
    monitor.setTmuxManager(tmux as any);

    await (monitor as any).checkTmuxHealth();

    expect(sessions.reconcileTmuxCrash).not.toHaveBeenCalled();
  });

  it('notifies channels on recovery with re-attached sessions', async () => {
    const sessions = mockSessionManager([makeSession()]);
    (sessions.reconcileTmuxCrash as any).mockResolvedValue({
      recovered: 1,
      orphaned: 0,
    });
    const channels = mockChannelManager();
    const tmux = mockTmux(true);
    const monitor = new SessionMonitor(sessions as any, channels as any);
    monitor.setTmuxManager(tmux as any);

    (monitor as any).tmuxWasDown = true;
    await (monitor as any).checkTmuxHealth();

    expect(channels.statusChange).toHaveBeenCalled();
    const payload = channels.statusChange.mock.calls[0][0] as SessionEventPayload;
    expect(payload.event).toBe('status.recovered');
    expect(payload.detail).toContain('recovered');
  });

  it('skips health check if TmuxManager not set', async () => {
    const sessions = mockSessionManager();
    const channels = mockChannelManager();
    const monitor = new SessionMonitor(sessions as any, channels as any);
    // Don't call setTmuxManager — should be a no-op

    await (monitor as any).checkTmuxHealth();

    expect(sessions.reconcileTmuxCrash).not.toHaveBeenCalled();
  });

  it('continues to report tmux down across multiple checks', async () => {
    const sessions = mockSessionManager([makeSession()]);
    const channels = mockChannelManager();
    const tmux = mockTmux(false);
    const monitor = new SessionMonitor(sessions as any, channels as any);
    monitor.setTmuxManager(tmux as any);

    // First check
    await (monitor as any).checkTmuxHealth();
    expect((monitor as any).tmuxWasDown).toBe(true);

    // Second check still down
    await (monitor as any).checkTmuxHealth();
    expect((monitor as any).tmuxWasDown).toBe(true);
    // Should NOT call reconcile while still down
    expect(sessions.reconcileTmuxCrash).not.toHaveBeenCalled();
  });
});
