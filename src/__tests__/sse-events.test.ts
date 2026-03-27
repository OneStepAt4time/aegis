/**
 * sse-events.test.ts — Tests for Issue #32: SSE event stream.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionEventBus, type SessionSSEEvent, type GlobalSSEEvent } from '../events.js';

/** Flush all pending setImmediate callbacks. */
function flushAsync(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('SSE Event System (Issue #32)', () => {
  let bus: SessionEventBus;

  beforeEach(() => {
    bus = new SessionEventBus();
  });

  describe('SessionEventBus', () => {
    it('should subscribe and receive events', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitStatus('sess-1', 'working', 'Claude is working');
      await flushAsync();

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('status');
      expect(events[0].sessionId).toBe('sess-1');
      expect(events[0].data.status).toBe('working');
    });

    it('should not receive events from other sessions', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitStatus('sess-2', 'working', 'Claude is working');
      await flushAsync();

      expect(events).toHaveLength(0);
    });

    it('should support multiple subscribers', async () => {
      const events1: SessionSSEEvent[] = [];
      const events2: SessionSSEEvent[] = [];

      bus.subscribe('sess-1', (e) => events1.push(e));
      bus.subscribe('sess-1', (e) => events2.push(e));

      bus.emitStatus('sess-1', 'idle', 'done');
      await flushAsync();

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
    });

    it('should unsubscribe correctly', async () => {
      const events: SessionSSEEvent[] = [];
      const unsub = bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitStatus('sess-1', 'working', 'working');
      await flushAsync();
      expect(events).toHaveLength(1);

      unsub();

      bus.emitStatus('sess-1', 'idle', 'idle');
      await flushAsync();
      expect(events).toHaveLength(1); // No new events after unsub
    });

    it('should emit message events with role and text', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitMessage('sess-1', 'assistant', 'Hello world', 'text');
      await flushAsync();

      expect(events[0].event).toBe('message');
      expect(events[0].data.role).toBe('assistant');
      expect(events[0].data.text).toBe('Hello world');
      expect(events[0].data.contentType).toBe('text');
    });

    it('L11: should include tool metadata in message events', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitMessage('sess-1', 'assistant', 'Reading file...', 'tool_use', { tool_name: 'Read', tool_id: 'toolu_abc123' });
      await flushAsync();

      expect(events[0].event).toBe('message');
      expect(events[0].data.role).toBe('assistant');
      expect(events[0].data.contentType).toBe('tool_use');
      expect(events[0].data.tool_name).toBe('Read');
      expect(events[0].data.tool_id).toBe('toolu_abc123');
    });

    it('L11: omits tool metadata when not provided', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitMessage('sess-1', 'assistant', 'Hello', 'text');
      await flushAsync();

      expect(events[0].data.tool_name).toBeUndefined();
      expect(events[0].data.tool_id).toBeUndefined();
    });

    it('should emit approval events', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitApproval('sess-1', 'Allow write to foo.ts?');
      await flushAsync();

      expect(events[0].event).toBe('approval');
      expect(events[0].data.prompt).toBe('Allow write to foo.ts?');
    });

    it('should emit ended events', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitEnded('sess-1', 'completed');
      await flushAsync();

      expect(events[0].event).toBe('ended');
      expect(events[0].data.reason).toBe('completed');
    });

    it('should emit events asynchronously via setImmediate', () => {
      return new Promise<void>((done) => {
        const events: SessionSSEEvent[] = [];
        bus.subscribe('sess-1', (e) => events.push(e));

        bus.emitStatus('sess-1', 'working', 'test');

        // Events should NOT be delivered synchronously
        expect(events).toHaveLength(0);

        // But should be delivered after setImmediate
        setImmediate(() => {
          expect(events).toHaveLength(1);
          expect(events[0].data.status).toBe('working');
          done();
        });
      });
    });

    it('should report subscriber count correctly', () => {
      expect(bus.subscriberCount('sess-1')).toBe(0);
      expect(bus.hasSubscribers('sess-1')).toBe(false);

      const unsub = bus.subscribe('sess-1', () => {});
      expect(bus.subscriberCount('sess-1')).toBe(1);
      expect(bus.hasSubscribers('sess-1')).toBe(true);

      unsub();
      expect(bus.subscriberCount('sess-1')).toBe(0);
      expect(bus.hasSubscribers('sess-1')).toBe(false);
    });

    it('should not delete a fresh emitter created during cleanup window', async () => {
      const events1: SessionSSEEvent[] = [];
      const unsub1 = bus.subscribe('sess-1', (e) => events1.push(e));

      // Emit ended — marks emitter as ending, schedules delete in 1s
      bus.emitEnded('sess-1', 'completed');
      unsub1();

      // During the 1s window, a new subscriber should get a fresh emitter
      const events2: SessionSSEEvent[] = [];
      const unsub2 = bus.subscribe('sess-1', (e) => events2.push(e));

      bus.emitStatus('sess-1', 'working', 'new work');
      await flushAsync();

      expect(events2).toHaveLength(1);
      expect(events2[0].data.status).toBe('working');

      // Keep unsub2 alive — this is the fresh emitter the setTimeout must NOT delete
      // Wait for the original setTimeout to fire
      await new Promise(r => setTimeout(r, 1200));

      // After setTimeout fires, the fresh emitter should still work
      bus.emitStatus('sess-1', 'idle', 'done');
      await flushAsync();
      expect(events2).toHaveLength(2);
      expect(events2[1].data.status).toBe('idle');

      unsub2();
    });

    it('should clean up on destroy', () => {
      bus.subscribe('sess-1', () => {});
      bus.subscribe('sess-2', () => {});
      expect(bus.hasSubscribers('sess-1')).toBe(true);

      bus.destroy();
      expect(bus.hasSubscribers('sess-1')).toBe(false);
      expect(bus.hasSubscribers('sess-2')).toBe(false);
    });

    it('should include timestamp in all events', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitStatus('sess-1', 'working', 'test');
      await flushAsync();

      expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('SSE wire format', () => {
    it('should produce valid SSE data lines', async () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));
      bus.emitStatus('sess-1', 'working', 'test');
      await flushAsync();

      const sseData = `data: ${JSON.stringify(events[0])}\n\n`;
      expect(sseData).toContain('data: {');
      expect(sseData).toContain('"event":"status"');
      expect(sseData.endsWith('\n\n')).toBe(true);
    });

    it('should produce valid heartbeat events', () => {
      const heartbeat = JSON.stringify({
        event: 'heartbeat',
        sessionId: 'test-123',
        timestamp: new Date().toISOString(),
      });
      const parsed = JSON.parse(heartbeat);
      expect(parsed.event).toBe('heartbeat');
      expect(parsed.sessionId).toBe('test-123');
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should produce valid connected event', () => {
      const connected = JSON.stringify({
        event: 'connected',
        sessionId: 'test-123',
        timestamp: new Date().toISOString(),
      });
      const parsed = JSON.parse(connected);
      expect(parsed.event).toBe('connected');
      expect(parsed.sessionId).toBe('test-123');
    });
  });

  describe('Event Ring Buffer', () => {
    it('should store events in a ring buffer and return events after a given ID', async () => {
      for (let i = 0; i < 10; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }
      await flushAsync();

      const missed = bus.getEventsSince('sess-1', 5);
      expect(missed).toHaveLength(5);
      expect(missed[0].id).toBe(6);
      expect(missed[4].id).toBe(10);
    });

    it('should trim ring buffer to 50 events', async () => {
      for (let i = 0; i < 60; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }
      await flushAsync();

      const missed = bus.getEventsSince('sess-1', 0);
      expect(missed).toHaveLength(50);
      expect(missed[0].id).toBe(11);
      expect(missed[49].id).toBe(60);
    });

    it('should return empty array for unknown session', () => {
      expect(bus.getEventsSince('unknown', 0)).toEqual([]);
    });

    it('should assign incrementing IDs across all sessions', async () => {
      bus.emitStatus('sess-1', 'working', 'a');
      bus.emitStatus('sess-2', 'working', 'b');
      bus.emitStatus('sess-1', 'idle', 'c');
      await flushAsync();

      const s1 = bus.getEventsSince('sess-1', 0);
      expect(s1).toHaveLength(2);
      expect(s1[0].id).toBe(1);
      expect(s1[1].id).toBe(3);

      const s2 = bus.getEventsSince('sess-2', 0);
      expect(s2).toHaveLength(1);
      expect(s2[0].id).toBe(2);
    });
  });

  describe('Global Event Ring Buffer (Issue #301)', () => {
    it('should store global events in a ring buffer', async () => {
      bus.subscribeGlobal(() => {}); // activate global emitter
      bus.emitStatus('sess-1', 'working', 'event a');
      bus.emitStatus('sess-2', 'working', 'event b');
      await flushAsync();

      const missed = bus.getGlobalEventsSince(0);
      expect(missed).toHaveLength(2);
      expect(missed[0].id).toBe(1);
      expect(missed[0].event.event).toBe('session_status_change');
      expect(missed[0].event.sessionId).toBe('sess-1');
      expect(missed[1].id).toBe(2);
      expect(missed[1].event.sessionId).toBe('sess-2');
    });

    it('should return only events after a given ID', async () => {
      bus.subscribeGlobal(() => {});
      for (let i = 0; i < 10; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }
      await flushAsync();

      const missed = bus.getGlobalEventsSince(5);
      expect(missed).toHaveLength(5);
      expect(missed[0].id).toBe(6);
      expect(missed[4].id).toBe(10);
    });

    it('should trim global ring buffer to 50 events', async () => {
      bus.subscribeGlobal(() => {});
      for (let i = 0; i < 60; i++) {
        bus.emitStatus('sess-1', 'working', `event ${i}`);
      }
      await flushAsync();

      const missed = bus.getGlobalEventsSince(0);
      expect(missed).toHaveLength(50);
      expect(missed[0].id).toBe(11);
      expect(missed[49].id).toBe(60);
    });

    it('should return empty array when no events buffered', () => {
      expect(bus.getGlobalEventsSince(0)).toEqual([]);
    });

    it('should return empty array when all buffered events are before given ID', async () => {
      bus.subscribeGlobal(() => {});
      bus.emitStatus('sess-1', 'working', 'a');
      await flushAsync();

      expect(bus.getGlobalEventsSince(999)).toEqual([]);
    });

    it('should include global-only events (emitCreated) in the buffer', () => {
      bus.subscribeGlobal(() => {});
      bus.emitCreated('sess-new', 'my session', '/tmp');
      // emitCreated goes directly to global emitter, not through emit()
      // so it should still be buffered
      const missed = bus.getGlobalEventsSince(0);
      expect(missed).toHaveLength(1);
      expect(missed[0].event.event).toBe('session_created');
      expect(missed[0].event.sessionId).toBe('sess-new');
    });

    it('should clear global buffer on destroy', async () => {
      bus.subscribeGlobal(() => {});
      bus.emitStatus('sess-1', 'working', 'a');
      await flushAsync();

      bus.destroy();
      expect(bus.getGlobalEventsSince(0)).toEqual([]);
    });
  });
});
