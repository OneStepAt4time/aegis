/**
 * session-mutex-880.test.ts — Tests for Issue #880:
 * harden session acquisition lock in findIdleSessionByWorkDir.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resetFaultInjection } from '../fault-injection.js';
import { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';

function makeSession(overrides: Partial<SessionInfo> & { workDir: string; status: SessionInfo['status'] }): SessionInfo {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    windowId: overrides.windowId ?? '@1',
    displayName: overrides.displayName ?? 'test',
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

function createSessionManager(sessions: SessionInfo[] = []): SessionManager {
  const sm = new SessionManager({ stateDir: '/tmp/aegis-test-880' } as any);
  (sm as any).state = { sessions: Object.fromEntries(sessions.map(s => [s.id, s])) };
  return sm;
}

describe('Issue #880: session acquisition mutex hardening', () => {
  afterEach(() => {
    resetFaultInjection();
  });

  it('allows only one concurrent caller to acquire the same idle session', async () => {
    const session = makeSession({ workDir: '/project/a', status: 'idle' });
    const sm = createSessionManager([session]);

    const [r1, r2] = await Promise.all([
      sm.findIdleSessionByWorkDir('/project/a'),
      sm.findIdleSessionByWorkDir('/project/a'),
    ]);

    const acquiredCount = [r1, r2].filter(Boolean).length;
    const nullCount = [r1, r2].filter((v) => v === null).length;

    expect(acquiredCount).toBe(1);
    expect(nullCount).toBe(1);
    expect(session.status).toBe('working');
  });

  it('releases the lock when an exception occurs inside the critical section', async () => {
    const session = makeSession({ workDir: '/project/a', status: 'idle' });
    const sm = createSessionManager([session]);

    // Use fault injection to simulate a failure inside the mutex
    const { addFaultRule, clearFaultRules, setFaultInjectionEnabledForTest } = await import('../fault-injection.js');
    setFaultInjectionEnabledForTest(true);
    addFaultRule({ point: 'session.findIdleSessionByWorkDir.windowExists', mode: 'fatal', errorMessage: 'simulated failure' });

    await expect(sm.findIdleSessionByWorkDir('/project/a')).rejects.toThrow(/session\.findIdleSessionByWorkDir|simulated failure/);
    setFaultInjectionEnabledForTest(false);
    clearFaultRules();

    // Verify the lock was released — a second call should succeed
    session.status = 'idle';
    const secondCall = sm.findIdleSessionByWorkDir('/project/a');
    const result = await Promise.race([
      secondCall,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('lock not released')), 1000)),
    ]);

    expect(result).not.toBeNull();
    expect((result as SessionInfo).id).toBe(session.id);
  });

  it('remains race-free under repeated contention', async () => {
    const session = makeSession({ workDir: '/project/a', status: 'idle' });
    const sm = createSessionManager([session]);

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
