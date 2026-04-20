/**
 * session.test.ts — Unit tests for session.ts methods.
 * Issue #1879: Phase 1 — Real method calls with proper mocks.
 *
 * Tests call ACTUAL SessionManager / QuestionManager methods with mocked dependencies.
 * Follows the pattern from dead-session.test.ts: construct real class instances
 * with mock dependencies, then call real methods and assert on results/side-effects.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SessionInfo } from '../session.js';
import { SessionManager } from '../session.js';
import type { TmuxManager } from '../tmux.js';
import type { Config } from '../config.js';
import { QuestionManager } from '../question-manager.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'test-session-id',
    windowId: '@1',
    windowName: 'test-window',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'bypassPermissions',
    ...overrides,
  };
}

function makeMockTmux(): TmuxManager {
  return {
    sendKeys: vi.fn(async () => ({ success: true })),
    sendSpecialKey: vi.fn(async () => {}),
    killWindow: vi.fn(async () => {}),
    capturePane: vi.fn(async () => ''),
    capturePaneDirect: vi.fn(async () => ''),
    windowExists: vi.fn(async () => true),
    listWindows: vi.fn(async () => []),
    listPanePid: vi.fn(async () => 12345),
    isPidAlive: vi.fn(() => true),
    getWindowHealth: vi.fn(async () => ({ windowExists: true, paneDead: false })),
    createWindow: vi.fn(async () => ({
      windowId: '@99',
      windowName: 'cc-new',
      freshSessionId: null,
    })),
  } as unknown as TmuxManager;
}

function makeMockConfig(): Config {
  return {
    port: 9100,
    host: '127.0.0.1',
    authToken: '',
    tmuxSession: 'test',
    stateDir: '/tmp/aegis-test-session',
    claudeProjectsDir: '/tmp/.claude/projects',
    maxSessionAgeMs: 7200000,
    reaperIntervalMs: 300000,
    continuationPointerTtlMs: 300000,
    tgBotToken: '',
    tgGroupId: '',
    tgAllowedUsers: [],
    tgTopicTtlMs: 300000,
    webhooks: [],
    defaultSessionEnv: {},
    defaultPermissionMode: 'bypassPermissions',
    stallThresholdMs: 300000,
    sseMaxConnections: 100,
    sseMaxPerIp: 10,
    allowedWorkDirs: [],
    hookSecretHeaderOnly: false,
    memoryBridge: { enabled: false },
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
  } as unknown as Config;
}

/** Create a SessionManager with mock deps and a pre-seeded session in internal state. */
function createManagerWithSession(session: SessionInfo = makeSession()): {
  manager: SessionManager;
  mockTmux: TmuxManager;
  mockConfig: Config;
} {
  const mockTmux = makeMockTmux();
  const mockConfig = makeMockConfig();
  const manager = new SessionManager(mockTmux, mockConfig);
  // Seed the session directly into internal state (bypass createSession I/O)
  (manager as any).state.sessions[session.id] = session;
  return { manager, mockTmux, mockConfig };
}

// ─────────────────────────────────────────────────────────────────────────────
// QuestionManager — tested directly (no external dependencies)
// ─────────────────────────────────────────────────────────────────────────────

describe('QuestionManager', () => {
  let qm: QuestionManager;

  beforeEach(() => {
    qm = new QuestionManager();
  });

  describe('submitAnswer()', () => {
    it('returns false when no pending question exists', () => {
      const result = qm.submitAnswer('session-1', 'tool-use-1', 'answer');
      expect(result).toBe(false);
    });

    it('returns false when questionId does not match', async () => {
      vi.useFakeTimers();
      const p = qm.waitForAnswer('session-1', 'tool-use-1', 'What to do?', 30_000);
      await vi.advanceTimersByTimeAsync(10);
      const result = qm.submitAnswer('session-1', 'wrong-tool-id', 'answer');
      expect(result).toBe(false);
      qm.cleanupPendingQuestion('session-1');
      vi.useRealTimers();
    });

    it('returns true when questionId matches and resolves the promise', async () => {
      vi.useFakeTimers();
      const promise = qm.waitForAnswer('session-1', 'tool-use-1', 'What to do?', 30_000);
      await vi.advanceTimersByTimeAsync(10);

      const result = qm.submitAnswer('session-1', 'tool-use-1', 'my answer');
      expect(result).toBe(true);

      const answer = await promise;
      expect(answer).toBe('my answer');
      vi.useRealTimers();
    });

    it('clears the timeout timer on successful answer', async () => {
      vi.useFakeTimers();
      const promise = qm.waitForAnswer('session-1', 'tool-use-1', 'What?', 30_000);
      await vi.advanceTimersByTimeAsync(10);
      expect(qm.hasPendingQuestion('session-1')).toBe(true);
      qm.submitAnswer('session-1', 'tool-use-1', 'answer');
      expect(qm.hasPendingQuestion('session-1')).toBe(false);
      const answer = await promise;
      expect(answer).toBe('answer');
      vi.useRealTimers();
    });
  });

  describe('hasPendingQuestion()', () => {
    it('returns false when no question is pending', () => {
      expect(qm.hasPendingQuestion('session-1')).toBe(false);
    });

    it('returns true after waitForAnswer is called', async () => {
      vi.useFakeTimers();
      qm.waitForAnswer('session-1', 'tool-use-1', 'What?', 30_000);
      await vi.advanceTimersByTimeAsync(10);
      expect(qm.hasPendingQuestion('session-1')).toBe(true);
      vi.useRealTimers();
    });

    it('returns false after submitAnswer resolves it', async () => {
      vi.useFakeTimers();
      qm.waitForAnswer('session-1', 'tool-use-1', 'What?', 30_000);
      await vi.advanceTimersByTimeAsync(10);
      qm.submitAnswer('session-1', 'tool-use-1', 'answer');
      expect(qm.hasPendingQuestion('session-1')).toBe(false);
      vi.useRealTimers();
    });
  });

  describe('getPendingQuestionInfo()', () => {
    it('returns null when no question is pending', () => {
      expect(qm.getPendingQuestionInfo('session-1')).toBeNull();
    });

    it('returns question info when a question is pending', async () => {
      vi.useFakeTimers();
      qm.waitForAnswer('session-1', 'tool-use-1', 'What is the plan?', 30_000);
      await vi.advanceTimersByTimeAsync(10);
      const info = qm.getPendingQuestionInfo('session-1');
      expect(info).not.toBeNull();
      expect(info!.toolUseId).toBe('tool-use-1');
      expect(info!.question).toBe('What is the plan?');
      expect(typeof info!.timestamp).toBe('number');
      vi.useRealTimers();
    });
  });

  describe('cleanupPendingQuestion()', () => {
    it('removes pending question without resolving', async () => {
      vi.useFakeTimers();
      const promise = qm.waitForAnswer('session-1', 'tool-use-1', 'What?', 30_000);
      await vi.advanceTimersByTimeAsync(10);
      expect(qm.hasPendingQuestion('session-1')).toBe(true);

      qm.cleanupPendingQuestion('session-1');
      expect(qm.hasPendingQuestion('session-1')).toBe(false);

      let resolved = false;
      promise.then(() => { resolved = true; });
      await vi.advanceTimersByTimeAsync(31_000);
      expect(resolved).toBe(false);
      vi.useRealTimers();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SessionManager.getSession() — real method calls
// ─────────────────────────────────────────────────────────────────────────────

describe('SessionManager.getSession()', () => {
  it('returns null for nonexistent session', () => {
    const { manager } = createManagerWithSession();
    expect(manager.getSession('nonexistent')).toBeNull();
  });

  it('returns the session when it exists', () => {
    const session = makeSession();
    const { manager } = createManagerWithSession(session);
    const result = manager.getSession(session.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(session.id);
    expect(result!.windowId).toBe('@1');
    expect(result!.windowName).toBe('test-window');
  });

  it('returns null for prototype pollution keys', () => {
    const { manager } = createManagerWithSession();
    expect(manager.getSession('__proto__')).toBeNull();
    expect(manager.getSession('prototype')).toBeNull();
    expect(manager.getSession('constructor')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SessionManager.listSessions() — real method calls
// ─────────────────────────────────────────────────────────────────────────────

describe('SessionManager.listSessions()', () => {
  it('returns empty array when no sessions exist', () => {
    const { manager } = createManagerWithSession();
    // Remove the seeded session
    (manager as any).state.sessions = Object.create(null);
    expect(manager.listSessions()).toEqual([]);
  });

  it('returns all seeded sessions', () => {
    const s1 = makeSession({ id: 's1', windowName: 'win-1' });
    const s2 = makeSession({ id: 's2', windowName: 'win-2' });
    const mockTmux = makeMockTmux();
    const mockConfig = makeMockConfig();
    const manager = new SessionManager(mockTmux, mockConfig);
    (manager as any).state.sessions['s1'] = s1;
    (manager as any).state.sessions['s2'] = s2;

    const list = manager.listSessions();
    expect(list).toHaveLength(2);
    const ids = list.map(s => s.id);
    expect(ids).toContain('s1');
    expect(ids).toContain('s2');
  });

  it('returns cached result on second call (same reference)', () => {
    const session = makeSession();
    const { manager } = createManagerWithSession(session);
    const first = manager.listSessions();
    const second = manager.listSessions();
    expect(first).toBe(second); // same cached array reference
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SessionManager.getLatencyMetrics() — real method calls
// ─────────────────────────────────────────────────────────────────────────────

describe('SessionManager.getLatencyMetrics()', () => {
  it('returns null when session does not exist', () => {
    const { manager } = createManagerWithSession();
    expect(manager.getLatencyMetrics('nonexistent')).toBeNull();
  });

  it('returns null hook_latency_ms when lastHookReceivedAt is missing', () => {
    const session = makeSession({ lastHookEventAt: Date.now() - 100 });
    const { manager } = createManagerWithSession(session);
    const metrics = manager.getLatencyMetrics(session.id)!;
    expect(metrics.hook_latency_ms).toBeNull();
  });

  it('computes positive hook_latency_ms from timestamps', () => {
    const now = Date.now();
    const session = makeSession({
      lastHookReceivedAt: now,
      lastHookEventAt: now - 150,
    });
    const { manager } = createManagerWithSession(session);
    const metrics = manager.getLatencyMetrics(session.id)!;
    expect(metrics.hook_latency_ms).toBe(150);
  });

  it('returns null hook_latency on negative result (clock skew guard)', () => {
    const now = Date.now();
    const session = makeSession({
      lastHookReceivedAt: now - 100,
      lastHookEventAt: now,
    });
    const { manager } = createManagerWithSession(session);
    const metrics = manager.getLatencyMetrics(session.id)!;
    expect(metrics.hook_latency_ms).toBeNull();
  });

  it('computes permission_response_ms from permission timestamps', () => {
    const now = Date.now();
    const session = makeSession({
      permissionPromptAt: now - 5000,
      permissionRespondedAt: now,
    });
    const { manager } = createManagerWithSession(session);
    const metrics = manager.getLatencyMetrics(session.id)!;
    expect(metrics.permission_response_ms).toBe(5000);
  });

  it('returns null permission_response_ms when permissionPromptAt is missing', () => {
    const session = makeSession({
      permissionPromptAt: undefined,
      permissionRespondedAt: Date.now(),
    });
    const { manager } = createManagerWithSession(session);
    const metrics = manager.getLatencyMetrics(session.id)!;
    expect(metrics.permission_response_ms).toBeNull();
  });

  it('state_change_detection_ms equals hook_latency_ms when both are set', () => {
    const now = Date.now();
    const session = makeSession({
      lastHookReceivedAt: now,
      lastHookEventAt: now - 50,
    });
    const { manager } = createManagerWithSession(session);
    const metrics = manager.getLatencyMetrics(session.id)!;
    expect(metrics.state_change_detection_ms).toBe(50);
    expect(metrics.hook_latency_ms).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SessionManager.escape() — real method calls
// ─────────────────────────────────────────────────────────────────────────────

describe('SessionManager.escape()', () => {
  it('throws when session does not exist', async () => {
    const { manager } = createManagerWithSession();
    await expect(manager.escape('nonexistent')).rejects.toThrow('Session nonexistent not found');
  });

  it('calls tmux.sendSpecialKey with Escape for existing session', async () => {
    const session = makeSession();
    const { manager, mockTmux } = createManagerWithSession(session);
    await manager.escape(session.id);
    expect(mockTmux.sendSpecialKey).toHaveBeenCalledWith('@1', 'Escape');
  });

  it('calls tmux.sendSpecialKey with the correct windowId', async () => {
    const session = makeSession({ windowId: '@42' });
    const { manager, mockTmux } = createManagerWithSession(session);
    await manager.escape(session.id);
    expect(mockTmux.sendSpecialKey).toHaveBeenCalledWith('@42', 'Escape');
  });
});

describe('SessionManager permission responses', () => {
  it('approves plan-mode prompts by resolving the hook and choosing manual approvals', async () => {
    const session = makeSession({
      status: 'permission_prompt',
      permissionMode: 'plan',
      permissionPromptAt: Date.now() - 1_000,
    });
    const { manager, mockTmux } = createManagerWithSession(session);
    const paneText = `Claude has written up a plan and is ready to execute.
Would you like to proceed?

❯1. Yes, and use auto mode
2. Yes, manually approve edits
3. No, refine with Ultraplan on Claude Code on the web
4. Tell Claude what to change

ctrl-g to edit in Notepad.exe`;
    (mockTmux.capturePane as ReturnType<typeof vi.fn>).mockResolvedValue(paneText);

    const decisionPromise = manager.waitForPermissionDecision(session.id, 10_000, 'ExitPlanMode', '');

    await manager.approve(session.id);

    await expect(decisionPromise).resolves.toBe('allow');
    expect((mockTmux.sendKeys as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('@1', '2', true);
    expect(manager.getSession(session.id)?.permissionRespondedAt).toBeDefined();
  });

  it('rejects plan-mode prompts by resolving the hook and choosing the no option', async () => {
    const session = makeSession({
      status: 'permission_prompt',
      permissionMode: 'plan',
      permissionPromptAt: Date.now() - 1_000,
    });
    const { manager, mockTmux } = createManagerWithSession(session);
    const paneText = `Claude has written up a plan and is ready to execute.
Would you like to proceed?

❯1. Yes, and use auto mode
2. Yes, manually approve edits
3. No, refine with Ultraplan on Claude Code on the web
4. Tell Claude what to change

ctrl-g to edit in Notepad.exe`;
    (mockTmux.capturePane as ReturnType<typeof vi.fn>).mockResolvedValue(paneText);

    const decisionPromise = manager.waitForPermissionDecision(session.id, 10_000, 'ExitPlanMode', '');

    await manager.reject(session.id);

    await expect(decisionPromise).resolves.toBe('deny');
    expect((mockTmux.sendKeys as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('@1', '3', true);
    expect(manager.getSession(session.id)?.permissionRespondedAt).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SessionManager.interrupt() — real method calls
// ─────────────────────────────────────────────────────────────────────────────

describe('SessionManager.interrupt()', () => {
  it('throws when session does not exist', async () => {
    const { manager } = createManagerWithSession();
    await expect(manager.interrupt('nonexistent')).rejects.toThrow('Session nonexistent not found');
  });

  it('calls tmux.sendSpecialKey with C-c for existing session', async () => {
    const session = makeSession({ windowId: '@5' });
    const { manager, mockTmux } = createManagerWithSession(session);
    await manager.interrupt(session.id);
    expect(mockTmux.sendSpecialKey).toHaveBeenCalledWith('@5', 'C-c');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SessionManager.isWindowAlive() — real method calls
// ─────────────────────────────────────────────────────────────────────────────

describe('SessionManager.isWindowAlive()', () => {
  it('returns false when session does not exist', async () => {
    const { manager } = createManagerWithSession();
    await expect(manager.isWindowAlive('nonexistent')).resolves.toBe(false);
  });

  it('returns true when window exists and pane is alive', async () => {
    const session = makeSession();
    const { manager, mockTmux } = createManagerWithSession(session);
    (mockTmux.getWindowHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      windowExists: true,
      paneDead: false,
    });
    (mockTmux.listPanePid as ReturnType<typeof vi.fn>).mockResolvedValue(12345);
    (mockTmux.isPidAlive as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await expect(manager.isWindowAlive(session.id)).resolves.toBe(true);
    expect(mockTmux.getWindowHealth).toHaveBeenCalledWith('@1');
  });

  it('returns false when window does not exist', async () => {
    const session = makeSession();
    const { manager, mockTmux } = createManagerWithSession(session);
    (mockTmux.getWindowHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      windowExists: false,
      paneDead: false,
    });

    await expect(manager.isWindowAlive(session.id)).resolves.toBe(false);
  });

  it('returns false when ccPid is dead (fast crash detection)', async () => {
    const session = makeSession({ ccPid: 99999 });
    const { manager, mockTmux } = createManagerWithSession(session);
    (mockTmux.isPidAlive as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await expect(manager.isWindowAlive(session.id)).resolves.toBe(false);
    expect(mockTmux.isPidAlive).toHaveBeenCalledWith(99999);
  });

  it('returns false when pane PID is dead', async () => {
    const session = makeSession();
    const { manager, mockTmux } = createManagerWithSession(session);
    (mockTmux.getWindowHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      windowExists: true,
      paneDead: false,
    });
    (mockTmux.listPanePid as ReturnType<typeof vi.fn>).mockResolvedValue(12345);
    (mockTmux.isPidAlive as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await expect(manager.isWindowAlive(session.id)).resolves.toBe(false);
  });

  it('returns false on tmux error (catches gracefully)', async () => {
    const session = makeSession();
    const { manager, mockTmux } = createManagerWithSession(session);
    (mockTmux.getWindowHealth as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('tmux socket error'),
    );

    await expect(manager.isWindowAlive(session.id)).resolves.toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SessionManager.killSession() — real method calls
// ─────────────────────────────────────────────────────────────────────────────

describe('SessionManager.killSession()', () => {
  it('returns early when session does not exist (no tmux call)', async () => {
    const { manager, mockTmux } = createManagerWithSession();
    // Remove the seeded session
    (manager as any).state.sessions = Object.create(null);
    // Stub save to avoid disk I/O
    vi.spyOn(manager as any, 'save').mockResolvedValue(undefined);

    await manager.killSession('nonexistent');
    expect(mockTmux.killWindow).not.toHaveBeenCalled();
  });

  it('calls tmux.killWindow with correct windowId', async () => {
    const session = makeSession();
    const { manager, mockTmux } = createManagerWithSession(session);
    vi.spyOn(manager as any, 'save').mockResolvedValue(undefined);
    // Mock restoreSettings and cleanupHookSettingsFile to avoid fs calls
    vi.doMock('../permission-guard.js', () => ({
      restoreSettings: vi.fn(async () => {}),
    }));

    await manager.killSession(session.id);
    expect(mockTmux.killWindow).toHaveBeenCalledWith('@1');
  });

  it('deletes session from state after kill', async () => {
    const session = makeSession();
    const { manager, mockTmux } = createManagerWithSession(session);
    vi.spyOn(manager as any, 'save').mockResolvedValue(undefined);

    expect(manager.getSession(session.id)).not.toBeNull();
    await manager.killSession(session.id);
    expect(manager.getSession(session.id)).toBeNull();
  });

  it('does not call restoreSettings when settingsPatched is false', async () => {
    const session = makeSession({ settingsPatched: false });
    const { manager } = createManagerWithSession(session);
    vi.spyOn(manager as any, 'save').mockResolvedValue(undefined);
    // Should not throw — restoreSettings is skipped when settingsPatched is false
    await expect(manager.killSession(session.id)).resolves.toBeUndefined();
  });

  it('does not call cleanupHookSettingsFile when hookSettingsFile is undefined', async () => {
    const session = makeSession({ hookSettingsFile: undefined });
    const { manager } = createManagerWithSession(session);
    vi.spyOn(manager as any, 'save').mockResolvedValue(undefined);
    // Should not throw — cleanupHookSettingsFile is skipped when hookSettingsFile is undefined
    await expect(manager.killSession(session.id)).resolves.toBeUndefined();
  });

  it('cancels debounced save timer on kill', async () => {
    const session = makeSession();
    const { manager } = createManagerWithSession(session);
    vi.spyOn(manager as any, 'save').mockResolvedValue(undefined);
    // Set a fake debounce timer
    (manager as any).saveDebounceTimer = setTimeout(() => {}, 60_000);

    await manager.killSession(session.id);
    expect((manager as any).saveDebounceTimer).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SessionManager.getSummary() — real method calls (delegates to transcripts)
// ─────────────────────────────────────────────────────────────────────────────

describe('SessionManager.getSummary()', () => {
  it('throws when session does not exist', async () => {
    const { manager } = createManagerWithSession();
    await expect(manager.getSummary('nonexistent')).rejects.toThrow('Session nonexistent not found');
  });

  it('delegates to transcripts.getSummary with the session', async () => {
    const session = makeSession();
    const { manager } = createManagerWithSession(session);
    const mockSummary = {
      sessionId: session.id,
      windowName: session.windowName,
      status: 'idle' as const,
      totalMessages: 0,
      messages: [],
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      permissionMode: session.permissionMode,
    };
    vi.spyOn((manager as any).transcripts, 'getSummary').mockResolvedValue(mockSummary);

    const result = await manager.getSummary(session.id);
    expect(result.sessionId).toBe('test-session-id');
    expect(result.windowName).toBe('test-window');
    expect(result.status).toBe('idle');
    expect(result.totalMessages).toBe(0);
    expect(result.permissionMode).toBe('bypassPermissions');
    expect((manager as any).transcripts.getSummary).toHaveBeenCalledWith(session, 20);
  });

  it('passes maxMessages parameter to transcripts.getSummary', async () => {
    const session = makeSession();
    const { manager } = createManagerWithSession(session);
    vi.spyOn((manager as any).transcripts, 'getSummary').mockResolvedValue({
      sessionId: session.id,
      windowName: session.windowName,
      status: 'idle',
      totalMessages: 0,
      messages: [],
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      permissionMode: session.permissionMode,
    });

    await manager.getSummary(session.id, 50);
    expect((manager as any).transcripts.getSummary).toHaveBeenCalledWith(session, 50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SessionManager.updateStatusFromHook() — real method calls
// ─────────────────────────────────────────────────────────────────────────────

describe('SessionManager.updateStatusFromHook()', () => {
  it('returns null for nonexistent session', () => {
    const { manager } = createManagerWithSession();
    expect(manager.updateStatusFromHook('nonexistent', 'PreToolUse')).toBeNull();
  });

  it('sets status to working for PreToolUse hook', () => {
    const session = makeSession({ status: 'idle' });
    const { manager } = createManagerWithSession(session);
    const prev = manager.updateStatusFromHook(session.id, 'PreToolUse');
    expect(prev).toBe('idle');
    expect(session.status).toBe('working');
  });

  it('sets status to working for PostToolUse hook', () => {
    const session = makeSession({ status: 'idle' });
    const { manager } = createManagerWithSession(session);
    manager.updateStatusFromHook(session.id, 'PostToolUse');
    expect(session.status).toBe('working');
  });

  it('sets status to permission_prompt for PermissionRequest hook', () => {
    const session = makeSession({ status: 'working' });
    const { manager } = createManagerWithSession(session);
    manager.updateStatusFromHook(session.id, 'PermissionRequest');
    expect(session.status).toBe('permission_prompt');
  });

  it('sets status to error for StopFailure hook', () => {
    const session = makeSession({ status: 'working' });
    const { manager } = createManagerWithSession(session);
    manager.updateStatusFromHook(session.id, 'StopFailure');
    expect(session.status).toBe('error');
  });

  it('does not change status for Stop hook (idle stays idle)', () => {
    const session = makeSession({ status: 'working' });
    const { manager } = createManagerWithSession(session);
    manager.updateStatusFromHook(session.id, 'Stop');
    // Stop is a no-op in the switch — status unchanged
    expect(session.status).toBe('working');
  });

  it('records hook latency timestamps', () => {
    const session = makeSession();
    const { manager } = createManagerWithSession(session);
    const hookTimestamp = Date.now() - 200;
    manager.updateStatusFromHook(session.id, 'PreToolUse', hookTimestamp);

    expect(session.lastHookReceivedAt).toBeDefined();
    expect(session.lastHookEventAt).toBe(hookTimestamp);
  });

  it('clamps future hookTimestamp to now', () => {
    const session = makeSession();
    const { manager } = createManagerWithSession(session);
    const futureTimestamp = Date.now() + 60_000;
    manager.updateStatusFromHook(session.id, 'PreToolUse', futureTimestamp);

    // lastHookEventAt should be clamped to approximately now, not the future value
    expect(session.lastHookEventAt!).toBeLessThanOrEqual(Date.now());
    expect(session.lastHookEventAt!).not.toBe(futureTimestamp);
  });

  it('records permissionPromptAt on PermissionRequest hook', () => {
    const session = makeSession();
    const { manager } = createManagerWithSession(session);
    const before = Date.now();
    manager.updateStatusFromHook(session.id, 'PermissionRequest');
    expect(session.permissionPromptAt).toBeGreaterThanOrEqual(before);
  });

  it('updates lastActivity on any hook event', () => {
    const oldActivity = Date.now() - 60_000;
    const session = makeSession({ lastActivity: oldActivity });
    const { manager } = createManagerWithSession(session);
    manager.updateStatusFromHook(session.id, 'Notification');
    expect(session.lastActivity).toBeGreaterThan(oldActivity);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SessionInfo interface — completeness and optional fields
// ─────────────────────────────────────────────────────────────────────────────

describe('SessionInfo interface', () => {
  it('has all required fields on a default session', () => {
    const session = makeSession();
    expect(session.id).toBeDefined();
    expect(session.windowId).toBeDefined();
    expect(session.windowName).toBeDefined();
    expect(session.workDir).toBeDefined();
    expect(typeof session.byteOffset).toBe('number');
    expect(typeof session.monitorOffset).toBe('number');
    expect(session.status).toBeDefined();
    expect(typeof session.createdAt).toBe('number');
    expect(typeof session.lastActivity).toBe('number');
    expect(session.stallThresholdMs).toBe(300_000);
    expect(session.permissionStallMs).toBe(300_000);
    expect(session.permissionMode).toBe('bypassPermissions');
  });

  it('accepts all optional latency tracking fields', () => {
    const now = Date.now();
    const session = makeSession({
      claudeSessionId: 'cc-123',
      jsonlPath: '/tmp/session.jsonl',
      permissionPromptAt: now - 5000,
      permissionRespondedAt: now,
      lastHookReceivedAt: now,
      lastHookEventAt: now - 100,
      model: 'claude-sonnet-4-6',
      ccPid: 12345,
      parentId: 'parent-abc',
      children: ['child-1', 'child-2'],
    });

    expect(session.claudeSessionId).toBe('cc-123');
    expect(session.jsonlPath).toBe('/tmp/session.jsonl');
    expect(session.permissionPromptAt).toBe(now - 5000);
    expect(session.permissionRespondedAt).toBe(now);
    expect(session.lastHookReceivedAt).toBe(now);
    expect(session.lastHookEventAt).toBe(now - 100);
    expect(session.model).toBe('claude-sonnet-4-6');
    expect(session.ccPid).toBe(12345);
    expect(session.parentId).toBe('parent-abc');
    expect(session.children).toEqual(['child-1', 'child-2']);
  });
});
