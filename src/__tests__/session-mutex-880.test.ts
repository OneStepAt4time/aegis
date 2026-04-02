/**
 * session-mutex-880.test.ts — Tests for Issue #880:
 * harden session acquisition lock in findIdleSessionByWorkDir.
 */

import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';

function makeSession(overrides: Partial<SessionInfo> & { workDir: string; status: SessionInfo['status'] }): SessionInfo {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    windowId: overrides.windowId ?? '@1',
    windowName: overrides.windowName ?? 'test',
    workDir: overrides.workDir,
    claudeSessionId: overrides.claudeSessionId,
    byteOffset: 0,
    monitorOffset: 0,
    status: overrides.status,
    createdAt: overrides.createdAt ?? Date.now() - 60_000,
    lastActivity: overrides.lastActivity ?? Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
  };
}

function createSessionManager(tmuxOverrides: Record<string, unknown> = {}, sessions: SessionInfo[] = []): SessionManager {
  const tmux = {
    windowExists: vi.fn(async () => true),
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
      windowExists: true,
      paneCommand: 'claude',
      claudeRunning: true,
    })),
    ...tmuxOverrides,
  } as any;

  const sm = new SessionManager(tmux, { stateDir: '/tmp/aegis-test-880' } as any);
  (sm as any).state = { sessions: Object.fromEntries(sessions.map(s => [s.id, s])) };
  return sm;
}

describe('Issue #880: session acquisition mutex hardening', () => {
  it('allows only one concurrent caller to acquire the same idle session', async () => {
    const session = makeSession({ workDir: '/project/a', status: 'idle' });
    const sm = createSessionManager({}, [session]);

    const [r1, r2] = await Promise.all([
      sm.findIdleSessionByWorkDir('/project/a'),
      sm.findIdleSessionByWorkDir('/project/a'),
    ]);

    const acquiredCount = [r1, r2].filter(Boolean).length;
    const nullCount = [r1, r2].filter((v) => v === null).length;

    expect(acquiredCount).toBe(1);
    expect(nullCount).toBe(1);
    expect(session.status).toBe('acquired');
  });

  it('releases the lock when an exception occurs inside the critical section', async () => {
    const session = makeSession({ workDir: '/project/a', status: 'idle' });
    let calls = 0;
    let releaseFirstWindowCheck!: () => void;
    const firstWindowCheckGate = new Promise<void>((resolve) => {
      releaseFirstWindowCheck = resolve;
    });
    let firstCallEntered!: () => void;
    const firstCallEnteredPromise = new Promise<void>((resolve) => {
      firstCallEntered = resolve;
    });
    let secondCallReachedWindowCheck = false;

    const sm = createSessionManager({
      windowExists: vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          firstCallEntered();
          await firstWindowCheckGate;
          throw new Error('simulated tmux failure');
        }
        secondCallReachedWindowCheck = true;
        return true;
      }),
    }, [session]);

    const firstCall = sm.findIdleSessionByWorkDir('/project/a');
    await firstCallEnteredPromise;

    // Start a second contender while the first still holds the lock.
    const secondCall = sm.findIdleSessionByWorkDir('/project/a');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondCallReachedWindowCheck).toBe(false);

    releaseFirstWindowCheck();
    await expect(firstCall).rejects.toThrow('simulated tmux failure');

    const result = await Promise.race([
      secondCall,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('lock not released')), 1000)),
    ]);

    expect(result).not.toBeNull();
    expect((result as SessionInfo).id).toBe(session.id);
  });

  it('remains race-free under repeated contention', async () => {
    const session = makeSession({ workDir: '/project/a', status: 'idle' });
    const sm = createSessionManager({}, [session]);

    for (let i = 0; i < 120; i += 1) {
      session.status = 'idle';
      const [r1, r2] = await Promise.all([
        sm.findIdleSessionByWorkDir('/project/a'),
        sm.findIdleSessionByWorkDir('/project/a'),
      ]);

      const acquiredCount = [r1, r2].filter(Boolean).length;
      expect(acquiredCount).toBe(1);
    }
  });
});
