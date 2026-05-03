/**
 * premature-termination.test.ts — Tests for Issue #2520.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import type { TmuxManager } from '../tmux.js';
import { SessionManager } from '../session.js';
import { mkdirSync, rmSync } from 'fs';

const SESSION_ID = '00000000-0000-0000-0000-000000002520';
const STATE_DIR = '/tmp/premature-test-2520';

function makeTmux(): TmuxManager {
  return {
    listWindows: vi.fn().mockResolvedValue([]),
    killWindow: vi.fn().mockResolvedValue(true),
    createWindow: vi.fn().mockResolvedValue({ windowId: '@test', windowName: 'test' }),
    sendKeys: vi.fn().mockResolvedValue(undefined),
    capturePane: vi.fn().mockResolvedValue(''),
    resizePane: vi.fn().mockResolvedValue(undefined),
    getWindowName: vi.fn().mockResolvedValue('test'),
    isAlive: vi.fn().mockResolvedValue(true),
    getSessionPanes: vi.fn().mockResolvedValue([]),
  } as unknown as TmuxManager;
}

function makeConfig(): any {
  return {
    stateDir: STATE_DIR,
    maxSessions: 10,
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    hookSettingsFile: undefined,
    hookSecret: undefined,
    dashboardDir: '/tmp',
  };
}

function makeManager(): SessionManager {
  return new SessionManager(makeTmux(), makeConfig());
}

function setupSession(manager: SessionManager, now: number, createdAtOffset: number): void {
  manager['state'].sessions[SESSION_ID] = {
    id: SESSION_ID,
    windowId: '@2520',
    windowName: 'premature-test',
    workDir: '/tmp/premature-test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: now - createdAtOffset,
    lastActivity: now,
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    toolUseCount: 0,
  };
}

describe('Premature termination detection (Issue #2520)', () => {
  let manager: SessionManager;
  let origEnv: string | undefined;

  beforeAll(() => {
    mkdirSync(STATE_DIR, { recursive: true });
  });

  beforeEach(() => {
    origEnv = process.env.PREMATURE_TERMINATION_MIN_TOOLS;
    delete process.env.PREMATURE_TERMINATION_MIN_TOOLS;
    delete process.env.PREMATURE_TERMINATION_MIN_DURATION_MS;
    manager = makeManager();
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.PREMATURE_TERMINATION_MIN_TOOLS = origEnv;
    } else {
      delete process.env.PREMATURE_TERMINATION_MIN_TOOLS;
    }
  });

  afterAll(() => {
    rmSync(STATE_DIR, { recursive: true, force: true });
  });

  it('flags session as premature when tool count <= 30 and duration >= 30s', () => {
    const now = Date.now();
    setupSession(manager, now, 60_000);

    for (let i = 0; i < 15; i++) {
      manager.updateStatusFromHook(SESSION_ID, 'PreToolUse');
    }

    manager.updateStatusFromHook(SESSION_ID, 'TaskCompleted');

    const session = manager.getSession(SESSION_ID)!;
    expect(session.toolUseCount).toBe(15);
    expect(session.prematureTermination).toBe(true);
  });

  it('does NOT flag session when tool count > 30', () => {
    const now = Date.now();
    setupSession(manager, now, 60_000);

    for (let i = 0; i < 40; i++) {
      manager.updateStatusFromHook(SESSION_ID, 'PreToolUse');
    }

    manager.updateStatusFromHook(SESSION_ID, 'TaskCompleted');

    const session = manager.getSession(SESSION_ID)!;
    expect(session.toolUseCount).toBe(40);
    expect(session.prematureTermination).toBeFalsy();
  });

  it('does NOT flag session when duration < 30s', () => {
    const now = Date.now();
    setupSession(manager, now, 5_000);

    for (let i = 0; i < 10; i++) {
      manager.updateStatusFromHook(SESSION_ID, 'PreToolUse');
    }

    manager.updateStatusFromHook(SESSION_ID, 'TaskCompleted');

    const session = manager.getSession(SESSION_ID)!;
    expect(session.toolUseCount).toBe(10);
    expect(session.prematureTermination).toBeFalsy();
  });

  it('does NOT flag when toolUseCount is undefined', () => {
    const now = Date.now();
    setupSession(manager, now, 60_000);
    manager['state'].sessions[SESSION_ID].toolUseCount = undefined;

    manager.updateStatusFromHook(SESSION_ID, 'TaskCompleted');

    const session = manager.getSession(SESSION_ID)!;
    expect(session.prematureTermination).toBeFalsy();
  });

  it('respects PREMATURE_TERMINATION_MIN_TOOLS env var', () => {
    process.env.PREMATURE_TERMINATION_MIN_TOOLS = '5';

    const now = Date.now();
    setupSession(manager, now, 60_000);

    for (let i = 0; i < 3; i++) {
      manager.updateStatusFromHook(SESSION_ID, 'PreToolUse');
    }

    manager.updateStatusFromHook(SESSION_ID, 'Stop');

    const session = manager.getSession(SESSION_ID)!;
    expect(session.prematureTermination).toBe(true);
  });

  it('flags on Stop event, not just TaskCompleted', () => {
    const now = Date.now();
    setupSession(manager, now, 60_000);

    for (let i = 0; i < 10; i++) {
      manager.updateStatusFromHook(SESSION_ID, 'PreToolUse');
    }

    manager.updateStatusFromHook(SESSION_ID, 'Stop');

    const session = manager.getSession(SESSION_ID)!;
    expect(session.prematureTermination).toBe(true);
  });

  it('does NOT flag on non-terminal events', () => {
    const now = Date.now();
    setupSession(manager, now, 60_000);

    for (let i = 0; i < 10; i++) {
      manager.updateStatusFromHook(SESSION_ID, 'PreToolUse');
    }

    manager.updateStatusFromHook(SESSION_ID, 'PostToolUse');

    const session = manager.getSession(SESSION_ID)!;
    expect(session.prematureTermination).toBeFalsy();
  });

  it('increments toolUseCount for each PreToolUse event', () => {
    const now = Date.now();
    setupSession(manager, now, 60_000);

    manager.updateStatusFromHook(SESSION_ID, 'PreToolUse');
    manager.updateStatusFromHook(SESSION_ID, 'PreToolUse');
    manager.updateStatusFromHook(SESSION_ID, 'PreToolUse');

    const session = manager.getSession(SESSION_ID)!;
    expect(session.toolUseCount).toBe(3);
  });
});
