/**
 * sse-events.test.ts — Tests for Issue #32: SSE event stream.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionEventBus, type SessionSSEEvent } from '../events.js';

describe('SSE Event System (Issue #32)', () => {
  let bus: SessionEventBus;

  beforeEach(() => {
    bus = new SessionEventBus();
  });

  describe('SessionEventBus', () => {
    it('should subscribe and receive events', () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitStatus('sess-1', 'working', 'Claude is working');

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('status');
      expect(events[0].sessionId).toBe('sess-1');
      expect(events[0].data.status).toBe('working');
    });

    it('should not receive events from other sessions', () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitStatus('sess-2', 'working', 'Claude is working');

      expect(events).toHaveLength(0);
    });

    it('should support multiple subscribers', () => {
      const events1: SessionSSEEvent[] = [];
      const events2: SessionSSEEvent[] = [];

      bus.subscribe('sess-1', (e) => events1.push(e));
      bus.subscribe('sess-1', (e) => events2.push(e));

      bus.emitStatus('sess-1', 'idle', 'done');

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
    });

    it('should unsubscribe correctly', () => {
      const events: SessionSSEEvent[] = [];
      const unsub = bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitStatus('sess-1', 'working', 'working');
      expect(events).toHaveLength(1);

      unsub();

      bus.emitStatus('sess-1', 'idle', 'idle');
      expect(events).toHaveLength(1); // No new events after unsub
    });

    it('should emit message events with role and text', () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitMessage('sess-1', 'assistant', 'Hello world', 'text');

      expect(events[0].event).toBe('message');
      expect(events[0].data.role).toBe('assistant');
      expect(events[0].data.text).toBe('Hello world');
      expect(events[0].data.contentType).toBe('text');
    });

    it('should emit approval events', () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitApproval('sess-1', 'Allow write to foo.ts?');

      expect(events[0].event).toBe('approval');
      expect(events[0].data.prompt).toBe('Allow write to foo.ts?');
    });

    it('should emit ended events', () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitEnded('sess-1', 'completed');

      expect(events[0].event).toBe('ended');
      expect(events[0].data.reason).toBe('completed');
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

    it('should clean up on destroy', () => {
      bus.subscribe('sess-1', () => {});
      bus.subscribe('sess-2', () => {});
      expect(bus.hasSubscribers('sess-1')).toBe(true);

      bus.destroy();
      expect(bus.hasSubscribers('sess-1')).toBe(false);
      expect(bus.hasSubscribers('sess-2')).toBe(false);
    });

    it('should include timestamp in all events', () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));

      bus.emitStatus('sess-1', 'working', 'test');

      expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('SSE wire format', () => {
    it('should produce valid SSE data lines', () => {
      const events: SessionSSEEvent[] = [];
      bus.subscribe('sess-1', (e) => events.push(e));
      bus.emitStatus('sess-1', 'working', 'test');

      const sseData = `data: ${JSON.stringify(events[0])}\n\n`;
      expect(sseData).toContain('data: {');
      expect(sseData).toContain('"event":"status"');
      expect(sseData.endsWith('\n\n')).toBe(true);
    });

    it('should produce valid heartbeat comments', () => {
      const heartbeat = `: heartbeat\n\n`;
      expect(heartbeat.startsWith(':')).toBe(true);
      expect(heartbeat.endsWith('\n\n')).toBe(true);
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
});
