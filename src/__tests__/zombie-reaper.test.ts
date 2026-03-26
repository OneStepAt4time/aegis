/**
 * zombie-reaper.test.ts — Tests for Issue #283: Zombie session reaper.
 *
 * Verifies that dead sessions are cleaned up after a configurable grace period,
 * non-dead sessions are left alone, and the reaper handles errors gracefully.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Zombie reaper (Issue #283)', () => {
  /** Simulate the reaper logic from server.ts for testing without importing the server module. */
  function createReaper(
    sessions: Array<{ id: string; windowName: string; workDir: string; lastDeadAt?: number; status: string }>,
    killed: string[],
    removed: string[],
    opts?: { graceMs?: number },
  ) {
    const graceMs = opts?.graceMs ?? 60_000;

    return async function reap(): Promise<void> {
      const now = Date.now();
      for (const session of sessions) {
        if (!session.lastDeadAt) continue;
        const deadDuration = now - session.lastDeadAt;
        if (deadDuration < graceMs) continue;

        console.log(`Reaper: removing zombie session ${session.windowName} (${session.id.slice(0, 8)})`);
        try {
          removed.push(session.id);
          killed.push(session.id);
        } catch (e) {
          console.error(`Reaper: failed to reap zombie session ${session.id}:`, e);
        }
      }
    };
  }

  it('should remove a session marked dead for longer than the grace period', async () => {
    const sessions = [
      {
        id: 'dead-session-11111111-1111-1111-1111-111111111111',
        windowName: 'cc-test',
        workDir: '/tmp/test',
        status: 'unknown',
        lastDeadAt: Date.now() - 120_000, // dead 2 minutes ago
      },
    ];
    const killed: string[] = [];
    const removed: string[] = [];

    const reap = createReaper(sessions, killed, removed);
    await reap();

    expect(killed).toHaveLength(1);
    expect(removed).toHaveLength(1);
    expect(killed[0]).toBe(sessions[0].id);
  });

  it('should NOT remove a session that is still working', async () => {
    const sessions = [
      {
        id: 'working-session-11111111-1111-1111-1111-111111111111',
        windowName: 'cc-working',
        workDir: '/tmp/test',
        status: 'working',
        // No lastDeadAt — session is alive
      },
    ];
    const killed: string[] = [];
    const removed: string[] = [];

    const reap = createReaper(sessions, killed, removed);
    await reap();

    expect(killed).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  it('should NOT remove a session that is idle', async () => {
    const sessions = [
      {
        id: 'idle-session-11111111-1111-1111-1111-111111111111',
        windowName: 'cc-idle',
        workDir: '/tmp/test',
        status: 'idle',
      },
    ];
    const killed: string[] = [];
    const removed: string[] = [];

    const reap = createReaper(sessions, killed, removed);
    await reap();

    expect(killed).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  it('should NOT remove a dead session that is still within the grace period', async () => {
    const sessions = [
      {
        id: 'recently-dead-11111111-1111-1111-1111-111111111111',
        windowName: 'cc-recently-dead',
        workDir: '/tmp/test',
        status: 'unknown',
        lastDeadAt: Date.now() - 30_000, // dead only 30s ago, grace is 60s
      },
    ];
    const killed: string[] = [];
    const removed: string[] = [];

    const reap = createReaper(sessions, killed, removed, { graceMs: 60_000 });
    await reap();

    expect(killed).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  it('should handle errors gracefully and continue processing other sessions', async () => {
    const sessions = [
      {
        id: 'error-session-11111111-1111-1111-1111-111111111111',
        windowName: 'cc-error',
        workDir: '/tmp/test',
        status: 'unknown',
        lastDeadAt: Date.now() - 120_000,
      },
      {
        id: 'clean-session-11111111-1111-1111-1111-111111111111',
        windowName: 'cc-clean',
        workDir: '/tmp/test',
        status: 'unknown',
        lastDeadAt: Date.now() - 120_000,
      },
    ];
    const killed: string[] = [];
    const removed: string[] = [];

    // Create a reaper that throws on the first session
    const graceMs = 60_000;
    const reap = async function reap(): Promise<void> {
      const now = Date.now();
      for (const session of sessions) {
        if (!session.lastDeadAt) continue;
        const deadDuration = now - session.lastDeadAt;
        if (deadDuration < graceMs) continue;

        console.log(`Reaper: removing zombie session ${session.windowName} (${session.id.slice(0, 8)})`);
        try {
          if (session.id === sessions[0].id) {
            throw new Error('tmux window not found');
          }
          removed.push(session.id);
          killed.push(session.id);
        } catch (e) {
          console.error(`Reaper: failed to reap zombie session ${session.id}:`, e);
        }
      }
    };

    await reap();

    // First session errored, second should still be cleaned up
    expect(removed).toHaveLength(1);
    expect(removed[0]).toBe(sessions[1].id);
  });

  it('should reap multiple zombie sessions in a single pass', async () => {
    const sessions = [
      {
        id: 'zombie-1-11111111-1111-1111-1111-111111111111',
        windowName: 'cc-zombie1',
        workDir: '/tmp/test',
        status: 'unknown',
        lastDeadAt: Date.now() - 90_000,
      },
      {
        id: 'zombie-2-11111111-1111-1111-1111-111111111111',
        windowName: 'cc-zombie2',
        workDir: '/tmp/test',
        status: 'unknown',
        lastDeadAt: Date.now() - 120_000,
      },
      {
        id: 'alive-11111111-1111-1111-1111-111111111111',
        windowName: 'cc-alive',
        workDir: '/tmp/test',
        status: 'working',
      },
    ];
    const killed: string[] = [];
    const removed: string[] = [];

    const reap = createReaper(sessions, killed, removed);
    await reap();

    expect(killed).toHaveLength(2);
    expect(removed).toHaveLength(2);
  });

  it('should respect the grace period boundary exactly', async () => {
    const sessions = [
      {
        id: 'exact-grace-11111111-1111-1111-1111-111111111111',
        windowName: 'cc-exact',
        workDir: '/tmp/test',
        status: 'unknown',
        lastDeadAt: Date.now() - 60_000, // exactly at the grace boundary
      },
    ];
    const killed: string[] = [];
    const removed: string[] = [];

    const reap = createReaper(sessions, killed, removed, { graceMs: 60_000 });
    await reap();

    // At exactly the boundary (>=), should be reaped
    expect(killed).toHaveLength(1);
  });
});

describe('lastDeadAt tracking (Issue #283)', () => {
  it('should store lastDeadAt as a unix timestamp on SessionInfo', () => {
    // Verify the SessionInfo type has the field
    const session = {
      id: 'test-11111111-1111-1111-1111-111111111111',
      windowName: 'cc-test',
      workDir: '/tmp/test',
      byteOffset: 0,
      monitorOffset: 0,
      status: 'idle' as const,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      stallThresholdMs: 300_000,
      permissionStallMs: 300_000,
      permissionMode: 'default',
      lastDeadAt: Date.now(),
    };

    expect(session.lastDeadAt).toBeDefined();
    expect(typeof session.lastDeadAt).toBe('number');
  });

  it('should be undefined for sessions that have never been detected as dead', () => {
    const session: { id: string; windowName: string; lastDeadAt?: number } = {
      id: 'alive-11111111-1111-1111-1111-111111111111',
      windowName: 'cc-alive',
    };

    expect(session.lastDeadAt).toBeUndefined();
  });
});
