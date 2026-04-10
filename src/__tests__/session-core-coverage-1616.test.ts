import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { computeProjectHash } from '../path-utils.js';
import type { SessionInfo } from '../session.js';

const {
  readNewEntriesMock,
  findSessionFileMock,
  findSessionFileWithFanoutMock,
  neutralizeBypassPermissionsMock,
  restoreSettingsMock,
  cleanOrphanedBackupMock,
  writeHookSettingsFileMock,
  cleanupHookSettingsFileMock,
  cleanupStaleSessionHooksMock,
  loadContinuationPointersMock,
  detectUIStateMock,
  parseStatusLineMock,
  extractInteractiveContentMock,
} = vi.hoisted(() => ({
  readNewEntriesMock: vi.fn(),
  findSessionFileMock: vi.fn(),
  findSessionFileWithFanoutMock: vi.fn(),
  neutralizeBypassPermissionsMock: vi.fn(),
  restoreSettingsMock: vi.fn(),
  cleanOrphanedBackupMock: vi.fn(),
  writeHookSettingsFileMock: vi.fn(),
  cleanupHookSettingsFileMock: vi.fn(),
  cleanupStaleSessionHooksMock: vi.fn(),
  loadContinuationPointersMock: vi.fn(),
  detectUIStateMock: vi.fn(),
  parseStatusLineMock: vi.fn(),
  extractInteractiveContentMock: vi.fn(),
}));

vi.mock('../transcript.js', () => ({
  readNewEntries: readNewEntriesMock,
  findSessionFile: findSessionFileMock,
}));

vi.mock('../worktree-lookup.js', () => ({
  findSessionFileWithFanout: findSessionFileWithFanoutMock,
}));

vi.mock('../permission-guard.js', () => ({
  neutralizeBypassPermissions: neutralizeBypassPermissionsMock,
  restoreSettings: restoreSettingsMock,
  cleanOrphanedBackup: cleanOrphanedBackupMock,
}));

vi.mock('../hook-settings.js', () => ({
  writeHookSettingsFile: writeHookSettingsFileMock,
  cleanupHookSettingsFile: cleanupHookSettingsFileMock,
  cleanupStaleSessionHooks: cleanupStaleSessionHooksMock,
}));

vi.mock('../continuation-pointer.js', () => ({
  loadContinuationPointers: loadContinuationPointersMock,
}));

vi.mock('../terminal-parser.js', () => ({
  detectUIState: detectUIStateMock,
  parseStatusLine: parseStatusLineMock,
  extractInteractiveContent: extractInteractiveContentMock,
}));

import { SessionManager } from '../session.js';

interface MockTmux {
  listWindows: ReturnType<typeof vi.fn>;
  windowExists: ReturnType<typeof vi.fn>;
  getWindowHealth: ReturnType<typeof vi.fn>;
  listPanePid: ReturnType<typeof vi.fn>;
  isPidAlive: ReturnType<typeof vi.fn>;
  capturePane: ReturnType<typeof vi.fn>;
  capturePaneDirect: ReturnType<typeof vi.fn>;
  sendKeys: ReturnType<typeof vi.fn>;
  sendKeysVerified: ReturnType<typeof vi.fn>;
  sendSpecialKey: ReturnType<typeof vi.fn>;
  killWindow: ReturnType<typeof vi.fn>;
  createWindow: ReturnType<typeof vi.fn>;
}

function makeTmuxDouble(): MockTmux {
  return {
    listWindows: vi.fn().mockResolvedValue([]),
    windowExists: vi.fn().mockResolvedValue(true),
    getWindowHealth: vi.fn().mockResolvedValue({
      windowExists: true,
      paneCommand: 'claude',
      claudeRunning: true,
      paneDead: false,
    }),
    listPanePid: vi.fn().mockResolvedValue(4242),
    isPidAlive: vi.fn().mockReturnValue(true),
    capturePane: vi.fn().mockResolvedValue('IDLE'),
    capturePaneDirect: vi.fn().mockResolvedValue('IDLE'),
    sendKeys: vi.fn().mockResolvedValue(undefined),
    sendKeysVerified: vi.fn().mockResolvedValue({ delivered: true, attempts: 1 }),
    sendSpecialKey: vi.fn().mockResolvedValue(undefined),
    killWindow: vi.fn().mockResolvedValue(undefined),
    createWindow: vi.fn().mockResolvedValue({
      windowId: '@7',
      windowName: 'cc-created',
      freshSessionId: '11111111-1111-4111-8111-111111111111',
    }),
  };
}

function makeConfig(baseDir: string): Record<string, unknown> {
  const stateDir = join(baseDir, 'state');
  const claudeProjectsDir = join(baseDir, 'projects');
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(claudeProjectsDir, { recursive: true });
  return {
    stateDir,
    host: '127.0.0.1',
    port: 9310,
    tmuxSession: 'aegis',
    claudeProjectsDir,
    maxSessionAgeMs: 7_200_000,
    reaperIntervalMs: 60_000,
    defaultPermissionMode: 'default',
    defaultSessionEnv: {},
    continuationPointerTtlMs: 3_600_000,
    worktreeAwareContinuation: true,
    worktreeSiblingDirs: [join(baseDir, 'worktrees')],
    allowedWorkDirs: [],
    sseMaxConnections: 100,
    sseMaxPerIp: 20,
  };
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: overrides.id ?? 'sess-1',
    windowId: overrides.windowId ?? '@1',
    windowName: overrides.windowName ?? 'cc-session',
    workDir: overrides.workDir ?? process.cwd(),
    byteOffset: overrides.byteOffset ?? 0,
    monitorOffset: overrides.monitorOffset ?? 0,
    status: overrides.status ?? 'idle',
    createdAt: overrides.createdAt ?? Date.now() - 60_000,
    lastActivity: overrides.lastActivity ?? Date.now() - 10_000,
    stallThresholdMs: overrides.stallThresholdMs ?? 120_000,
    permissionStallMs: overrides.permissionStallMs ?? 300_000,
    permissionMode: overrides.permissionMode ?? 'default',
    claudeSessionId: overrides.claudeSessionId,
    jsonlPath: overrides.jsonlPath,
    settingsPatched: overrides.settingsPatched,
    hookSettingsFile: overrides.hookSettingsFile,
    hookSecret: overrides.hookSecret,
    prd: overrides.prd,
    ownerKeyId: overrides.ownerKeyId,
    activeSubagents: overrides.activeSubagents,
  };
}

let sandboxDir = '';

function setupSandbox(testName: string): string {
  const slug = testName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const dir = join(process.cwd(), '.session-core-1616', `${slug}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  sandboxDir = dir;
  return dir;
}

describe('Issue #1616 session.ts core coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readNewEntriesMock.mockResolvedValue({ entries: [], newOffset: 0, raw: [] });
    findSessionFileMock.mockResolvedValue(null);
    findSessionFileWithFanoutMock.mockResolvedValue(null);
    neutralizeBypassPermissionsMock.mockResolvedValue(false);
    restoreSettingsMock.mockResolvedValue(undefined);
    cleanOrphanedBackupMock.mockResolvedValue(undefined);
    writeHookSettingsFileMock.mockResolvedValue(undefined);
    cleanupHookSettingsFileMock.mockResolvedValue(undefined);
    cleanupStaleSessionHooksMock.mockResolvedValue(undefined);
    loadContinuationPointersMock.mockResolvedValue({});
    detectUIStateMock.mockImplementation((text: string) => {
      if (text.includes('PERMISSION')) return 'permission_prompt';
      if (text.includes('WORKING')) return 'working';
      if (text.includes('ASK')) return 'ask_question';
      if (text.includes('IDLE')) return 'idle';
      return 'unknown';
    });
    parseStatusLineMock.mockImplementation((text: string) => (text.includes('STATUS') ? 'STATUS' : null));
    extractInteractiveContentMock.mockImplementation((text: string) => (text.includes('ASK') ? { content: 'ASK' } : null));
  });

  afterEach(() => {
    if (sandboxDir) {
      rmSync(sandboxDir, { recursive: true, force: true });
      sandboxDir = '';
    }
  });

  it('creates sessions with env merge, hooks, parent linkage, and async PID save', async () => {
    const baseDir = setupSandbox('create-session');
    const tmux = makeTmuxDouble();
    const config = makeConfig(baseDir);
    const manager = new SessionManager(tmux as unknown as any, config as unknown as any);

    const parent = makeSession({
      id: 'parent-1',
      windowId: '@4',
      windowName: 'cc-parent',
      workDir: baseDir,
      children: [],
    });
    (manager as unknown as { state: { sessions: Record<string, SessionInfo> } }).state.sessions[parent.id] = parent;

    const hookPath = join(baseDir, 'hook-settings.json');
    writeHookSettingsFileMock.mockResolvedValue(hookPath);
    neutralizeBypassPermissionsMock.mockResolvedValue(true);

    const session = await manager.createSession({
      workDir: baseDir,
      name: 'cc-created',
      prd: 'Build feature',
      env: { SAFE_CHILD: 'child-value' },
      permissionMode: 'default',
      parentId: parent.id,
      ownerKeyId: 'api-key-1',
    });

    await sleep(0);

    expect(session.windowId).toBe('@7');
    expect(session.windowName).toBe('cc-created');
    expect(session.claudeSessionId).toBe('11111111-1111-4111-8111-111111111111');
    expect(session.settingsPatched).toBe(true);
    expect(session.hookSettingsFile).toBe(hookPath);
    expect(session.ownerKeyId).toBe('api-key-1');
    expect(tmux.createWindow).toHaveBeenCalledWith(expect.objectContaining({
      workDir: baseDir,
      windowName: 'cc-created',
      permissionMode: 'default',
      env: { SAFE_CHILD: 'child-value' },
      settingsFile: hookPath,
    }));
    expect(cleanupStaleSessionHooksMock).toHaveBeenCalled();

    const parentAfter = manager.getSession(parent.id);
    expect(parentAfter?.children).toContain(session.id);
    const stored = manager.getSession(session.id);
    expect(stored?.ccPid).toBe(4242);

    (manager as unknown as { stopDiscoveryPolling: (id: string) => void }).stopDiscoveryPolling(session.id);
    (manager as unknown as { stopDiscoveryPolling: (id: string) => void }).stopDiscoveryPolling(parent.id);
  });

  it('rejects unsafe env variable overrides before launching tmux', async () => {
    const baseDir = setupSandbox('env-guard');
    const tmux = makeTmuxDouble();
    const config = makeConfig(baseDir);
    const manager = new SessionManager(tmux as unknown as any, config as unknown as any);

    await expect(manager.createSession({
      workDir: baseDir,
      env: { npm_config_userconfig: 'x' } as Record<string, string>,
    })).rejects.toThrow('dangerous environment variable prefix');

    await expect(manager.createSession({
      workDir: baseDir,
      env: { bad_name: 'x' } as Record<string, string>,
    })).rejects.toThrow('Invalid env var name');

    await expect(manager.createSession({
      workDir: baseDir,
      env: { PATH: '/bin' } as Record<string, string>,
    })).rejects.toThrow('dangerous environment variables');

    expect(tmux.createWindow).not.toHaveBeenCalled();
  });

  it('handles messaging, approvals, answers, and control keys', async () => {
    const baseDir = setupSandbox('message-approval');
    const tmux = makeTmuxDouble();
    const config = makeConfig(baseDir);
    const manager = new SessionManager(tmux as unknown as any, config as unknown as any);
    const session = makeSession({ id: 'sess-2', windowId: '@2', workDir: baseDir, status: 'permission_prompt' });
    (manager as unknown as { state: { sessions: Record<string, SessionInfo> } }).state.sessions[session.id] = session;

    tmux.sendKeysVerified.mockResolvedValueOnce({ delivered: true, attempts: 2 });
    const sendResult = await manager.sendMessage(session.id, 'ship it', { stalled: true, types: ['monitor'] });
    expect(sendResult).toEqual({ delivered: true, attempts: 2, stall: { stalled: true, types: ['monitor'] } });

    const pendingDecision = manager.waitForPermissionDecision(session.id, 1_000, 'Bash', 'Approve?');
    expect(manager.hasPendingPermission(session.id)).toBe(true);
    expect(manager.getPendingPermissionInfo(session.id)).toEqual({ toolName: 'Bash', prompt: 'Approve?' });
    await manager.approve(session.id);
    await expect(pendingDecision).resolves.toBe('allow');
    expect(manager.hasPendingPermission(session.id)).toBe(false);

    tmux.capturePane.mockResolvedValue('  1. Yes\n  2. No\nEsc to cancel');
    await manager.approve(session.id);
    expect(tmux.sendKeys).toHaveBeenCalledWith('@2', '1', true);

    await manager.reject(session.id);
    expect(tmux.sendKeys).toHaveBeenCalledWith('@2', 'n', true);

    const pendingAnswer = manager.waitForAnswer(session.id, 'q-1', 'Need input?', 1_000);
    expect(manager.hasPendingQuestion(session.id)).toBe(true);
    expect(manager.getPendingQuestionInfo(session.id)).toEqual({
      toolUseId: 'q-1',
      question: 'Need input?',
      timestamp: expect.any(Number),
    });
    expect(manager.submitAnswer(session.id, 'q-1', 'answer')).toBe(true);
    await expect(pendingAnswer).resolves.toBe('answer');
    manager.cleanupPendingQuestion(session.id);
    manager.cleanupPendingPermission(session.id);

    manager.recordPermissionPrompt(session.id);
    await manager.escape(session.id);
    await manager.interrupt(session.id);
    expect(tmux.sendSpecialKey).toHaveBeenNthCalledWith(1, '@2', 'Escape');
    expect(tmux.sendSpecialKey).toHaveBeenNthCalledWith(2, '@2', 'C-c');
  });

  it('reads messages and transcript views with cache, pagination, and cursor APIs', async () => {
    const baseDir = setupSandbox('transcript-views');
    const tmux = makeTmuxDouble();
    const config = makeConfig(baseDir);
    const manager = new SessionManager(tmux as unknown as any, config as unknown as any);
    const jsonlPath = join(baseDir, 'transcript.jsonl');
    writeFileSync(jsonlPath, '{"type":"assistant"}\n');

    const session = makeSession({
      id: 'sess-3',
      windowId: '@3',
      workDir: baseDir,
      claudeSessionId: '22222222-2222-4222-8222-222222222222',
      jsonlPath,
      status: 'unknown',
    });
    (manager as unknown as { state: { sessions: Record<string, SessionInfo> } }).state.sessions[session.id] = session;

    const firstEntries = [
      { role: 'user', contentType: 'text', text: 'hello user' },
      { role: 'assistant', contentType: 'text', text: 'hello assistant' },
    ];
    const secondEntries = [
      { role: 'assistant', contentType: 'text', text: 'delta message' },
    ];
    tmux.capturePane.mockResolvedValue('IDLE STATUS');

    readNewEntriesMock.mockImplementation(async (_path: string, offset: number) => {
      if (offset === 0) {
        return { entries: firstEntries, newOffset: 120, raw: [] };
      }
      if (offset === 120) {
        return { entries: secondEntries, newOffset: 180, raw: [] };
      }
      if (offset === 180) {
        return { entries: [], newOffset: 0, raw: [] };
      }
      return { entries: firstEntries, newOffset: 120, raw: [] };
    });

    const readResult = await manager.readMessages(session.id);
    expect(readResult.messages).toEqual(firstEntries);
    expect(readResult.status).toBe('idle');
    expect(readResult.statusText).toBe('STATUS');

    const monitorResult = await manager.readMessagesForMonitor(session.id);
    expect(monitorResult.messages).toEqual(firstEntries);

    const summary = await manager.getSummary(session.id, 1);
    expect(summary.totalMessages).toBe(2);
    expect(summary.messages).toHaveLength(1);
    expect(summary.messages[0].role).toBe('assistant');

    const page = await manager.readTranscript(session.id, 1, 1, 'assistant');
    expect(page.total).toBeGreaterThanOrEqual(1);
    expect(page.messages[0].role).toBe('assistant');

    const cursor = await manager.readTranscriptCursor(session.id, undefined, 2, 'assistant');
    expect(cursor.messages.length).toBeGreaterThan(0);
    expect(cursor.messages[0]._cursor_id).toBe(1);
    expect(cursor.oldest_id).toBe(1);
    expect(cursor.newest_id).toBeGreaterThanOrEqual(1);
  });

  it('detects waiting-for-input state from transcript content blocks', async () => {
    const baseDir = setupSandbox('waiting-for-input');
    const tmux = makeTmuxDouble();
    const config = makeConfig(baseDir);
    const manager = new SessionManager(tmux as unknown as any, config as unknown as any);
    const jsonlPath = join(baseDir, 'wait.jsonl');
    writeFileSync(jsonlPath, '{"type":"assistant"}\n');

    const session = makeSession({ id: 'sess-4', windowId: '@4', workDir: baseDir, jsonlPath });
    (manager as unknown as { state: { sessions: Record<string, SessionInfo> } }).state.sessions[session.id] = session;

    readNewEntriesMock.mockResolvedValueOnce({
      entries: [],
      newOffset: 0,
      raw: [{ type: 'assistant', message: { content: 'Need your input now' } }],
    });
    await expect(manager.detectWaitingForInput(session.id)).resolves.toBe(true);

    readNewEntriesMock.mockResolvedValueOnce({
      entries: [],
      newOffset: 0,
      raw: [{ type: 'assistant', message: { content: [{ type: 'tool_use' }] } }],
    });
    await expect(manager.detectWaitingForInput(session.id)).resolves.toBe(false);
  });

  it('evaluates health and liveness with action hints and zombie detection', async () => {
    const baseDir = setupSandbox('health-branches');
    const tmux = makeTmuxDouble();
    const config = makeConfig(baseDir);
    const manager = new SessionManager(tmux as unknown as any, config as unknown as any);
    const session = makeSession({
      id: 'sess-5',
      windowId: '@5',
      workDir: baseDir,
      status: 'working',
      lastActivity: Date.now() - 10 * 60_000,
    });
    (manager as unknown as { state: { sessions: Record<string, SessionInfo> } }).state.sessions[session.id] = session;

    tmux.getWindowHealth.mockResolvedValueOnce({
      windowExists: true,
      paneCommand: 'bash',
      claudeRunning: false,
      paneDead: false,
    });
    tmux.listPanePid.mockResolvedValueOnce(5000);
    tmux.isPidAlive.mockReturnValueOnce(false);
    const zombieHealth = await manager.getHealth(session.id);
    expect(zombieHealth.alive).toBe(false);
    expect(zombieHealth.details).toContain('zombie');

    tmux.getWindowHealth.mockResolvedValueOnce({
      windowExists: true,
      paneCommand: 'claude',
      claudeRunning: true,
      paneDead: false,
    });
    tmux.listPanePid.mockResolvedValueOnce(5001);
    tmux.isPidAlive.mockReturnValueOnce(true);
    tmux.capturePane.mockResolvedValueOnce('PERMISSION STATUS');
    const promptHealth = await manager.getHealth(session.id);
    expect(promptHealth.status).toBe('permission_prompt');
    expect(promptHealth.actionHints?.approve.url).toContain('/approve');

    tmux.getWindowHealth.mockResolvedValue({
      windowExists: true,
      paneCommand: 'bash',
      claudeRunning: false,
      paneDead: true,
    });
    session.lastActivity = Date.now() - 20_000;
    await expect(manager.isWindowAlive(session.id)).resolves.toBe(false);
    session.lastActivity = Date.now() - 5_000;
    await expect(manager.isWindowAlive(session.id)).resolves.toBe(true);
  });

  it('covers session helper metadata APIs and idle-session acquisition flow', async () => {
    const baseDir = setupSandbox('session-helpers');
    const tmux = makeTmuxDouble();
    const config = makeConfig(baseDir);
    const manager = new SessionManager(tmux as unknown as any, config as unknown as any);
    const typed = manager as unknown as { state: { sessions: Record<string, SessionInfo> } };

    const older = makeSession({
      id: 'sess-old',
      windowId: '@61',
      windowName: 'cc-old',
      workDir: baseDir,
      status: 'idle',
      lastActivity: Date.now() - 20_000,
    });
    const newer = makeSession({
      id: 'sess-new',
      windowId: '@62',
      windowName: 'cc-new',
      workDir: baseDir,
      status: 'idle',
      lastActivity: Date.now() - 5_000,
    });
    typed.state.sessions[older.id] = older;
    typed.state.sessions[newer.id] = newer;
    tmux.windowExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    manager.addSubagent(newer.id, 'teammate-a');
    manager.addSubagent(newer.id, 'teammate-b');
    manager.removeSubagent(newer.id, 'teammate-a');
    manager.updateSessionModel(newer.id, 'claude-sonnet-4-6');
    newer.lastHookReceivedAt = Date.now();
    newer.lastHookEventAt = newer.lastHookReceivedAt - 50;
    newer.permissionPromptAt = Date.now() - 1_000;
    newer.permissionRespondedAt = Date.now();
    expect(manager.getLatencyMetrics(newer.id)).toEqual({
      hook_latency_ms: 50,
      state_change_detection_ms: 50,
      permission_response_ms: expect.any(Number),
    });

    const acquired = await manager.findIdleSessionByWorkDir(baseDir);
    expect(acquired?.id).toBe('sess-new');
    expect(acquired?.status).toBe('acquired');
    manager.releaseSessionClaim('sess-new');
    expect(manager.getSession('sess-new')?.status).toBe('idle');

    const none = await manager.findIdleSessionByWorkDir(join(baseDir, 'other'));
    expect(none).toBeNull();
  });

  it('discovers transcript paths lazily for page and cursor transcript endpoints', async () => {
    const baseDir = setupSandbox('transcript-discovery');
    const tmux = makeTmuxDouble();
    const config = makeConfig(baseDir);
    const manager = new SessionManager(tmux as unknown as any, config as unknown as any);
    const typed = manager as unknown as { state: { sessions: Record<string, SessionInfo> } };

    const transcriptA = join(baseDir, 'transcript-a.jsonl');
    const transcriptB = join(baseDir, 'transcript-b.jsonl');
    writeFileSync(transcriptA, '{"type":"assistant"}\n');
    writeFileSync(transcriptB, '{"type":"assistant"}\n');

    const pagedSession = makeSession({
      id: 'sess-page',
      windowId: '@71',
      windowName: 'cc-page',
      workDir: baseDir,
      claudeSessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      jsonlPath: undefined,
    });
    const cursorSession = makeSession({
      id: 'sess-cursor',
      windowId: '@72',
      windowName: 'cc-cursor',
      workDir: baseDir,
      claudeSessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      jsonlPath: undefined,
    });
    typed.state.sessions[pagedSession.id] = pagedSession;
    typed.state.sessions[cursorSession.id] = cursorSession;

    findSessionFileWithFanoutMock.mockResolvedValueOnce(transcriptA);
    findSessionFileMock.mockResolvedValueOnce(transcriptB);
    readNewEntriesMock.mockResolvedValue({
      entries: [{ role: 'assistant', contentType: 'text', text: 'hello' }],
      newOffset: 30,
      raw: [],
    });

    const paged = await manager.readTranscript(pagedSession.id, 1, 10);
    expect(paged.total).toBe(1);
    expect(pagedSession.jsonlPath).toBe(transcriptA);

    const cursor = await manager.readTranscriptCursor(cursorSession.id, undefined, 10);
    expect(cursor.messages).toHaveLength(1);
    expect(cursorSession.jsonlPath).toBe(transcriptB);
  });

  it('loads from backup, cleans tmp artifacts, and reconciles missing windows', async () => {
    const baseDir = setupSandbox('load-backup');
    const tmux = makeTmuxDouble();
    tmux.listWindows.mockResolvedValue([]);
    const config = makeConfig(baseDir);
    const manager = new SessionManager(tmux as unknown as any, config as unknown as any);

    const stateDir = config.stateDir as string;
    const stateFile = join(stateDir, 'state.json');
    const tmpFile = join(stateDir, 'orphan.tmp');
    writeFileSync(stateFile, '{invalid json');
    writeFileSync(tmpFile, 'tmp');

    const backupSession = makeSession({
      id: 'restored-1',
      windowId: '@91',
      windowName: 'cc-restored',
      workDir: baseDir,
      settingsPatched: true,
    });
    writeFileSync(
      `${stateFile}.bak`,
      JSON.stringify({
        [backupSession.id]: {
          ...backupSession,
          activeSubagents: ['alpha'],
        },
      }),
    );

    await manager.load();

    expect(manager.listSessions()).toHaveLength(0);
    expect(existsSync(tmpFile)).toBe(false);
  });

  it('covers initial prompt retry paths and wait-for-ready verification flow', async () => {
    const baseDir = setupSandbox('initial-prompt');
    const tmux = makeTmuxDouble();
    const config = makeConfig(baseDir);
    const manager = new SessionManager(tmux as unknown as any, config as unknown as any);
    const typed = manager as unknown as {
      state: { sessions: Record<string, SessionInfo> };
      waitForReadyAndSend: (sessionId: string, prompt: string, timeoutMs: number) => Promise<{ delivered: boolean; attempts: number }>;
      verifyPromptAccepted: (windowId: string) => Promise<boolean>;
    };
    const session = makeSession({ id: 'sess-init', windowId: '@12', workDir: baseDir });
    typed.state.sessions[session.id] = session;

    const waitSpy = vi.spyOn(typed, 'waitForReadyAndSend')
      .mockResolvedValueOnce({ delivered: false, attempts: 0 })
      .mockResolvedValueOnce({ delivered: true, attempts: 1 });
    const retried = await manager.sendInitialPrompt(session.id, 'prompt text', 50, 1);
    expect(retried.delivered).toBe(true);
    expect(waitSpy).toHaveBeenCalledTimes(2);

    waitSpy.mockReset().mockResolvedValue({ delivered: false, attempts: 0 });
    const failed = await manager.sendInitialPrompt(session.id, 'prompt text', 50, 0);
    expect(failed).toEqual({ delivered: false, attempts: 0 });

    waitSpy.mockRestore();
    tmux.capturePaneDirect.mockResolvedValue('IDLE');
    tmux.sendKeysVerified.mockResolvedValue({ delivered: true, attempts: 1 });
    vi.spyOn(typed, 'verifyPromptAccepted').mockResolvedValue(false);

    await expect(typed.waitForReadyAndSend(session.id, 'prompt text', 50))
      .resolves.toEqual({ delivered: false, attempts: 1 });
  });

  it('rejects stale continuation pointer mappings during session sync', async () => {
    const baseDir = setupSandbox('sync-stale-guards');
    const tmux = makeTmuxDouble();
    const config = makeConfig(baseDir);
    const manager = new SessionManager(tmux as unknown as any, config as unknown as any);
    const typed = manager as unknown as {
      state: { sessions: Record<string, SessionInfo> };
      syncSessionMap: () => Promise<void>;
    };

    const stateDir = config.stateDir as string;
    writeFileSync(join(stateDir, 'session_map.json'), '{}');

    const createdAt = Date.now();
    const session = makeSession({
      id: 'sess-guard',
      windowId: '@88',
      windowName: 'cc-guard',
      workDir: baseDir,
      createdAt,
      claudeSessionId: undefined,
      jsonlPath: undefined,
    });
    typed.state.sessions[session.id] = session;

    const projectHash = computeProjectHash(baseDir);
    const archivedDir = join(config.claudeProjectsDir as string, projectHash, '_archived');
    mkdirSync(archivedDir, { recursive: true });
    const archivedPath = join(archivedDir, 'archived.jsonl');
    writeFileSync(archivedPath, '{}\n');

    const stalePath = join(baseDir, 'stale.jsonl');
    writeFileSync(stalePath, '{}\n');
    const oldSeconds = (createdAt - 5_000) / 1000;
    utimesSync(stalePath, oldSeconds, oldSeconds);

    const fallbackSessionId = '66666666-6666-4666-8666-666666666666';
    findSessionFileMock.mockResolvedValueOnce(null);
    loadContinuationPointersMock.mockResolvedValueOnce({
      'aegis:@88-old': {
        session_id: '44444444-4444-4444-8444-444444444444',
        window_name: 'cc-guard',
        transcript_path: stalePath,
        written_at: createdAt - 10_000,
      },
      'aegis:@88': {
        session_id: fallbackSessionId,
        window_name: 'cc-guard',
        written_at: createdAt + 2_000,
      },
      'aegis:@88-archived': {
        session_id: '55555555-5555-4555-8555-555555555555',
        window_name: 'cc-guard',
        transcript_path: archivedPath,
        written_at: createdAt + 2_000,
      },
      'aegis:@88-stale-file': {
        session_id: '77777777-7777-4777-8777-777777777777',
        window_name: 'cc-guard',
        transcript_path: stalePath,
        written_at: createdAt + 2_000,
      },
    });

    await typed.syncSessionMap();
    expect(findSessionFileMock).toHaveBeenCalledWith(fallbackSessionId, config.claudeProjectsDir);
    expect(session.claudeSessionId).toBeUndefined();
    expect(session.jsonlPath).toBeUndefined();
  });

  it('runs discovery polling callbacks for success and timeout paths', async () => {
    const baseDir = setupSandbox('discovery-polling');
    const tmux = makeTmuxDouble();
    const config = makeConfig(baseDir);
    const manager = new SessionManager(tmux as unknown as any, config as unknown as any);
    const typed = manager as unknown as {
      state: { sessions: Record<string, SessionInfo> };
      pollTimers: Map<string, NodeJS.Timeout>;
      startDiscoveryPolling: (id: string, workDir: string) => void;
      stopDiscoveryPolling: (id: string) => void;
      syncSessionMap: () => Promise<void>;
      maybeDiscoverFromFilesystem: (session: SessionInfo, workDir: string) => Promise<boolean>;
    };

    const workDir = join(baseDir, 'repo');
    mkdirSync(workDir, { recursive: true });
    const discoveredPath = join(baseDir, 'discovered.jsonl');
    writeFileSync(discoveredPath, '{}\n');
    findSessionFileWithFanoutMock.mockResolvedValue(discoveredPath);

    const syncSpy = vi.spyOn(typed, 'syncSessionMap').mockResolvedValue(undefined);
    const fsFallbackSpy = vi.spyOn(typed, 'maybeDiscoverFromFilesystem').mockResolvedValue(false);

    vi.useFakeTimers();
    try {
      const readySession = makeSession({
        id: 'poll-ready',
        windowId: '@31',
        windowName: 'cc-poll-ready',
        workDir,
        claudeSessionId: '99999999-9999-4999-8999-999999999999',
        jsonlPath: undefined,
      });
      typed.state.sessions[readySession.id] = readySession;
      typed.startDiscoveryPolling(readySession.id, workDir);
      await vi.advanceTimersByTimeAsync(2_100);
      expect(syncSpy).toHaveBeenCalled();
      expect(readySession.jsonlPath).toBe(discoveredPath);
      typed.stopDiscoveryPolling(readySession.id);

      const timeoutSession = makeSession({
        id: 'poll-timeout',
        windowId: '@32',
        windowName: 'cc-poll-timeout',
        workDir,
        claudeSessionId: undefined,
        jsonlPath: undefined,
      });
      typed.state.sessions[timeoutSession.id] = timeoutSession;
      typed.startDiscoveryPolling(timeoutSession.id, workDir);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 2_100);
      expect(fsFallbackSpy).toHaveBeenCalled();
      expect(typed.pollTimers.has(timeoutSession.id)).toBe(false);
      typed.stopDiscoveryPolling(timeoutSession.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns false when filesystem discovery sees no valid session files', async () => {
    const baseDir = setupSandbox('discover-none');
    const tmux = makeTmuxDouble();
    const config = makeConfig(baseDir);
    const manager = new SessionManager(tmux as unknown as any, config as unknown as any);
    const typed = manager as unknown as {
      maybeDiscoverFromFilesystem: (session: SessionInfo, workDir: string) => Promise<boolean>;
    };

    const workDir = join(baseDir, 'repo');
    mkdirSync(workDir, { recursive: true });
    const projectHash = computeProjectHash(workDir);
    const projectDir = join(config.claudeProjectsDir as string, projectHash);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'not-a-session.txt'), 'ignore');
    writeFileSync(join(projectDir, 'also-invalid.jsonl'), '{}\n');

    const session = makeSession({
      id: 'discover-none',
      windowId: '@41',
      windowName: 'cc-none',
      workDir,
      claudeSessionId: undefined,
      jsonlPath: undefined,
    });
    await expect(typed.maybeDiscoverFromFilesystem(session, workDir)).resolves.toBe(false);
    expect(session.claudeSessionId).toBeUndefined();
  });

  it('handles syncSessionMap stat failures and killSession debounce cleanup', async () => {
    const baseDir = setupSandbox('sync-stat-fail');
    const tmux = makeTmuxDouble();
    const config = makeConfig(baseDir);
    const manager = new SessionManager(tmux as unknown as any, config as unknown as any);
    const typed = manager as unknown as {
      state: { sessions: Record<string, SessionInfo> };
      syncSessionMap: () => Promise<void>;
      saveDebounceTimer: NodeJS.Timeout | null;
    };

    const stateDir = config.stateDir as string;
    writeFileSync(join(stateDir, 'session_map.json'), '{}');

    const session = makeSession({
      id: 'sync-gone',
      windowId: '@51',
      windowName: 'cc-sync-gone',
      workDir: baseDir,
      createdAt: Date.now() - 1_000,
      claudeSessionId: undefined,
      jsonlPath: undefined,
    });
    typed.state.sessions[session.id] = session;

    findSessionFileMock.mockResolvedValueOnce(join(baseDir, 'missing.jsonl'));
    loadContinuationPointersMock.mockResolvedValueOnce({
      'aegis:@51': {
        session_id: '88888888-8888-4888-8888-888888888888',
        window_name: 'cc-sync-gone',
        written_at: Date.now(),
      },
    });

    await typed.syncSessionMap();
    expect(session.claudeSessionId).toBeUndefined();
    expect(session.jsonlPath).toBeUndefined();

    const killSession = makeSession({
      id: 'debounce-kill',
      windowId: '@52',
      windowName: 'cc-debounce-kill',
      workDir: baseDir,
    });
    typed.state.sessions[killSession.id] = killSession;
    typed.saveDebounceTimer = setTimeout(() => undefined, 10_000);
    await manager.killSession(killSession.id);
    expect(typed.saveDebounceTimer).toBeNull();
  });

  it('cleans up sessions and reconciles discovery via session map and filesystem', async () => {
    const baseDir = setupSandbox('cleanup-discovery');
    const tmux = makeTmuxDouble();
    const config = makeConfig(baseDir);
    const manager = new SessionManager(tmux as unknown as any, config as unknown as any);
    const typedManager = manager as unknown as {
      state: { sessions: Record<string, SessionInfo> };
      cleanSessionMapForWindow: (windowName: string, windowId?: string) => Promise<void>;
      purgeStaleSessionMapEntries: (windowIds: Set<string>, windowNames: Set<string>) => Promise<void>;
      maybeDiscoverFromFilesystem: (session: SessionInfo, workDir: string) => Promise<boolean>;
      syncSessionMap: () => Promise<void>;
      startDiscoveryPolling: (id: string, workDir: string) => void;
      stopDiscoveryPolling: (id: string) => void;
    };

    const stateDir = config.stateDir as string;
    const sessionMapPath = join(stateDir, 'session_map.json');
    writeFileSync(sessionMapPath, '{}');

    const killable = makeSession({
      id: 'sess-kill',
      windowId: '@9',
      windowName: 'cc-kill',
      workDir: baseDir,
      settingsPatched: true,
      hookSettingsFile: join(baseDir, 'hook-settings.tmp.json'),
    });
    typedManager.state.sessions[killable.id] = killable;
    await manager.killSession(killable.id);
    expect(tmux.killWindow).toHaveBeenCalledWith('@9');
    expect(restoreSettingsMock).toHaveBeenCalledWith(baseDir);
    expect(cleanupHookSettingsFileMock).toHaveBeenCalled();
    expect(manager.getSession(killable.id)).toBeNull();

    loadContinuationPointersMock
      .mockResolvedValueOnce({
        'aegis:@2': { session_id: 'stale-a', window_name: 'cc-old', written_at: Date.now() },
        'aegis:@3': { session_id: 'stale-b', window_name: 'cc-target', written_at: Date.now() },
      })
      .mockResolvedValueOnce({
        'aegis:@4': { session_id: 'stale-c', window_name: 'cc-stale', written_at: Date.now() },
        'aegis:@5': { session_id: 'live-d', window_name: 'cc-live', written_at: Date.now() },
      });

    await typedManager.cleanSessionMapForWindow('cc-target', '@2');
    await typedManager.purgeStaleSessionMapEntries(new Set(['@5']), new Set(['cc-live']));

    const discoverWorkDir = join(baseDir, 'repo-work');
    mkdirSync(discoverWorkDir, { recursive: true });
    const projectHash = computeProjectHash(discoverWorkDir);
    const projectDir = join(config.claudeProjectsDir as string, projectHash);
    mkdirSync(projectDir, { recursive: true });
    const discoveredId = '123e4567-e89b-12d3-a456-426614174000';
    const discoveredFile = join(projectDir, `${discoveredId}.jsonl`);
    writeFileSync(discoveredFile, '{"type":"assistant"}\n');

    const pending = makeSession({
      id: 'sess-discover',
      windowId: '@10',
      windowName: 'cc-discover',
      workDir: discoverWorkDir,
      createdAt: Date.now() - 1_000,
      claudeSessionId: undefined,
      jsonlPath: undefined,
    });
    typedManager.state.sessions[pending.id] = pending;
    await expect(typedManager.maybeDiscoverFromFilesystem(pending, discoverWorkDir)).resolves.toBe(true);
    expect(pending.claudeSessionId).toBe(discoveredId);
    expect(pending.jsonlPath).toBe(discoveredFile);

    const syncFile = join(baseDir, 'sync.jsonl');
    writeFileSync(syncFile, '{"type":"assistant"}\n');
    loadContinuationPointersMock.mockResolvedValueOnce({
      'aegis:@10': {
        session_id: '33333333-3333-4333-8333-333333333333',
        window_name: 'cc-discover',
        transcript_path: syncFile,
        written_at: Date.now(),
      },
    });

    pending.claudeSessionId = undefined;
    pending.jsonlPath = undefined;
    await typedManager.syncSessionMap();
    expect(pending.claudeSessionId).toBe('33333333-3333-4333-8333-333333333333');
    expect(pending.jsonlPath).toBe(syncFile);

    typedManager.startDiscoveryPolling(pending.id, discoverWorkDir);
    typedManager.stopDiscoveryPolling(pending.id);
  });
});
