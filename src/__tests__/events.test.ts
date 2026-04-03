/**
 * events.test.ts — Comprehensive tests for SessionEventBus (src/events.ts).
 *
 * Covers subscribe/emit lifecycle, ring buffer behavior, getEventsSince replay,
 * emitEnded cleanup timing, subscribeGlobal, emitCreated, event ID incrementing,
 * destroy(), toGlobalEvent mapping, and all helper emit methods.
 *
 * Areas NOT duplicated from sse-events.test.ts are the focus here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionEventBus, type SessionSSEEvent, type GlobalSSEEvent } from '../events.js';

/** Flush all pending setImmediate callbacks. */
function flushAsync(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/** Flush multiple cycles of setImmediate. */
function flushAsyncN(n: number): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < n; i++) {
    p = p.then(() => new Promise<void>(resolve => setImmediate(resolve)));
  }
  return p;
}

describe('SessionEventBus', () => {
  let bus: SessionEventBus;

  beforeEach(() => {
    bus = new SessionEventBus();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    bus.destroy();
    vi.useRealTimers();
  });

  // ── 1. Subscribe/emit lifecycle ──────────────────────────────────────

  describe('subscribe/emit lifecycle', () => {
    it('subscribe returns a function', () => {
      const unsub = bus.subscribe('sess-1', () => {});
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('unsubscribe removes handler — emitter deleted when no listeners remain', () => {
      const unsub = bus.subscribe('sess-1', () => {});
      expect(bus.hasSubscribers('sess-1')).toBe(true);

      unsub();
      expect(bus.hasSubscribers('sess-1')).toBe(false);
      expect(bus.subscriberCount('sess-1')).toBe(0);
    });

    it('emitter not deleted while at least one listener remains', () => {
      const unsub1 = bus.subscribe('sess-1', () => {});
      const unsub2 = bus.subscribe('sess-1', () => {});

      unsub1();
      expect(bus.hasSubscribers('sess-1')).toBe(true);
      expect(bus.subscriberCount('sess-1')).toBe(1);

      unsub2();
      expect(bus.hasSubscribers('sess-1')).toBe(false);
    });

    it('subscribe to non-existent session creates emitter lazily', () => {
      expect(bus.hasSubscribers('never-existed')).toBe(false);
      expect(bus.subscriberCount('never-existed')).toBe(0);

      const unsub = bus.subscribe('never-existed', () => {});
      expect(bus.hasSubscribers('never-existed')).toBe(true);
      unsub();
    });

    it('multiple subscribers on same session all receive events', async () => {
      const collector1: SessionSSEEvent[] = [];
      const collector2: SessionSSEEvent[] = [];
      const collector3: SessionSSEEvent[] = [];

      bus.subscribe('sess-1', e => collector1.push(e));
      bus.subscribe('sess-1', e => collector2.push(e));
      bus.subscribe('sess-1', e => collector3.push(e));

      bus.emitStatus('sess-1', 'working', 'test');
      await flushAsync();

      expect(collector1).toHaveLength(1);
      expect(collector2).toHaveLength(1);
      expect(collector3).toHaveLength(1);
      // All receive the same event object
      expect(collector1[0].id).toBe(collector2[0].id);
      expect(collector2[0].id).toBe(collector3[0].id);
    });

    it('unsubscribe mid-stream stops delivery for that handler only', async () => {
      const events1: SessionSSEEvent[] = [];
      const events2: SessionSSEEvent[] = [];

      const unsub1 = bus.subscribe('sess-1', e => events1.push(e));
      bus.subscribe('sess-1', e => events2.push(e));

      bus.emitStatus('sess-1', 'working', 'first');
      await flushAsync();

      unsub1();

      bus.emitStatus('sess-1', 'idle', 'second');
      await flushAsync();

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(2);
    });

    it('re-subscribing after full unsubscribe works', async () => {
      const events: SessionSSEEvent[] = [];
      const unsub = bus.subscribe('sess-1', e => events.push(e));

      bus.emitStatus('sess-1', 'working', 'before');
      await flushAsync();
      expect(events).toHaveLength(1);

      unsub();

      const unsub2 = bus.subscribe('sess-1', e => events.push(e));

      bus.emitStatus('sess-1', 'idle', 'after');
      await flushAsync();
      expect(events).toHaveLength(2);

      unsub2();
    });
  });

  // ── 2. Buffer behavior (ring buffer) ─────────────────────────────────

  describe('buffer behavior (ring buffer)', () => {
    it('events are buffered up to BUFFER_SIZE (50)', () => {
      for (let i = 0; i < 50; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }

      const buffered = bus.getEventsSince('sess-1', 0);
      expect(buffered).toHaveLength(50);
      expect(buffered[0].id).toBe(1);
      expect(buffered[49].id).toBe(50);
    });

    it('events beyond BUFFER_SIZE are trimmed — oldest removed first', () => {
      for (let i = 0; i < 55; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }

      const buffered = bus.getEventsSince('sess-1', 0);
      expect(buffered).toHaveLength(50);
      // First 5 events (ids 1-5) were trimmed
      expect(buffered[0].id).toBe(6);
      expect(buffered[49].id).toBe(55);
    });

    it('trimming preserves the most recent events', () => {
      for (let i = 0; i < 100; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }

      const buffered = bus.getEventsSince('sess-1', 0);
      expect(buffered).toHaveLength(50);
      expect(buffered[0].id).toBe(51);
      expect(buffered[49].id).toBe(100);
    });

    it('buffer is per-session — events from one session do not affect another', () => {
      for (let i = 0; i < 55; i++) {
        bus.emitStatus('sess-1', 'working', `s1 ${i}`);
      }
      for (let i = 0; i < 3; i++) {
        bus.emitStatus('sess-2', 'working', `s2 ${i}`);
      }

      const s1 = bus.getEventsSince('sess-1', 0);
      const s2 = bus.getEventsSince('sess-2', 0);

      // sess-1 was trimmed to 50
      expect(s1).toHaveLength(50);
      // sess-2 was not trimmed
      expect(s2).toHaveLength(3);
    });

    it('global event buffer is also trimmed at 50', () => {
      bus.subscribeGlobal(() => {});

      for (let i = 0; i < 60; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }

      const globalBuffered = bus.getGlobalEventsSince(0);
      expect(globalBuffered).toHaveLength(50);
      expect(globalBuffered[0].id).toBe(11);
      expect(globalBuffered[49].id).toBe(60);
    });

    it('global buffer trims after 100+ events', () => {
      bus.subscribeGlobal(() => {});

      for (let i = 0; i < 120; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }

      const globalBuffered = bus.getGlobalEventsSince(0);
      expect(globalBuffered).toHaveLength(50);
      expect(globalBuffered[0].id).toBe(71);
      expect(globalBuffered[49].id).toBe(120);
    });
  });

  // ── 3. getEventsSince replay ──────────────────────────────────────────

  describe('getEventsSince replay', () => {
    it('returns events with id strictly greater than lastEventId', () => {
      for (let i = 0; i < 5; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }

      const since3 = bus.getEventsSince('sess-1', 3);
      expect(since3).toHaveLength(2);
      expect(since3[0].id).toBe(4);
      expect(since3[1].id).toBe(5);
    });

    it('returns empty array for unknown session', () => {
      bus.emitStatus('sess-1', 'working', 'exists');
      expect(bus.getEventsSince('nonexistent', 0)).toEqual([]);
    });

    it('returns empty array when no new events after lastEventId', () => {
      for (let i = 0; i < 3; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }

      // lastEventId equals the latest event id
      const result = bus.getEventsSince('sess-1', 3);
      expect(result).toEqual([]);
    });

    it('returns empty array when lastEventId exceeds all buffered ids', () => {
      for (let i = 0; i < 3; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }

      const result = bus.getEventsSince('sess-1', 999);
      expect(result).toEqual([]);
    });

    it('works after buffer trimming — only recent events available', () => {
      for (let i = 0; i < 60; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }

      // Request events since id 5 — but ids 1-10 were trimmed
      const result = bus.getEventsSince('sess-1', 5);
      // Buffer starts at id 11, so all 50 events have id > 5
      expect(result).toHaveLength(50);

      // Request events since id 55 — only ids 56-60 are available
      const recent = bus.getEventsSince('sess-1', 55);
      expect(recent).toHaveLength(5);
      expect(recent[0].id).toBe(56);
      expect(recent[4].id).toBe(60);
    });

    it('replayed events are the same objects that were emitted', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitStatus('sess-1', 'working', 'test');
      await flushAsync();

      const replayed = bus.getEventsSince('sess-1', 0);
      expect(replayed).toHaveLength(1);
      expect(replayed[0].event).toBe('status');
      expect(replayed[0].data.status).toBe('working');
      expect(replayed[0].data.detail).toBe('test');
      expect(replayed[0].id).toBe(events[0].id);
    });
  });

  // ── 4. getEventsBefore cursor replay ─────────────────────────────────

  describe('getEventsBefore cursor replay', () => {
    it('returns newest window when before_id is omitted', () => {
      for (let i = 0; i < 8; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }

      const result = bus.getEventsBefore('sess-1', undefined, 3);
      expect(result.events).toHaveLength(3);
      expect(result.events[0].id).toBe(6);
      expect(result.events[2].id).toBe(8);
      expect(result.before_id).toBe(6);
      expect(result.oldest_id).toBe(6);
      expect(result.newest_id).toBe(8);
      expect(result.has_more).toBe(true);
    });

    it('uses before_id as an exclusive upper bound with no overlap', () => {
      for (let i = 0; i < 10; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }

      const newest = bus.getEventsBefore('sess-1', undefined, 4);
      const older = bus.getEventsBefore('sess-1', newest.before_id ?? undefined, 4);

      expect(newest.events.map(e => e.id)).toEqual([7, 8, 9, 10]);
      expect(older.events.map(e => e.id)).toEqual([3, 4, 5, 6]);
      expect(older.has_more).toBe(true);
    });

    it('returns has_more=false when there are no earlier events', () => {
      for (let i = 0; i < 5; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }

      const result = bus.getEventsBefore('sess-1', 3, 10);
      expect(result.events.map(e => e.id)).toEqual([1, 2]);
      expect(result.before_id).toBe(1);
      expect(result.has_more).toBe(false);
    });

    it('returns empty window metadata for unknown session', () => {
      const result = bus.getEventsBefore('missing', undefined, 10);
      expect(result.events).toEqual([]);
      expect(result.before_id).toBeNull();
      expect(result.oldest_id).toBeNull();
      expect(result.newest_id).toBeNull();
      expect(result.has_more).toBe(false);
    });
  });

  // ── 5. Cleanup timing (emitEnded) ────────────────────────────────────

  describe('cleanup timing (emitEnded)', () => {
    it('emitEnded marks emitter as ending', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitEnded('sess-1', 'completed');
      await flushAsync();

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('ended');
      expect(events[0].data.reason).toBe('completed');
    });

    it('emitter is cleaned up after 1 second', () => {
      const unsub = bus.subscribe('sess-1', () => {});
      expect(bus.hasSubscribers('sess-1')).toBe(true);

      bus.emitEnded('sess-1', 'completed');
      unsub();

      // Before 1s, emitter may still exist (marked as ending)
      vi.advanceTimersByTime(500);

      // After 1s, cleanup fires
      vi.advanceTimersByTime(600);
      expect(bus.hasSubscribers('sess-1')).toBe(false);
    });

    it('event buffer is deleted after cleanup timeout fires', () => {
      bus.emitStatus('sess-1', 'working', 'test');
      expect(bus.getEventsSince('sess-1', 0)).toHaveLength(1);

      bus.emitEnded('sess-1', 'done');

      // Before timeout
      vi.advanceTimersByTime(500);
      expect(bus.getEventsSince('sess-1', 0)).toHaveLength(2);

      // After timeout — buffer is deleted regardless
      vi.advanceTimersByTime(600);
      expect(bus.getEventsSince('sess-1', 0)).toEqual([]);
    });

    it('re-subscribing within 1s window creates fresh emitter', async () => {
      const unsub1 = bus.subscribe('sess-1', () => {});
      bus.emitEnded('sess-1', 'completed');
      unsub1();

      // Re-subscribe before the 1s cleanup
      const events2: SessionSSEEvent[] = [];
      const unsub2 = bus.subscribe('sess-1', e => events2.push(e));

      bus.emitStatus('sess-1', 'working', 'fresh');
      await flushAsync();

      expect(events2).toHaveLength(1);
      expect(events2[0].data.status).toBe('working');
      unsub2();
    });

    it('old emitter setTimeout does NOT delete fresh emitter', async () => {
      const unsub1 = bus.subscribe('sess-1', () => {});
      bus.emitEnded('sess-1', 'completed');
      unsub1();

      // Re-subscribe immediately — creates fresh emitter
      const events2: SessionSSEEvent[] = [];
      const unsub2 = bus.subscribe('sess-1', e => events2.push(e));

      // Advance past the cleanup timeout for the old emitter
      vi.advanceTimersByTime(1200);
      await flushAsync();

      // Fresh emitter should still work
      bus.emitStatus('sess-1', 'idle', 'after-timeout');
      await flushAsync();

      expect(events2).toHaveLength(1);
      expect(events2[0].data.status).toBe('idle');

      unsub2();
    });

    it('emitEnded with remaining subscribers does not delete emitter immediately', async () => {
      const events1: SessionSSEEvent[] = [];
      const events2: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events1.push(e));
      bus.subscribe('sess-1', e => events2.push(e));

      bus.emitEnded('sess-1', 'completed');
      await flushAsync();

      // Both should have received the ended event
      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
    });

    // #834: cleanupSession cancels pending emitEnded timeout
    it('cleanupSession cancels pending emitEnded timeout — no stale deletion', () => {
      const unsub = bus.subscribe('sess-1', () => {});
      bus.emitEnded('sess-1', 'completed');
      unsub();

      // cleanupSession before the 1s timeout fires
      bus.cleanupSession('sess-1');

      // Advance well past the timeout — nothing should throw
      vi.advanceTimersByTime(5000);
      expect(bus.hasSubscribers('sess-1')).toBe(false);
    });
  });

  // ── 5. subscribeGlobal ───────────────────────────────────────────────

  describe('subscribeGlobal', () => {
    it('lazily creates global emitter on first subscribe', () => {
      // Before any subscribeGlobal, emitting should not throw
      bus.emitStatus('sess-1', 'working', 'no-crash');

      const events: GlobalSSEEvent[] = [];
      const unsub = bus.subscribeGlobal(e => events.push(e));

      bus.emitStatus('sess-1', 'working', 'after-subscribe');
      // emitCreated is synchronous for global emitter
      // but per-session emit() uses setImmediate for global forwarding
      // We need to flush setImmediate
      vi.advanceTimersByTime(0);

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('session_status_change');
      unsub();
    });

    it('returns unsubscribe function that works', async () => {
      const events: GlobalSSEEvent[] = [];
      const unsub = bus.subscribeGlobal(e => events.push(e));

      bus.emitStatus('sess-1', 'working', 'before');
      vi.advanceTimersByTime(0);

      expect(events).toHaveLength(1);

      unsub();

      bus.emitStatus('sess-1', 'idle', 'after');
      vi.advanceTimersByTime(0);

      expect(events).toHaveLength(1);
    });

    it('receives GlobalSSEEvent versions of per-session events', async () => {
      const events: GlobalSSEEvent[] = [];
      bus.subscribeGlobal(e => events.push(e));

      bus.emitStatus('sess-1', 'working', 'status');
      bus.emitMessage('sess-1', 'assistant', 'hello', 'text');
      bus.emitApproval('sess-1', 'Allow?');
      bus.emitStall('sess-1', 'jsonl', 'stalled');
      bus.emitDead('sess-1', 'died');
      vi.advanceTimersByTime(0);

      expect(events).toHaveLength(5);
      expect(events[0].event).toBe('session_status_change');
      expect(events[1].event).toBe('session_message');
      expect(events[2].event).toBe('session_approval');
      expect(events[3].event).toBe('session_stall');
      expect(events[4].event).toBe('session_dead');
    });

    it('multiple global subscribers all receive events', async () => {
      const collector1: GlobalSSEEvent[] = [];
      const collector2: GlobalSSEEvent[] = [];

      bus.subscribeGlobal(e => collector1.push(e));
      bus.subscribeGlobal(e => collector2.push(e));

      bus.emitStatus('sess-1', 'working', 'test');
      vi.advanceTimersByTime(0);

      expect(collector1).toHaveLength(1);
      expect(collector2).toHaveLength(1);
    });

    it('global subscriber receives events from multiple sessions', async () => {
      const events: GlobalSSEEvent[] = [];
      bus.subscribeGlobal(e => events.push(e));

      bus.emitStatus('sess-a', 'working', 'a');
      bus.emitStatus('sess-b', 'idle', 'b');
      bus.emitStatus('sess-c', 'working', 'c');
      vi.advanceTimersByTime(0);

      expect(events).toHaveLength(3);
      expect(events[0].sessionId).toBe('sess-a');
      expect(events[1].sessionId).toBe('sess-b');
      expect(events[2].sessionId).toBe('sess-c');
    });

    it('global subscriber can unsubscribe independently', async () => {
      const collector1: GlobalSSEEvent[] = [];
      const collector2: GlobalSSEEvent[] = [];

      const unsub1 = bus.subscribeGlobal(e => collector1.push(e));
      bus.subscribeGlobal(e => collector2.push(e));

      bus.emitStatus('sess-1', 'working', 'first');
      vi.advanceTimersByTime(0);
      expect(collector1).toHaveLength(1);
      expect(collector2).toHaveLength(1);

      unsub1();

      bus.emitStatus('sess-1', 'idle', 'second');
      vi.advanceTimersByTime(0);
      expect(collector1).toHaveLength(1);
      expect(collector2).toHaveLength(2);
    });
  });

  // ── 6. emitCreated ───────────────────────────────────────────────────

  describe('emitCreated', () => {
    it('emits only to global subscribers — not per-session', async () => {
      const sessionEvents: SessionSSEEvent[] = [];
      const globalEvents: GlobalSSEEvent[] = [];

      bus.subscribe('sess-new', e => sessionEvents.push(e));
      bus.subscribeGlobal(e => globalEvents.push(e));

      bus.emitCreated('sess-new', 'my session', '/tmp/work');

      expect(sessionEvents).toHaveLength(0);
      // emitCreated emits synchronously (no setImmediate)
      expect(globalEvents).toHaveLength(1);
    });

    it('has correct event type session_created', () => {
      const events: GlobalSSEEvent[] = [];
      bus.subscribeGlobal(e => events.push(e));

      bus.emitCreated('sess-new', 'my session', '/tmp/work');

      expect(events[0].event).toBe('session_created');
      expect(events[0].sessionId).toBe('sess-new');
      expect(events[0].data.name).toBe('my session');
      expect(events[0].data.workDir).toBe('/tmp/work');
    });

    it('does nothing when no global emitter exists', () => {
      // No subscribeGlobal called — should not throw
      expect(() => bus.emitCreated('sess-x', 'name', '/dir')).not.toThrow();
    });

    it('is buffered in global event buffer for replay', () => {
      bus.subscribeGlobal(() => {});

      bus.emitCreated('sess-new', 'my session', '/tmp');

      const buffered = bus.getGlobalEventsSince(0);
      expect(buffered).toHaveLength(1);
      expect(buffered[0].event.event).toBe('session_created');
    });

    it('emitCreated event gets a unique incrementing id', () => {
      bus.subscribeGlobal(() => {});

      bus.emitStatus('sess-1', 'working', 'before');
      bus.emitCreated('sess-new', 'new', '/tmp');
      bus.emitStatus('sess-1', 'idle', 'after');

      // emitStatus uses setImmediate for global, but emitCreated is sync
      // The IDs should still be incrementing
      const buffered = bus.getGlobalEventsSince(0);
      // emitStatus events are buffered synchronously in emit(), emitCreated also increments
      // IDs are: 1 (status), 2 (created), 3 (status)
      expect(buffered.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < buffered.length; i++) {
        expect(buffered[i].id!).toBeGreaterThan(buffered[i - 1].id!);
      }
    });
  });

  // ── 7. Event ID incrementing ─────────────────────────────────────────

  describe('event ID incrementing', () => {
    it('IDs are globally incrementing across all sessions', () => {
      bus.emitStatus('sess-a', 'working', 'a1');
      bus.emitStatus('sess-b', 'working', 'b1');
      bus.emitStatus('sess-a', 'idle', 'a2');
      bus.emitStatus('sess-b', 'idle', 'b2');

      const a = bus.getEventsSince('sess-a', 0);
      const b = bus.getEventsSince('sess-b', 0);

      expect(a[0].id).toBe(1);
      expect(b[0].id).toBe(2);
      expect(a[1].id).toBe(3);
      expect(b[1].id).toBe(4);
    });

    it('each event gets a unique id — no collisions across sessions', () => {
      const allIds: number[] = [];

      for (let s = 0; s < 5; s++) {
        for (let i = 0; i < 10; i++) {
          bus.emitStatus(`sess-${s}`, 'working', `event ${i}`);
        }
      }

      for (let s = 0; s < 5; s++) {
        const events = bus.getEventsSince(`sess-${s}`, 0);
        for (const e of events) {
          allIds.push(e.id!);
        }
      }

      expect(allIds).toHaveLength(50);
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(50);
    });

    it('IDs assigned by helper methods follow the same sequence', () => {
      bus.emitStatus('sess-1', 'working', 'status');
      bus.emitMessage('sess-1', 'assistant', 'msg', 'text');
      bus.emitSystem('sess-1', 'sys msg');
      bus.emitApproval('sess-1', 'prompt');
      bus.emitStall('sess-1', 'jsonl', 'stalled');
      bus.emitDead('sess-1', 'dead');
      bus.emitHook('sess-1', 'Stop', {});

      const events = bus.getEventsSince('sess-1', 0);
      expect(events).toHaveLength(7);
      for (let i = 0; i < 7; i++) {
        expect(events[i].id).toBe(i + 1);
      }
    });

    it('emitCreated IDs participate in the global sequence', () => {
      bus.subscribeGlobal(() => {});

      bus.emitStatus('sess-1', 'working', 'before'); // id 1
      bus.emitCreated('sess-new', 'new', '/tmp');     // id 2
      bus.emitStatus('sess-1', 'idle', 'after');      // id 3

      const globalEvents = bus.getGlobalEventsSince(0);
      expect(globalEvents).toHaveLength(3);
      expect(globalEvents[0].id).toBe(1);
      expect(globalEvents[1].id).toBe(2);
      expect(globalEvents[2].id).toBe(3);
    });
  });

  // ── 8. destroy() ─────────────────────────────────────────────────────

  describe('destroy()', () => {
    it('removes all listeners from all emitters', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      bus.subscribe('sess-1', handler1);
      bus.subscribe('sess-2', handler2);

      bus.destroy();

      expect(bus.hasSubscribers('sess-1')).toBe(false);
      expect(bus.hasSubscribers('sess-2')).toBe(false);
    });

    it('clears all per-session event buffers', () => {
      bus.emitStatus('sess-1', 'working', 'a');
      bus.emitStatus('sess-2', 'working', 'b');
      expect(bus.getEventsSince('sess-1', 0)).toHaveLength(1);
      expect(bus.getEventsSince('sess-2', 0)).toHaveLength(1);

      bus.destroy();

      expect(bus.getEventsSince('sess-1', 0)).toEqual([]);
      expect(bus.getEventsSince('sess-2', 0)).toEqual([]);
    });

    it('nulls globalEmitter — no events delivered after destroy', async () => {
      const globalHandler = vi.fn();
      bus.subscribeGlobal(globalHandler);

      bus.destroy();

      bus.emitStatus('sess-1', 'working', 'post-destroy');
      vi.advanceTimersByTime(0);

      expect(globalHandler).not.toHaveBeenCalled();
    });

    it('clears global event buffer', async () => {
      bus.subscribeGlobal(() => {});
      bus.emitStatus('sess-1', 'working', 'a');
      expect(bus.getGlobalEventsSince(0)).toHaveLength(1);

      bus.destroy();

      expect(bus.getGlobalEventsSince(0)).toEqual([]);
    });

    it('destroy is idempotent — calling twice does not throw', () => {
      bus.subscribe('sess-1', () => {});
      bus.subscribeGlobal(() => {});
      bus.emitStatus('sess-1', 'working', 'test');

      expect(() => {
        bus.destroy();
        bus.destroy();
      }).not.toThrow();
    });

    // #834: destroy() cancels pending emitEnded setTimeout
    it('destroy cancels pending emitEnded timeout — callback does not fire', () => {
      const unsub = bus.subscribe('sess-1', () => {});
      bus.emitEnded('sess-1', 'completed');
      unsub();

      // Destroy before the 1s timeout fires
      bus.destroy();

      // Advance well past the timeout — nothing should throw or error
      vi.advanceTimersByTime(5000);
      expect(bus.hasSubscribers('sess-1')).toBe(false);
    });
  });

  describe('bounded session replay buffer map', () => {
    it('evicts the least recently touched inactive session when cap is exceeded', () => {
      const cappedBus = new SessionEventBus({ maxSessionBuffers: 3 });

      cappedBus.emitStatus('sess-1', 'working', 'a');
      cappedBus.emitStatus('sess-2', 'working', 'b');
      cappedBus.emitStatus('sess-3', 'working', 'c');
      cappedBus.emitStatus('sess-4', 'working', 'd');

      expect(cappedBus.getEventsSince('sess-1', 0)).toEqual([]);
      expect(cappedBus.getEventsSince('sess-2', 0)).toHaveLength(1);
      expect(cappedBus.getEventsSince('sess-3', 0)).toHaveLength(1);
      expect(cappedBus.getEventsSince('sess-4', 0)).toHaveLength(1);

      cappedBus.destroy();
    });

    it('does not evict sessions with active subscribers when pruning', () => {
      const cappedBus = new SessionEventBus({ maxSessionBuffers: 2 });
      const unsub = cappedBus.subscribe('sess-1', () => {});

      cappedBus.emitStatus('sess-1', 'working', 'a');
      cappedBus.emitStatus('sess-2', 'working', 'b');
      cappedBus.emitStatus('sess-3', 'working', 'c');

      expect(cappedBus.getEventsSince('sess-1', 0)).toHaveLength(1);
      expect(cappedBus.getEventsSince('sess-2', 0)).toEqual([]);
      expect(cappedBus.getEventsSince('sess-3', 0)).toHaveLength(1);

      unsub();
      cappedBus.destroy();
    });

    it('keeps replay buffers bounded under high unique-session churn', () => {
      const maxBuffers = 5;
      const cappedBus = new SessionEventBus({ maxSessionBuffers: maxBuffers });

      for (let i = 0; i < 50; i++) {
        cappedBus.emitStatus(`sess-${i}`, 'working', `evt-${i}`);
      }

      let retained = 0;
      for (let i = 0; i < 50; i++) {
        if (cappedBus.getEventsSince(`sess-${i}`, 0).length > 0) {
          retained++;
        }
      }

      expect(retained).toBeLessThanOrEqual(maxBuffers);

      cappedBus.destroy();
    });
  });

  // ── 9. toGlobalEvent mapping ─────────────────────────────────────────

  describe('toGlobalEvent mapping', () => {
    it('maps status -> session_status_change', async () => {
      const events: GlobalSSEEvent[] = [];
      bus.subscribeGlobal(e => events.push(e));
      bus.emitStatus('sess-1', 'idle', 'done');
      vi.advanceTimersByTime(0);
      expect(events[0].event).toBe('session_status_change');
    });

    it('maps message -> session_message', async () => {
      const events: GlobalSSEEvent[] = [];
      bus.subscribeGlobal(e => events.push(e));
      bus.emitMessage('sess-1', 'assistant', 'text', 'text');
      vi.advanceTimersByTime(0);
      expect(events[0].event).toBe('session_message');
    });

    it('maps system -> session_message', async () => {
      const events: GlobalSSEEvent[] = [];
      bus.subscribeGlobal(e => events.push(e));
      bus.emitSystem('sess-1', 'system note');
      vi.advanceTimersByTime(0);
      expect(events[0].event).toBe('session_message');
    });

    it('maps approval -> session_approval', async () => {
      const events: GlobalSSEEvent[] = [];
      bus.subscribeGlobal(e => events.push(e));
      bus.emitApproval('sess-1', 'Allow file write?');
      vi.advanceTimersByTime(0);
      expect(events[0].event).toBe('session_approval');
    });

    it('maps ended -> session_ended', async () => {
      const events: GlobalSSEEvent[] = [];
      bus.subscribeGlobal(e => events.push(e));
      bus.emitEnded('sess-1', 'timeout');
      vi.advanceTimersByTime(0);
      expect(events[0].event).toBe('session_ended');
    });

    it('maps stall -> session_stall', async () => {
      const events: GlobalSSEEvent[] = [];
      bus.subscribeGlobal(e => events.push(e));
      bus.emitStall('sess-1', 'permission', 'stalled');
      vi.advanceTimersByTime(0);
      expect(events[0].event).toBe('session_stall');
    });

    it('maps dead -> session_dead', async () => {
      const events: GlobalSSEEvent[] = [];
      bus.subscribeGlobal(e => events.push(e));
      bus.emitDead('sess-1', 'process died');
      vi.advanceTimersByTime(0);
      expect(events[0].event).toBe('session_dead');
    });

    it('maps hook -> session_message', async () => {
      const events: GlobalSSEEvent[] = [];
      bus.subscribeGlobal(e => events.push(e));
      bus.emitHook('sess-1', 'Stop', { reason: 'user' });
      vi.advanceTimersByTime(0);
      expect(events[0].event).toBe('session_message');
    });

    it('global event preserves session data from original event', async () => {
      const events: GlobalSSEEvent[] = [];
      bus.subscribeGlobal(e => events.push(e));
      bus.emitMessage('sess-1', 'assistant', 'hello world', 'text');
      vi.advanceTimersByTime(0);

      const global = events[0];
      expect(global.sessionId).toBe('sess-1');
      expect(global.data.role).toBe('assistant');
      expect(global.data.text).toBe('hello world');
      expect(global.id).toBeDefined();
      expect(global.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ── 10. Helper emit methods ──────────────────────────────────────────

  describe('emitStatus', () => {
    it('delegates to emit with correct data structure', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitStatus('sess-1', 'idle', 'Session is idle');
      await flushAsync();

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('status');
      expect(events[0].sessionId).toBe('sess-1');
      expect(events[0].data.status).toBe('idle');
      expect(events[0].data.detail).toBe('Session is idle');
      expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(events[0].emittedAt).toBeDefined();
      expect(events[0].id).toBe(1);
    });

    it('emits working status correctly', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitStatus('sess-1', 'working', 'Processing');
      await flushAsync();

      expect(events[0].data.status).toBe('working');
    });
  });

  describe('emitMessage', () => {
    it('delegates with role, text, contentType', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitMessage('sess-1', 'user', 'Do something', 'text');
      await flushAsync();

      expect(events[0].event).toBe('message');
      expect(events[0].data.role).toBe('user');
      expect(events[0].data.text).toBe('Do something');
      expect(events[0].data.contentType).toBe('text');
    });

    it('passes tool metadata when provided', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitMessage('sess-1', 'assistant', 'Reading...', 'tool_use', {
        tool_name: 'Read',
        tool_id: 'toolu_xyz789',
      });
      await flushAsync();

      expect(events[0].data.tool_name).toBe('Read');
      expect(events[0].data.tool_id).toBe('toolu_xyz789');
    });

    it('works without contentType', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitMessage('sess-1', 'assistant', 'plain text');
      await flushAsync();

      expect(events[0].event).toBe('message');
      expect(events[0].data.text).toBe('plain text');
      expect(events[0].data.contentType).toBeUndefined();
    });
  });

  describe('emitSystem', () => {
    it('delegates with role=system and isSystem=true', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitSystem('sess-1', 'System initialized', 'info');
      await flushAsync();

      expect(events[0].event).toBe('system');
      expect(events[0].data.role).toBe('system');
      expect(events[0].data.text).toBe('System initialized');
      expect(events[0].data.contentType).toBe('info');
      expect(events[0].data.isSystem).toBe(true);
    });

    it('works without contentType', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitSystem('sess-1', 'No content type');
      await flushAsync();

      expect(events[0].data.contentType).toBeUndefined();
    });
  });

  describe('emitApproval', () => {
    it('delegates with correct data structure', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitApproval('sess-1', 'Allow bash execution?');
      await flushAsync();

      expect(events[0].event).toBe('approval');
      expect(events[0].data.prompt).toBe('Allow bash execution?');
    });
  });

  describe('emitStall', () => {
    it('delegates with stallType and detail', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitStall('sess-1', 'jsonl', 'No transcript activity for 5 minutes');
      await flushAsync();

      expect(events[0].event).toBe('stall');
      expect(events[0].data.stallType).toBe('jsonl');
      expect(events[0].data.detail).toBe('No transcript activity for 5 minutes');
    });

    it('supports various stall types', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitStall('sess-1', 'permission', 'Permission prompt unattended');
      bus.emitStall('sess-1', 'unknown', 'Unknown state for 3 minutes');
      bus.emitStall('sess-1', 'extended', 'Extended stall detected');
      await flushAsync();

      expect(events).toHaveLength(3);
      expect(events[0].data.stallType).toBe('permission');
      expect(events[1].data.stallType).toBe('unknown');
      expect(events[2].data.stallType).toBe('extended');
    });
  });

  describe('emitDead', () => {
    it('delegates with reason in data', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitDead('sess-1', 'tmux pane destroyed');
      await flushAsync();

      expect(events[0].event).toBe('dead');
      expect(events[0].data.reason).toBe('tmux pane destroyed');
    });
  });

  describe('emitHook', () => {
    it('delegates with hookEvent and merged data', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitHook('sess-1', 'Stop', { exitCode: 0, duration: 120 });
      await flushAsync();

      expect(events[0].event).toBe('hook');
      expect(events[0].data.hookEvent).toBe('Stop');
      expect(events[0].data.exitCode).toBe(0);
      expect(events[0].data.duration).toBe(120);
    });

    it('works with empty hookData', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitHook('sess-1', 'SessionStart', {});
      await flushAsync();

      expect(events[0].event).toBe('hook');
      expect(events[0].data.hookEvent).toBe('SessionStart');
    });
  });

  // ── Cross-cutting: emittedAt timestamp ───────────────────────────────

  describe('emittedAt timestamp (Issue #87)', () => {
    it('every emitted event has emittedAt set', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      bus.emitStatus('sess-1', 'working', 'a');
      bus.emitMessage('sess-1', 'assistant', 'b', 'text');
      bus.emitSystem('sess-1', 'c');
      bus.emitApproval('sess-1', 'd');
      bus.emitStall('sess-1', 'jsonl', 'e');
      bus.emitDead('sess-1', 'f');
      bus.emitHook('sess-1', 'Stop', {});
      await flushAsync();

      for (const event of events) {
        expect(event.emittedAt).toBeDefined();
        expect(typeof event.emittedAt).toBe('number');
        expect(event.emittedAt!).toBeGreaterThan(0);
      }
    });

    it('emittedAt values are non-decreasing', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', e => events.push(e));

      for (let i = 0; i < 5; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }
      await flushAsync();

      for (let i = 1; i < events.length; i++) {
        expect(events[i].emittedAt!).toBeGreaterThanOrEqual(events[i - 1].emittedAt!);
      }
    });
  });

  // ── Cross-cutting: emit() with no emitter ────────────────────────────

  describe('emit() without subscribers', () => {
    it('emit does not throw when no per-session emitter exists', () => {
      expect(() => {
        bus.emitStatus('no-sess', 'working', 'test');
      }).not.toThrow();
    });

    it('events are still buffered even with no subscribers', () => {
      bus.emitStatus('no-sess', 'working', 'buffered');

      const buffered = bus.getEventsSince('no-sess', 0);
      expect(buffered).toHaveLength(1);
      expect(buffered[0].data.status).toBe('working');
    });
  });

  // ── Issue #589: Event ID overflow guard ──────────────────────────────

  describe('event ID overflow guard (#589)', () => {
    it('resets counter to 1 when approaching MAX_SAFE_INTEGER', async () => {
      // Force the counter to the edge
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bus as any).nextEventId = Number.MAX_SAFE_INTEGER - 1;

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const collected: number[] = [];
      bus.subscribe('sess-1', e => collected.push(e.id!));

      // First allocation: MAX_SAFE_INTEGER - 1 → no reset yet
      bus.emitStatus('sess-1', 'working', 'edge');

      // Second allocation: counter is now MAX_SAFE_INTEGER → triggers reset, returns 1
      bus.emitStatus('sess-1', 'idle', 'reset');

      // Third allocation continues from 2
      bus.emitStatus('sess-1', 'working', 'after-reset');

      await flushAsync();

      expect(collected).toEqual([
        Number.MAX_SAFE_INTEGER - 1,
        1,
        2,
      ]);

      expect(warnSpy).toHaveBeenCalledWith(
        '[SessionEventBus] Event ID counter approaching MAX_SAFE_INTEGER, resetting to 1',
      );

      warnSpy.mockRestore();
    });

    it('emitCreated also triggers overflow reset', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bus as any).nextEventId = Number.MAX_SAFE_INTEGER;

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      bus.subscribeGlobal(() => {});

      bus.emitCreated('sess-new', 'test', '/tmp');

      expect(warnSpy).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((bus as any).nextEventId).toBe(2);

      warnSpy.mockRestore();
    });
  });
});
