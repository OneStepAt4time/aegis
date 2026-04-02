/**
 * sendmsg-activity-838.test.ts — Issue #838: sendMessage must not update
 * lastActivity when delivery fails.
 *
 * Tests the conditional guard in sendMessage / sendMessageDirect so that
 * sessions with failed message delivery do not appear artificially active.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';
import type { Config } from '../config.js';
import type { TmuxManager } from '../tmux.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(stateDir: string): Config {
  return {
    port: 0,
    host: 'localhost',
    authToken: '',
    tmuxSession: 'test',
    stateDir,
    claudeProjectsDir: '/tmp/.claude/projects',
    maxSessionAgeMs: 30 * 60 * 1000,
    reaperIntervalMs: 60_000,
    tgBotToken: '',
    tgGroupId: '',
    tgAllowedUsers: [],
    webhooks: [],
    defaultSessionEnv: {},
    defaultPermissionMode: 'default',
    stallThresholdMs: 5 * 60 * 1000,
    sseMaxConnections: 100,
    sseMaxPerIp: 10,
    allowedWorkDirs: [],
  } as Config;
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'test-session-id',
    windowId: '@0',
    windowName: 'cc-test',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now() - 60_000,
    lastActivity: 1000, // fixed old timestamp
    stallThresholdMs: 5 * 60 * 1000,
    permissionStallMs: 5 * 60 * 1000,
    permissionMode: 'default',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Issue #838: sendMessage lastActivity guard', () => {
  let stateDir: string;
  let tmux: TmuxManager;
  let manager: SessionManager;

  beforeEach(async () => {
    stateDir = join(tmpdir(), `aegis-test-838-${Date.now()}`);
    await mkdir(stateDir, { recursive: true });

    // Write a state file with one session (top-level is Record<id, SessionInfo>)
    const session = makeSession();
    await writeFile(
      join(stateDir, 'state.json'),
      JSON.stringify({ [session.id]: session }),
    );

    tmux = {
      sendKeysVerified: vi.fn(),
      listWindows: vi.fn(async () => [{ windowId: '@0', windowName: 'cc-test' }]),
      capturePane: vi.fn(async () => ''),
      sendKeys: vi.fn(async () => {}),
      isWindowAlive: vi.fn(async () => true),
    } as unknown as TmuxManager;

    const config = makeConfig(stateDir);
    manager = new SessionManager(tmux, config);
    await manager.load();
  });

  afterEach(async () => {
    // Clean up temp dir (skip if missing)
    try { await rm(stateDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it('should NOT update lastActivity when delivery fails', async () => {
    const sessionId = 'test-session-id';
    const beforeActivity = manager.getSession(sessionId)!.lastActivity;

    // Simulate failed delivery
    (tmux.sendKeysVerified as ReturnType<typeof vi.fn>).mockResolvedValue({
      delivered: false,
      attempts: 3,
    });

    const result = await manager.sendMessage(sessionId, 'hello');

    expect(result.delivered).toBe(false);
    expect(result.attempts).toBe(3);

    // lastActivity must NOT have changed
    const afterActivity = manager.getSession(sessionId)!.lastActivity;
    expect(afterActivity).toBe(beforeActivity);
  });

  it('should update lastActivity when delivery succeeds', async () => {
    const sessionId = 'test-session-id';
    const beforeActivity = manager.getSession(sessionId)!.lastActivity;

    // Simulate successful delivery
    (tmux.sendKeysVerified as ReturnType<typeof vi.fn>).mockResolvedValue({
      delivered: true,
      attempts: 1,
    });

    const result = await manager.sendMessage(sessionId, 'hello');

    expect(result.delivered).toBe(true);

    // lastActivity MUST have been updated
    const afterActivity = manager.getSession(sessionId)!.lastActivity;
    expect(afterActivity).toBeGreaterThan(beforeActivity);
  });
});
