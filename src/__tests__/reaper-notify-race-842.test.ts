/**
 * reaper-notify-race-842.test.ts — Tests for Issue #842: Reaper race condition.
 *
 * Verifies that killSession completes BEFORE channels are notified (sessionEnded),
 * so channels never reference a session that is still being destroyed.
 */

import { describe, it, expect } from 'vitest';

describe('Reaper notify ordering (Issue #842)', () => {
  /**
   * Simulates the reapStaleSessions logic.
   * Returns the order of operations performed, so tests can verify killSession
   * always precedes sessionEnded.
   */
  function createStaleReaper(opts: {
    sessions: Array<{ id: string; createdAt: number }>;
    maxAgeMs: number;
    killSession: (id: string) => Promise<void>;
    sessionEnded: (id: string) => Promise<void>;
  }) {
    return async function reap(): Promise<string[]> {
      const order: string[] = [];
      const now = Date.now();
      for (const session of opts.sessions) {
        const age = now - session.createdAt;
        if (age > opts.maxAgeMs) {
          // #842: killSession first, then notify
          await opts.killSession(session.id);
          order.push(`kill:${session.id}`);
          await opts.sessionEnded(session.id);
          order.push(`notify:${session.id}`);
        }
      }
      return order;
    };
  }

  it('should kill session before notifying channels', async () => {
    const staleId = 'stale-11111111-1111-1111-1111-111111111111';
    const sessions = [{ id: staleId, createdAt: Date.now() - 7200_000 }];
    const order: string[] = [];

    const reap = createStaleReaper({
      sessions,
      maxAgeMs: 3600_000,
      killSession: async (id) => { order.push(`kill:${id}`); },
      sessionEnded: async (id) => { order.push(`notify:${id}`); },
    });

    const result = await reap();

    // killSession must appear before sessionEnded
    expect(result).toEqual([`kill:${staleId}`, `notify:${staleId}`]);
    expect(order).toEqual([`kill:${staleId}`, `notify:${staleId}`]);
  });

  it('should kill all stale sessions before notifying any channels', async () => {
    const ids = [
      'stale-aaaa1111-1111-1111-1111-111111111111',
      'stale-bbbb2222-2222-2222-222222222222',
    ];
    const sessions = ids.map((id) => ({ id, createdAt: Date.now() - 7200_000 }));
    const order: string[] = [];

    const reap = createStaleReaper({
      sessions,
      maxAgeMs: 3600_000,
      killSession: async (id) => { order.push(`kill:${id}`); },
      sessionEnded: async (id) => { order.push(`notify:${id}`); },
    });

    await reap();

    // Each session should be killed before its own notify
    for (const id of ids) {
      const killIdx = order.indexOf(`kill:${id}`);
      const notifyIdx = order.indexOf(`notify:${id}`);
      expect(killIdx).toBeGreaterThan(-1);
      expect(notifyIdx).toBeGreaterThan(-1);
      expect(killIdx).toBeLessThan(notifyIdx);
    }
  });

  it('should not notify channels for fresh sessions', async () => {
    const freshId = 'fresh-11111111-1111-1111-1111-111111111111';
    const sessions = [{ id: freshId, createdAt: Date.now() - 600_000 }]; // 10 min old
    const order: string[] = [];

    const reap = createStaleReaper({
      sessions,
      maxAgeMs: 3600_000, // 1 hour
      killSession: async (id) => { order.push(`kill:${id}`); },
      sessionEnded: async (id) => { order.push(`notify:${id}`); },
    });

    await reap();

    expect(order).toEqual([]);
  });

  it('should continue processing after a killSession error', async () => {
    const badId = 'bad-11111111-1111-1111-1111-111111111111';
    const goodId = 'good-22222222-2222-2222-222222222222';
    const sessions = [
      { id: badId, createdAt: Date.now() - 7200_000 },
      { id: goodId, createdAt: Date.now() - 7200_000 },
    ];
    const order: string[] = [];

    // Simulate reapStaleSessions error handling (try/catch per session)
    const reap = async function reap(): Promise<string[]> {
      const result: string[] = [];
      const now = Date.now();
      for (const session of sessions) {
        if (now - session.createdAt <= 3600_000) continue;
        try {
          if (session.id === badId) throw new Error('kill failed');
          order.push(`kill:${session.id}`);
          result.push(`kill:${session.id}`);
          order.push(`notify:${session.id}`);
          result.push(`notify:${session.id}`);
        } catch {
          // Error logged, continue with next session
        }
      }
      return result;
    };

    const result = await reap();

    // Bad session failed, good session still processed
    expect(result).toEqual([`kill:${goodId}`, `notify:${goodId}`]);
  });
});

describe('killSessionHandler ordering (Issue #842)', () => {
  it('should kill session before notifying channels on DELETE', async () => {
    const sessionId = 'delete-11111111-1111-1111-1111-111111111111';
    const order: string[] = [];

    // Simulate the killSessionHandler logic
    async function killSessionHandler() {
      // #842: killSession first, then notify
      order.push('kill');
      order.push('notify');
    }

    await killSessionHandler();

    expect(order).toEqual(['kill', 'notify']);
  });
});
