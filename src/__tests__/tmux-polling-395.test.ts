/**
 * tmux-polling-395.test.ts — Tests for Issue #395.
 *
 * Validates that session discovery uses a single coordinated poller per session,
 * and that discovery still updates session mapping data correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager, type SessionInfo } from '../session.js';
import type { TmuxManager } from '../tmux.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

function flushAsync(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function makeSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    id: overrides.id ?? 'sess-1',
    windowId: overrides.windowId ?? '@1',
    windowName: overrides.windowName ?? 'cc-sess-1',
    workDir: overrides.workDir ?? '/tmp/work-395',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'unknown',
    createdAt: overrides.createdAt ?? Date.now(),
    lastActivity: overrides.lastActivity ?? Date.now(),
    stallThresholdMs: 120_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    claudeSessionId: overrides.claudeSessionId,
    jsonlPath: overrides.jsonlPath,
  };
}

describe.skipIf(process.platform === 'win32')('Issue #395: consolidated tmux discovery polling', () => {
  let rootTmpDir: string;

  beforeEach(() => {
    rootTmpDir = mkdtempSync(join(tmpdir(), 'aegis-395-'));
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(rootTmpDir, { recursive: true, force: true });
  });

  it('keeps only one active discovery poller per session', () => {
    const stateDir = join(rootTmpDir, 'state');
    const claudeProjectsDir = join(rootTmpDir, 'projects');
    const tmux = {} as TmuxManager;

    const sm = new SessionManager(tmux, {
      stateDir,
      claudeProjectsDir,
      continuationPointerTtlMs: 60_000,
      worktreeAwareContinuation: false,
      worktreeSiblingDirs: [],
    } as any);

    (sm as any).state = {
      sessions: {
        'sess-1': makeSession({ id: 'sess-1', createdAt: Date.now() - 1_000 }),
      },
    };

    (sm as any).startDiscoveryPolling('sess-1', '/tmp/work-395');
    expect((sm as any).pollTimers.size).toBe(1);
    expect((sm as any).pollTimers.has('sess-1')).toBe(true);

    // Starting again should replace, not duplicate.
    (sm as any).startDiscoveryPolling('sess-1', '/tmp/work-395');
    expect((sm as any).pollTimers.size).toBe(1);
    expect((sm as any).pollTimers.has('sess-1')).toBe(true);
    expect((sm as any).discoveryTimeouts.size).toBe(1);

    (sm as any).cleanupSession('sess-1');
    expect((sm as any).pollTimers.size).toBe(0);
    expect((sm as any).discoveryTimeouts.size).toBe(0);
    expect((sm as any).discoveryNextFilesystemScanAt.size).toBe(0);
  });

  it('still updates claudeSessionId/jsonlPath through coordinated poller', async () => {
    const stateDir = join(rootTmpDir, 'state');
    const claudeProjectsDir = join(rootTmpDir, 'projects');
    const tmux = {} as TmuxManager;

    const sm = new SessionManager(tmux, {
      stateDir,
      claudeProjectsDir,
      continuationPointerTtlMs: 60_000,
      worktreeAwareContinuation: false,
      worktreeSiblingDirs: [],
    } as any);

    const workDir = '/tmp/work-395';
    const projectHash = '-' + workDir.replace(/^\//, '').replace(/\//g, '-');
    const projectDir = join(claudeProjectsDir, projectHash);
    mkdirSync(projectDir, { recursive: true });

    const claudeSessionId = '11111111-2222-3333-4444-555555555555';
    const jsonlPath = join(projectDir, `${claudeSessionId}.jsonl`);
    writeFileSync(jsonlPath, '{"type":"user","message":{"role":"user","content":"hi"}}\n');

    const session = makeSession({
      id: 'sess-2',
      windowId: '@2',
      windowName: 'cc-sess-2',
      workDir,
      createdAt: Date.now() - 2_000,
    });

    (sm as any).state = { sessions: { 'sess-2': session } };

    (sm as any).startDiscoveryPolling('sess-2', workDir);

    vi.advanceTimersByTime(2_100);
    await flushAsync();
    await flushAsync();

    expect(session.claudeSessionId).toBe(claudeSessionId);
    expect(session.jsonlPath).toBe(jsonlPath);
    expect((sm as any).pollTimers.has('sess-2')).toBe(false);
  });
});
