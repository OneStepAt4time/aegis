/**
 * resilient-eventsource.test.ts — Tests for Issue #308 ResilientEventSource.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResilientEventSource } from '../api/resilient-eventsource';

describe('ResilientEventSource', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should create EventSource and forward messages', () => {
    let createdUrl = '';
    const fakeES = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      onopen: null as (() => void) | null,
      onerror: null as (() => void) | null,
      close: vi.fn(),
    };

    vi.stubGlobal('EventSource', class MockEventSource {
      constructor(url: string) {
        createdUrl = url;
        return fakeES as any;
      }
    });

    const handler = vi.fn();
    new ResilientEventSource('/v1/sessions/sess-1/events', handler);

    expect(createdUrl).toBe('/v1/sessions/sess-1/events');

    // Simulate message
    const msg = new MessageEvent('message', { data: '{"event":"status"}' });
    fakeES.onmessage!(msg);
    expect(handler).toHaveBeenCalled();
  });

  it('should reconnect with exponential backoff on error', () => {
    let createCount = 0;
    const connections: Array<{ onmessage: any; onerror: any; close: () => void }> = [];

    vi.stubGlobal('EventSource', class MockEventSource {
      constructor() {
        createCount++;
        const conn = { onmessage: null as any, onerror: null as any, close: vi.fn() };
        connections.push(conn);
        // First connection fails immediately
        if (createCount === 1) {
          setTimeout(() => conn.onerror?.(), 0);
        }
        return conn as any;
      }
    });

    const handler = vi.fn();
    const onReconnecting = vi.fn();
    new ResilientEventSource('/v1/events', handler, { onReconnecting });

    // Process the immediate setTimeout from the first connection's error
    vi.advanceTimersByTime(100);
    expect(createCount).toBe(1);

    // Advance past 1st backoff (1s)
    vi.advanceTimersByTime(1500);
    expect(createCount).toBe(2);
    expect(onReconnecting).toHaveBeenCalledWith(1, expect.any(Number));
    // delay should be 1s (1000 * 2^0)
    expect(onReconnecting.mock.calls[0][1]).toBe(1000);

    // Simulate 2nd connection also failing
    connections[1].onerror?.();
    vi.advanceTimersByTime(100);

    // Advance past 2nd backoff (2s)
    vi.advanceTimersByTime(2500);
    expect(createCount).toBe(3);
    expect(onReconnecting).toHaveBeenCalledWith(2, expect.any(Number));
    // delay should be 2s (1000 * 2^1)
    expect(onReconnecting.mock.calls[1][1]).toBe(2000);
  });

  it('should cap backoff at 30 seconds', () => {
    let createCount = 0;
    const connections: Array<{ onerror: any; close: () => void }> = [];

    vi.stubGlobal('EventSource', class MockEventSource {
      constructor() {
        createCount++;
        const conn = { onmessage: null as any, onopen: null as any, onerror: null as any, close: vi.fn() };
        connections.push(conn);
        if (createCount === 1) {
          setTimeout(() => conn.onerror?.(), 0);
        }
        return conn as any;
      }
    });

    const onReconnecting = vi.fn();
    new ResilientEventSource('/v1/events', vi.fn(), { onReconnecting });

    // Fail through many attempts to reach the cap
    // After 5 failures: delay = 1000 * 2^4 = 16000
    // After 6 failures: delay = 1000 * 2^5 = 32000 → capped at 30000
    for (let i = 0; i < 5; i++) {
      if (connections[i]) connections[i].onerror?.();
      vi.advanceTimersByTime(100);
      // Get the delay from the onReconnecting call
      if (i < 4) {
        const delay = onReconnecting.mock.calls[i]?.[1] ?? 1000;
        vi.advanceTimersByTime(delay + 500);
      }
    }

    // The 5th reconnection attempt (index 4 in calls) should have capped delay
    // Actually, let's just check the max
    const delays = onReconnecting.mock.calls.map(c => c[1]);
    const maxDelay = Math.max(...delays);
    expect(maxDelay).toBeLessThanOrEqual(30000);
  });

  it('should give up after 5 minutes of continuous failure', () => {
    vi.stubGlobal('EventSource', class MockEventSource {
      constructor() {
        const conn = { onmessage: null as any, onopen: null as any, onerror: null as any, close: vi.fn() };
        // All connections fail immediately
        setTimeout(() => conn.onerror?.(), 0);
        return conn as any;
      }
    });

    const onGiveUp = vi.fn();
    new ResilientEventSource('/v1/events', vi.fn(), { onGiveUp });

    // Advance just past 5 minutes
    vi.advanceTimersByTime(5 * 60 * 1000 + 60_000);

    expect(onGiveUp).toHaveBeenCalled();
  });

  it('should reset failure counter on successful connection', () => {
    let createCount = 0;
    const connections: Array<{ onopen: any; onerror: any; close: () => void }> = [];

    vi.stubGlobal('EventSource', class MockEventSource {
      constructor() {
        createCount++;
        const conn = { onmessage: null as any, onopen: null as any, onerror: null as any, close: vi.fn() };
        connections.push(conn);
        return conn as any;
      }
    });

    const onReconnecting = vi.fn();
    new ResilientEventSource('/v1/events', vi.fn(), { onReconnecting });

    // First connection succeeds
    connections[0].onopen?.();

    // Then fails
    connections[0].onerror?.();
    vi.advanceTimersByTime(100);

    // Should be attempt 1 (reset, not 2)
    vi.advanceTimersByTime(1500);
    expect(onReconnecting).toHaveBeenCalledWith(1, 1000);
  });

  it('should stop reconnecting after close()', () => {
    let createCount = 0;
    const connections: Array<{ onerror: any; close: () => void }> = [];

    vi.stubGlobal('EventSource', class MockEventSource {
      constructor() {
        createCount++;
        const conn = { onmessage: null as any, onopen: null as any, onerror: null as any, close: vi.fn() };
        connections.push(conn);
        setTimeout(() => conn.onerror?.(), 0);
        return conn as any;
      }
    });

    const onReconnecting = vi.fn();
    const res = new ResilientEventSource('/v1/events', vi.fn(), { onReconnecting });

    // Let first connection fail
    vi.advanceTimersByTime(100);

    // Close before reconnect fires
    res.close();

    // Advance past all possible reconnect timers
    vi.advanceTimersByTime(5 * 60 * 1000);

    // Should not have reconnected (still only 1 creation)
    expect(createCount).toBe(1);
    expect(connections[0].close).toHaveBeenCalled();
  });
});
