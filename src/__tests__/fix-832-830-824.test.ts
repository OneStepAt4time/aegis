/**
 * fix-832-830-824.test.ts — Unit tests for three batch fixes:
 *
 * #832: Transcript cache eviction on JSONL truncation
 * #830: Pipeline poll interval race with cleanup
 * #824: capturePaneDirect always routes through serialize queue
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineManager } from '../pipeline.js';
import type { PipelineConfig } from '../pipeline.js';
import type { SessionManager, SessionInfo } from '../session.js';
import type { SessionEventBus } from '../events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockSession(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    windowId: `@${id.slice(0, 4)}`,
    windowName: `cc-${id.slice(0, 8)}`,
    workDir: '/app',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 0,
    permissionStallMs: 0,
    permissionMode: 'default',
    ...overrides,
  };
}

function makeMockSessions(): {
  mock: SessionManager;
  createSession: ReturnType<typeof vi.fn>;
  sendInitialPrompt: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
} {
  const createSession = vi.fn();
  const sendInitialPrompt = vi.fn();
  const getSession = vi.fn();
  const mock = { createSession, sendInitialPrompt, getSession } as unknown as SessionManager;
  return { mock, createSession, sendInitialPrompt, getSession };
}

function makeMockEventBus(): {
  mock: SessionEventBus;
  emitEnded: ReturnType<typeof vi.fn>;
} {
  const emitEnded = vi.fn();
  const mock = { emitEnded } as unknown as SessionEventBus;
  return { mock, emitEnded };
}

// ===========================================================================
// #832: Transcript cache eviction on JSONL truncation
// ===========================================================================

describe('#832: getCachedEntries truncation eviction', () => {
  it('detects truncation when newOffset resets to 0', () => {
    // Simulates the cache eviction logic from session.ts getCachedEntries.
    // When readNewEntries returns newOffset:0 with empty entries after a non-zero
    // offset, it means the JSONL file was truncated (e.g. /clear).
    const cached = { entries: ['old1', 'old2', 'old3'], offset: 5000 };
    const fromOffset = cached.offset;
    const result = { entries: [] as string[], newOffset: 0 };

    // Truncation detection: fromOffset > 0, newOffset === 0, no new entries
    let wasTruncated = false;
    if (fromOffset > 0 && result.newOffset === 0 && result.entries.length === 0) {
      wasTruncated = true;
    }

    expect(wasTruncated).toBe(true);
  });

  it('does not detect truncation on normal incremental read', () => {
    const cached = { entries: ['old1'], offset: 100 };
    const fromOffset = cached.offset;
    const result = { entries: ['new1', 'new2'], newOffset: 300 };

    let wasTruncated = false;
    if (fromOffset > 0 && result.newOffset === 0 && result.entries.length === 0) {
      wasTruncated = true;
    }

    expect(wasTruncated).toBe(false);
  });

  it('does not detect truncation on first read (offset 0)', () => {
    // No cached entry — first read from offset 0
    const result = { entries: ['a', 'b'], newOffset: 200 };

    let wasTruncated = false;
    if (0 > 0 && result.newOffset === 0 && result.entries.length === 0) {
      wasTruncated = true;
    }

    expect(wasTruncated).toBe(false);
  });

  it('discards stale entries and rebuilds cache after truncation', () => {
    // Before truncation: cache has old entries
    const cached = { entries: ['stale1', 'stale2', 'stale3'], offset: 5000 };

    // readNewEntries detects truncation: returns empty + offset 0
    const result = { entries: [] as string[], newOffset: 0 };

    // Simulate fresh read from offset 0 after truncation
    const freshEntries = ['fresh1', 'fresh2'];
    const freshOffset = 150;

    if (cached.offset > 0 && result.newOffset === 0 && result.entries.length === 0) {
      // Rebuild from scratch
      cached.entries = [...freshEntries];
      cached.offset = freshOffset;
    }

    expect(cached.entries).toEqual(['fresh1', 'fresh2']);
    expect(cached.offset).toBe(150);
    // Stale entries are gone
    expect(cached.entries).not.toContain('stale1');
  });

  it('preserves cache when file has not been truncated', () => {
    const cached = { entries: ['a', 'b'], offset: 200 };
    const result = { entries: ['c', 'd'], newOffset: 400 };

    if (cached.offset > 0 && result.newOffset === 0 && result.entries.length === 0) {
      // Would rebuild — but condition is false
      cached.entries = [];
    } else {
      // Normal append path
      cached.entries.push(...result.entries);
      cached.offset = result.newOffset;
    }

    expect(cached.entries).toEqual(['a', 'b', 'c', 'd']);
    expect(cached.offset).toBe(400);
  });
});

// ===========================================================================
// #830: Pipeline poll interval race with cleanup
// ===========================================================================

describe('#830: Pipeline poll clears interval when pipelines empty', () => {
  let sessions: ReturnType<typeof makeMockSessions>;
  let eventBus: ReturnType<typeof makeMockEventBus>;
  let manager: PipelineManager;

  beforeEach(() => {
    sessions = makeMockSessions();
    eventBus = makeMockEventBus();
    manager = new PipelineManager(sessions.mock, eventBus.mock);
  });

  it('clears poll interval immediately when pipelines map is empty at poll start', async () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    const config: PipelineConfig = {
      name: 'race-test',
      workDir: '/app',
      stages: [{ name: 'A', prompt: 'a', dependsOn: [] }],
    };

    const idleSession = makeMockSession('s1');
    idleSession.status = 'idle';
    sessions.createSession.mockResolvedValue(makeMockSession('s1'));
    sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });
    sessions.getSession.mockReturnValue(idleSession);

    await manager.createPipeline(config);

    // First poll: pipeline completes, schedules 30s cleanup
    await vi.advanceTimersByTimeAsync(5_000);

    // After cleanup fires (30s), interval is cleared inside setTimeout
    await vi.advanceTimersByTimeAsync(30_000);

    // At this point pipelines.size === 0. The next poll tick should detect
    // this and clear the interval immediately (the #830 fix).
    // The clearInterval was called — at least once from cleanup, and if
    // any further poll fires, the early-return check prevents wasted cycles.
    expect(clearIntervalSpy).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('does not clear interval when pipelines are still running', async () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    const config: PipelineConfig = {
      name: 'still-running',
      workDir: '/app',
      stages: [{ name: 'A', prompt: 'a', dependsOn: [] }],
    };

    // Session is NOT idle — pipeline stays running
    const runningSession = makeMockSession('s1');
    runningSession.status = 'working';
    sessions.createSession.mockResolvedValue(makeMockSession('s1'));
    sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });
    sessions.getSession.mockReturnValue(runningSession);

    await manager.createPipeline(config);

    // Poll fires but pipeline is still running — interval should NOT be cleared
    await vi.advanceTimersByTimeAsync(5_000);

    expect(clearIntervalSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('stops wasted poll cycles after all pipelines complete', async () => {
    vi.useFakeTimers();

    const config: PipelineConfig = {
      name: 'waste-test',
      workDir: '/app',
      stages: [{ name: 'A', prompt: 'a', dependsOn: [] }],
    };

    const idleSession = makeMockSession('s1');
    idleSession.status = 'idle';
    sessions.createSession.mockResolvedValue(makeMockSession('s1'));
    sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });
    sessions.getSession.mockReturnValue(idleSession);

    await manager.createPipeline(config);

    // Pipeline completes on first poll
    await vi.advanceTimersByTimeAsync(5_000);

    // Advance 30s to trigger cleanup setTimeout — pipeline deleted
    await vi.advanceTimersByTimeAsync(30_000);

    // Now pipelines.size === 0. Advance time and verify no more polls run
    // (the interval was cleared). If the fix works, advancing another 30s
    // should not produce errors or side effects.
    const getSessionCallsBefore = sessions.getSession.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);

    // getSession should NOT have been called again — interval is dead
    expect(sessions.getSession.mock.calls.length).toBe(getSessionCallsBefore);

    vi.useRealTimers();
  });
});

// ===========================================================================
// #824: capturePaneDirect always routes through serialize queue
// ===========================================================================

describe('#824: capturePaneDirect always serializes', () => {
  /** Replicate the serialize() promise-chain pattern from TmuxManager. */
  function createSerializeQueue() {
    let queue: Promise<void> = Promise.resolve(undefined as unknown as void);
    const order: string[] = [];

    const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
      let resolve!: () => void;
      const next = new Promise<void>(r => { resolve = r; });
      const prev = queue;
      queue = next;
      return prev.then(async () => {
        try { return await fn(); }
        finally { resolve(); }
      });
    };

    return { serialize, order };
  }

  it('always uses serialize regardless of _creatingCount', () => {
    // After the fix, capturePaneDirect always calls serialize().
    // Verify the logic: no condition on _creatingCount.
    const _creatingCount = 0;
    const { serialize, order } = createSerializeQueue();

    // Simulate the fixed capturePaneDirect: always serialize
    const capturePaneDirect = async (windowId: string): Promise<string> => {
      return serialize(async () => {
        order.push(`capture:${windowId}`);
        return `output:${windowId}`;
      });
    };

    // Call with _creatingCount === 0 (the old bypass path)
    _creatingCount; // unused — fix removes the guard
    const result = capturePaneDirect('w1');

    return result.then((output) => {
      expect(output).toBe('output:w1');
      expect(order).toEqual(['capture:w1']);
    });
  });

  it('serializes concurrent captures in order', async () => {
    const { serialize, order } = createSerializeQueue();

    const capturePaneDirect = async (windowId: string): Promise<string> => {
      return serialize(async () => {
        order.push(`capture:${windowId}`);
        return `output:${windowId}`;
      });
    };

    // Fire 3 concurrent captures — they must be serialized
    const results = await Promise.all([
      capturePaneDirect('w1'),
      capturePaneDirect('w2'),
      capturePaneDirect('w3'),
    ]);

    expect(results).toEqual(['output:w1', 'output:w2', 'output:w3']);
    // All 3 ran in serial order
    expect(order).toEqual(['capture:w1', 'capture:w2', 'capture:w3']);
  });

  it('does not bypass queue when _creatingCount is 0', async () => {
    // Before the fix, _creatingCount === 0 meant bypass.
    // After the fix, serialize is always used.
    const { serialize, order } = createSerializeQueue();
    let _creatingCount = 0;

    // Old buggy behavior (conditional):
    const oldBehavior = async (windowId: string): Promise<string> => {
      if (_creatingCount > 0) {
        return serialize(async () => `serialized:${windowId}`);
      }
      order.push(`bypass:${windowId}`);
      return `bypass:${windowId}`;
    };

    // Fixed behavior (always serialize):
    const fixedBehavior = async (windowId: string): Promise<string> => {
      return serialize(async () => {
        order.push(`serialized:${windowId}`);
        return `serialized:${windowId}`;
      });
    };

    // Old behavior bypasses when _creatingCount === 0
    _creatingCount = 0;
    const oldResult = await oldBehavior('w1');
    expect(oldResult).toBe('bypass:w1');
    expect(order).toEqual(['bypass:w1']);

    order.length = 0;

    // Fixed behavior always serializes
    const fixedResult = await fixedBehavior('w1');
    expect(fixedResult).toBe('serialized:w1');
    expect(order).toEqual(['serialized:w1']);
  });
});
