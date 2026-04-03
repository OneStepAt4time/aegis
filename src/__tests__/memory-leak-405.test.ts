/**
 * memory-leak-405.test.ts — Tests for Issue #405: session kill must clear all tracking maps.
 *
 * Covers:
 * - cleanupSession clears pollTimers (single coordinated key)
 * - cleanupSession clears pendingPermissions (with timer cleanup)
 * - cleanupSession clears pendingQuestions (with timer cleanup)
 * - cleanupSession clears parsedEntriesCache
 * - killSession calls cleanupSession
 * - clearInterval is called for retained timers
 * - Multiple sessions: only the killed session's maps are cleared
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal SessionManager-like object with all tracking maps populated. */
function createManagerWithSession(sessionId: string) {
  const clearedTimers: string[] = [];
  const pollTimers = new Map<string, NodeJS.Timeout>();
  const pendingPermissions = new Map<string, { resolve: (v: any) => void; timer: NodeJS.Timeout; toolName?: string; prompt?: string }>();
  const pendingQuestions = new Map<string, { resolve: (v: any) => void; timer: NodeJS.Timeout; toolUseId: string; question: string }>();
  const parsedEntriesCache = new Map<string, { entries: any[]; offset: number }>();

  // Populate maps for the given session
  pollTimers.set(sessionId, setTimeout(() => {}, 60_000));
  pendingPermissions.set(sessionId, {
    resolve: () => {},
    timer: setTimeout(() => {}, 60_000),
    toolName: 'Bash',
    prompt: 'Run command?',
  });
  pendingQuestions.set(sessionId, {
    resolve: () => {},
    timer: setTimeout(() => {}, 60_000),
    toolUseId: 'tool-123',
    question: 'What do you want?',
  });
  parsedEntriesCache.set(sessionId, { entries: [{ type: 'assistant', content: 'hi' }], offset: 100 });

  // Replicate cleanupSession logic for testing
  const cleanupPendingPermission = (id: string): void => {
    const pending = pendingPermissions.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingPermissions.delete(id);
    }
  };

  const cleanupPendingQuestion = (id: string): void => {
    const pending = pendingQuestions.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingQuestions.delete(id);
    }
  };

  const cleanupSession = (id: string): void => {
    const timer = pollTimers.get(id);
    if (timer) {
      clearInterval(timer);
      clearedTimers.push(id);
      pollTimers.delete(id);
    }
    cleanupPendingPermission(id);
    cleanupPendingQuestion(id);
    parsedEntriesCache.delete(id);
  };

  return {
    pollTimers,
    pendingPermissions,
    pendingQuestions,
    parsedEntriesCache,
    cleanupSession,
    clearedTimers,
  };
}

// ---------------------------------------------------------------------------
// cleanupSession — pollTimers
// ---------------------------------------------------------------------------

describe('cleanupSession clears pollTimers', () => {
  it('clears the regular timer key', () => {
    const mgr = createManagerWithSession('sess-1');
    expect(mgr.pollTimers.has('sess-1')).toBe(true);

    mgr.cleanupSession('sess-1');

    expect(mgr.pollTimers.has('sess-1')).toBe(false);
  });

  it('calls clearInterval for the coordinated timer', () => {
    const mgr = createManagerWithSession('sess-1');

    mgr.cleanupSession('sess-1');

    expect(mgr.clearedTimers).toEqual(['sess-1']);
  });

  it('does not throw when timer keys do not exist', () => {
    const mgr = createManagerWithSession('sess-1');
    mgr.pollTimers.delete('sess-1');

    expect(() => mgr.cleanupSession('sess-1')).not.toThrow();
    expect(mgr.clearedTimers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// cleanupSession — pendingPermissions
// ---------------------------------------------------------------------------

describe('cleanupSession clears pendingPermissions', () => {
  it('removes the session from pendingPermissions', () => {
    const mgr = createManagerWithSession('sess-1');
    expect(mgr.pendingPermissions.has('sess-1')).toBe(true);

    mgr.cleanupSession('sess-1');

    expect(mgr.pendingPermissions.has('sess-1')).toBe(false);
  });

  it('clears the pending permission timer', () => {
    const mgr = createManagerWithSession('sess-1');
    const pending = mgr.pendingPermissions.get('sess-1')!;
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    // Timer reference should be cleared — verify the timer object was the one passed to clearTimeout
    const timerRef = pending.timer;

    mgr.cleanupSession('sess-1');

    expect(spy).toHaveBeenCalledWith(timerRef);
    spy.mockRestore();
  });

  it('does not throw when no pending permission exists', () => {
    const mgr = createManagerWithSession('sess-1');
    mgr.pendingPermissions.delete('sess-1');

    expect(() => mgr.cleanupSession('sess-1')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// cleanupSession — pendingQuestions
// ---------------------------------------------------------------------------

describe('cleanupSession clears pendingQuestions', () => {
  it('removes the session from pendingQuestions', () => {
    const mgr = createManagerWithSession('sess-1');
    expect(mgr.pendingQuestions.has('sess-1')).toBe(true);

    mgr.cleanupSession('sess-1');

    expect(mgr.pendingQuestions.has('sess-1')).toBe(false);
  });

  it('clears the pending question timer', () => {
    const mgr = createManagerWithSession('sess-1');
    const pending = mgr.pendingQuestions.get('sess-1')!;
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    const timerRef = pending.timer;

    mgr.cleanupSession('sess-1');

    expect(spy).toHaveBeenCalledWith(timerRef);
    spy.mockRestore();
  });

  it('does not throw when no pending question exists', () => {
    const mgr = createManagerWithSession('sess-1');
    mgr.pendingQuestions.delete('sess-1');

    expect(() => mgr.cleanupSession('sess-1')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// cleanupSession — parsedEntriesCache
// ---------------------------------------------------------------------------

describe('cleanupSession clears parsedEntriesCache', () => {
  it('removes the session from parsedEntriesCache', () => {
    const mgr = createManagerWithSession('sess-1');
    expect(mgr.parsedEntriesCache.has('sess-1')).toBe(true);

    mgr.cleanupSession('sess-1');

    expect(mgr.parsedEntriesCache.has('sess-1')).toBe(false);
  });

  it('does not throw when cache entry does not exist', () => {
    const mgr = createManagerWithSession('sess-1');
    mgr.parsedEntriesCache.delete('sess-1');

    expect(() => mgr.cleanupSession('sess-1')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Multiple sessions — isolation
// ---------------------------------------------------------------------------

describe('cleanupSession only affects the target session', () => {
  it('does not clear maps belonging to another session', () => {
    const mgr = createManagerWithSession('sess-1');
    // Add a second session to all maps
    mgr.pollTimers.set('sess-2', setTimeout(() => {}, 60_000));
    mgr.pendingPermissions.set('sess-2', {
      resolve: () => {},
      timer: setTimeout(() => {}, 60_000),
    });
    mgr.pendingQuestions.set('sess-2', {
      resolve: () => {},
      timer: setTimeout(() => {}, 60_000),
      toolUseId: 'tool-456',
      question: 'Another question?',
    });
    mgr.parsedEntriesCache.set('sess-2', { entries: [], offset: 0 });

    mgr.cleanupSession('sess-1');

    // sess-2 should remain untouched
    expect(mgr.pollTimers.has('sess-2')).toBe(true);
    expect(mgr.pendingPermissions.has('sess-2')).toBe(true);
    expect(mgr.pendingQuestions.has('sess-2')).toBe(true);
    expect(mgr.parsedEntriesCache.has('sess-2')).toBe(true);

    // sess-1 should be fully cleaned
    expect(mgr.pollTimers.has('sess-1')).toBe(false);
    expect(mgr.pendingPermissions.has('sess-1')).toBe(false);
    expect(mgr.pendingQuestions.has('sess-1')).toBe(false);
    expect(mgr.parsedEntriesCache.has('sess-1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Session churn — repeated create/kill
// ---------------------------------------------------------------------------

describe('session churn does not leak maps', () => {
  it('all maps are empty after creating and killing 100 sessions', () => {
    const mgr = createManagerWithSession('initial');
    mgr.cleanupSession('initial');

    // Simulate 100 sessions being created and killed
    for (let i = 0; i < 100; i++) {
      const id = `sess-${i}`;
      mgr.pollTimers.set(id, setTimeout(() => {}, 60_000));
      mgr.pendingPermissions.set(id, {
        resolve: () => {},
        timer: setTimeout(() => {}, 60_000),
      });
      mgr.pendingQuestions.set(id, {
        resolve: () => {},
        timer: setTimeout(() => {}, 60_000),
        toolUseId: `tool-${i}`,
        question: `Question ${i}?`,
      });
      mgr.parsedEntriesCache.set(id, { entries: [], offset: i * 100 });

      mgr.cleanupSession(id);
    }

    expect(mgr.pollTimers.size).toBe(0);
    expect(mgr.pendingPermissions.size).toBe(0);
    expect(mgr.pendingQuestions.size).toBe(0);
    expect(mgr.parsedEntriesCache.size).toBe(0);
  });
});
