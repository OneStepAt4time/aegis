/**
 * LocalEventBus tests — Issue #4229
 *
 * Covers: publish/subscribe, replay, destroy, buffer limits.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalEventBus } from '../local-event-bus.js';
import type { BusEvent } from '../event-bus.js';

/** Wait for all pending setImmediate callbacks to flush. */
function flushImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('LocalEventBus', () => {
  let bus: LocalEventBus;

  beforeEach(() => {
    bus = new LocalEventBus(10); // small buffer for testing
  });

  it('publishes and delivers events to subscribers', async () => {
    const handler = vi.fn();
    bus.subscribe('session:abc', handler);
    const id = bus.publish('session:abc', 'status', { status: 'running' });

    await flushImmediate();

    expect(id).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as BusEvent;
    expect(event.channel).toBe('session:abc');
    expect(event.type).toBe('status');
    expect(event.data).toEqual({ status: 'running' });
    expect(event.id).toBe(1);
  });

  it('returns unsubscribe function that stops delivery', async () => {
    const handler = vi.fn();
    const unsub = bus.subscribe('session:abc', handler);

    // First publish — handler should receive it
    bus.publish('session:abc', 'status', { step: 1 });
    await flushImmediate();
    expect(handler).toHaveBeenCalledTimes(1);

    // Unsubscribe
    unsub();

    // Second publish — handler should NOT receive it
    bus.publish('session:abc', 'status', { step: 2 });
    await flushImmediate();
    expect(handler).toHaveBeenCalledTimes(1); // still 1
  });

  it('delivers events to multiple subscribers on same channel', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe('session:abc', h1);
    bus.subscribe('session:abc', h2);
    bus.publish('session:abc', 'status', {});

    await flushImmediate();

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('does not deliver events across different channels', async () => {
    const handler = vi.fn();
    bus.subscribe('session:abc', handler);
    bus.publish('session:def', 'status', {});

    await flushImmediate();
    expect(handler).not.toHaveBeenCalled();
  });

  it('replays events since a given ID', () => {
    bus.publish('session:abc', 'status', { step: 1 });
    bus.publish('session:abc', 'status', { step: 2 });
    bus.publish('session:abc', 'status', { step: 3 });

    const replayed = bus.replaySince('session:abc', 1);
    expect(replayed).toHaveLength(2);
    expect(replayed[0].data).toEqual({ step: 2 });
    expect(replayed[1].data).toEqual({ step: 3 });
  });

  it('returns empty array for replay on unknown channel', () => {
    const replayed = bus.replaySince('unknown', 0);
    expect(replayed).toEqual([]);
  });

  it('respects buffer size limit', () => {
    // Buffer size is 10
    for (let i = 0; i < 15; i++) {
      bus.publish('session:abc', 'status', { step: i });
    }

    const replayed = bus.replaySince('session:abc', 0);
    expect(replayed).toHaveLength(10);
    // Oldest 5 should be evicted
    expect(replayed[0].data).toEqual({ step: 5 });
    expect(replayed[9].data).toEqual({ step: 14 });
  });

  it('assigns monotonically increasing IDs', () => {
    const id1 = bus.publish('session:abc', 'status', {});
    const id2 = bus.publish('session:def', 'status', {});
    const id3 = bus.publish('session:abc', 'status', {});

    expect(id1).toBeLessThan(id2);
    expect(id2).toBeLessThan(id3);
  });

  it('cleans up all state on destroy', () => {
    const handler = vi.fn();
    bus.subscribe('session:abc', handler);
    bus.publish('session:abc', 'status', {});
    bus.destroy();

    // After destroy, replay returns empty
    expect(bus.replaySince('session:abc', 0)).toEqual([]);
  });

  it('cleans up emitter when last subscriber unsubscribes', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const unsub1 = bus.subscribe('session:abc', h1);
    const unsub2 = bus.subscribe('session:abc', h2);

    unsub1();
    unsub2();

    // Channel emitter should be cleaned up — publish still works (creates new)
    const id = bus.publish('session:abc', 'status', {});
    expect(id).toBeGreaterThan(0);
  });

  it('includes timestamp in ISO 8601 format', () => {
    bus.publish('session:abc', 'status', {});
    const [event] = bus.replaySince('session:abc', 0);
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
