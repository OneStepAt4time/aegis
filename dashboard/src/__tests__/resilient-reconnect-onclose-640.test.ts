/**
 * resilient-reconnect-onclose-640.test.ts — Test for Issue #640.
 *
 * Verifies that onClose is NOT called during reconnection attempts,
 * only when giving up or on explicit close.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResilientEventSource } from '../api/resilient-eventsource';

describe('Issue #640: onClose suppression during reconnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should NOT call onClose during intermediate reconnection attempts', () => {
    let createCount = 0;
    const connections: Array<{ onerror: any; close: () => void }> = [];

    vi.stubGlobal('EventSource', class MockEventSource {
      constructor() {
        createCount++;
        const conn = { onmessage: null as any, onopen: null as any, onerror: null as any, close: vi.fn() };
        connections.push(conn);
        // All connections fail
        setTimeout(() => conn.onerror?.(), 0);
        return conn as any;
      }
    });

    const onClose = vi.fn();
    const onReconnecting = vi.fn();
    new ResilientEventSource('/v1/events', vi.fn(), { onClose, onReconnecting });

    // First connection fails
    vi.advanceTimersByTime(100);

    // First reconnect attempt (1s backoff)
    vi.advanceTimersByTime(1500);
    expect(onReconnecting).toHaveBeenCalledTimes(1);

    // Second reconnect attempt (2s backoff)
    connections[1]?.onerror?.();
    vi.advanceTimersByTime(2500);
    expect(onReconnecting).toHaveBeenCalledTimes(2);

    // Third reconnect attempt (4s backoff)
    connections[2]?.onerror?.();
    vi.advanceTimersByTime(4500);
    expect(onReconnecting).toHaveBeenCalledTimes(3);

    // onClose should NOT have been called during any intermediate reconnection
    expect(onClose).not.toHaveBeenCalled();
  });

  it('should call onClose when giving up after 5 minutes', () => {
    vi.stubGlobal('EventSource', class MockEventSource {
      constructor() {
        const conn = { onmessage: null as any, onopen: null as any, onerror: null as any, close: vi.fn() };
        setTimeout(() => conn.onerror?.(), 0);
        return conn as any;
      }
    });

    const onClose = vi.fn();
    const onGiveUp = vi.fn();
    new ResilientEventSource('/v1/events', vi.fn(), { onClose, onGiveUp });

    // Advance past 5 minutes
    vi.advanceTimersByTime(5 * 60 * 1000 + 60_000);

    // Both onGiveUp and onClose should be called in the give-up path
    expect(onGiveUp).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should still allow onReconnecting callbacks during reconnection', () => {
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
    new ResilientEventSource('/v1/events', vi.fn(), { onReconnecting });

    // Process error and reconnects
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(1500);

    expect(onReconnecting).toHaveBeenCalledWith(1, expect.any(Number));
  });
});
