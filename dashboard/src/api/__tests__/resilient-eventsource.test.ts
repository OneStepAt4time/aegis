/**
 * resilient-eventsource.test.ts — regression test for #4723.
 *
 * Verifies the EventSource is constructed with `withCredentials: true` so
 * cookie-based dashboard sessions (set by /v1/auth/verify) are sent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { perfRecorder } from '../../utils/perfRecorder';

interface MockInstance {
  url: string;
  options: EventSourceInit | undefined;
  onopen: ((ev?: Event) => void) | null;
  onmessage: ((ev?: MessageEvent) => void) | null;
  onerror: ((ev?: Event) => void) | null;
  readyState: number;
  close: () => void;
}

describe('ResilientEventSource withCredentials (#4723)', () => {
  let ctorSpy: ReturnType<typeof vi.fn>;
  let OriginalEventSource: typeof EventSource;
  let mockInstances: MockInstance[];

  beforeEach(() => {
    perfRecorder.reset();
    OriginalEventSource = globalThis.EventSource;
    mockInstances = [];
    // Must be a regular function so `new` works. Arrow functions can't be `new`'d.
    function MockEventSource(this: MockInstance, url: string, options?: EventSourceInit) {
      this.url = url;
      this.options = options;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.readyState = 0;
      this.close = vi.fn();
      mockInstances.push(this);
    }
    ctorSpy = vi.fn().mockImplementation(MockEventSource);
    (globalThis as unknown as { EventSource: unknown }).EventSource = ctorSpy;
  });

  afterEach(() => {
    (globalThis as unknown as { EventSource: typeof EventSource }).EventSource = OriginalEventSource;
  });

  it('constructs EventSource with withCredentials: true', async () => {
    const { ResilientEventSource } = await import('../resilient-eventsource');
    new ResilientEventSource('/v1/events', () => undefined);
    expect(ctorSpy).toHaveBeenCalledTimes(1);
    const [url, options] = ctorSpy.mock.calls[0] as [string, EventSourceInit];
    expect(url).toBe('/v1/events');
    expect(options).toEqual({ withCredentials: true });
  });

  it('fires recordSseOpen when the mock EventSource dispatches onopen', async () => {
    const { ResilientEventSource } = await import('../resilient-eventsource');
    new ResilientEventSource('/v1/events', () => undefined);
    const inst = mockInstances[0];
    inst.onopen?.(new Event('open'));
    const snap = perfRecorder.snapshot();
    expect(snap.sse['/v1/events']?.opens.count).toBe(1);
  });

  it('fires recordSseReconnect on backoff after onerror', async () => {
    vi.useFakeTimers();
    const { ResilientEventSource } = await import('../resilient-eventsource');
    new ResilientEventSource('/v1/events', () => undefined);
    const inst = mockInstances[0];
    inst.onerror?.(new Event('error'));
    vi.advanceTimersByTime(1100);
    expect(ctorSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    const snap = perfRecorder.snapshot();
    expect(snap.sse['/v1/events']?.reconnects.count).toBeGreaterThanOrEqual(1);
    vi.useRealTimers();
  });
});
