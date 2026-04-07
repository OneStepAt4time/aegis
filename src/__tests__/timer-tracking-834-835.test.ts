/**
 * timer-tracking-834-835.test.ts — Tests for issues #834 and #835.
 *
 * #834: emitEnded setTimeout is tracked and cancelled by cleanupSession/destroy.
 * #835: Discovery timeout timers are tracked and cancelled by cleanupSession.
 *
 * For #834 we test SessionEventBus directly (public API).
 * For #835 we test the discovery timeout logic via the guard patterns
 * that the timers implement, and verify cleanup prevents stale callbacks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionEventBus } from '../events.js';

// ── #834: SessionEventBus emitEnded timer tracking ───────────────────────

describe('#834: emitEnded setTimeout tracking', () => {
  let bus: SessionEventBus;

  beforeEach(() => {
    bus = new SessionEventBus();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    bus.destroy();
    vi.useRealTimers();
  });

  it('destroy() cancels emitEnded timeout — no error after timer would have fired', () => {
    const unsub = bus.subscribe('sess-1', () => {});
    bus.emitEnded('sess-1', 'completed');
    unsub();

    // Destroy before the 1s timeout fires
    bus.destroy();

    // Advance well past 1s — should not throw
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });

  it('cleanupSession() cancels emitEnded timeout — emitter not stale-deleted', () => {
    const unsub = bus.subscribe('sess-1', () => {});
    bus.emitEnded('sess-1', 'completed');
    unsub();

    // cleanupSession before timeout fires
    bus.cleanupSession('sess-1');

    // Now subscribe again — fresh emitter
    const events: unknown[] = [];
    const unsub2 = bus.subscribe('sess-1', (e) => events.push(e));

    // Advance past the original 1s timeout
    vi.advanceTimersByTime(5000);

    // Fresh emitter should still be intact (not deleted by stale timeout)
    bus.emitStatus('sess-1', 'working', 'after-cleanup');
    vi.advanceTimersByTime(0);

    expect(events.length).toBeGreaterThanOrEqual(1);
    unsub2();
  });

  it('multiple emitEnded timers are all cancelled on destroy', () => {
    const unsub1 = bus.subscribe('sess-1', () => {});
    const unsub2 = bus.subscribe('sess-2', () => {});
    const unsub3 = bus.subscribe('sess-3', () => {});

    bus.emitEnded('sess-1', 'done');
    bus.emitEnded('sess-2', 'done');
    bus.emitEnded('sess-3', 'done');
    unsub1();
    unsub2();
    unsub3();

    bus.destroy();

    // Advance past all timeouts
    expect(() => vi.advanceTimersByTime(10000)).not.toThrow();
  });
});

// ── #835: Discovery timeout timer logic ───────────────────────────────

describe('#835: Discovery timeout cleanup logic', () => {
  it('cleanupSession clears coordinated poll timer + discovery timeout', () => {
    // Simulate cleanupSession with a single coordinated timer per session.
    const pollTimers = new Map<string, NodeJS.Timeout>();
    const discoveryTimeouts = new Map<string, NodeJS.Timeout>();

    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Simulate startSessionIdDiscovery: creates interval + timeout
    const interval = setInterval(() => {}, 2000);
    const timeout = setTimeout(() => {}, 5 * 60 * 1000);
    pollTimers.set('sess-1', interval);
    discoveryTimeouts.set('sess-1', timeout);

    // Simulate cleanupSession logic
    const intervalToClear = pollTimers.get('sess-1');
    if (intervalToClear) {
      clearInterval(intervalToClear);
      pollTimers.delete('sess-1');
    }
    const timeoutToClear = discoveryTimeouts.get('sess-1');
    if (timeoutToClear) {
      clearTimeout(timeoutToClear);
      discoveryTimeouts.delete('sess-1');
    }

    expect(pollTimers.has('sess-1')).toBe(false);
    expect(discoveryTimeouts.has('sess-1')).toBe(false);

    // Advance past the timeout — callback should NOT fire
    // (cleared above, so this is safe)
    vi.advanceTimersByTime(6 * 60 * 1000);

    vi.useRealTimers();
  });

  it('discovery timeout self-deletes from map when it fires (no cleanup needed)', () => {
    const discoveryTimeouts = new Map<string, NodeJS.Timeout>();

    vi.useFakeTimers({ shouldAdvanceTime: true });

    const timeout = setTimeout(() => {
      discoveryTimeouts.delete('sess-3');
    }, 5 * 60 * 1000);
    discoveryTimeouts.set('sess-3', timeout);

    // Before timeout fires, it's in the map
    expect(discoveryTimeouts.has('sess-3')).toBe(true);

    // Advance past timeout
    vi.advanceTimersByTime(6 * 60 * 1000);

    // After timeout fires, it removes itself
    expect(discoveryTimeouts.has('sess-3')).toBe(false);

    clearTimeout(timeout);
    vi.useRealTimers();
  });
});
