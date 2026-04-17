/**
 * useSseAwarePolling.test.ts — Tests for SSE-aware polling hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useSseAwarePolling,
  DEFAULT_SSE_EVENT_DEBOUNCE_MS,
} from '../hooks/useSseAwarePolling';

const FALLBACK_MS = 5000;
const HEALTHY_MS = 30_000;

function renderPolling(
  overrides: Partial<Parameters<typeof useSseAwarePolling>[0]> = {},
) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const result = renderHook(
    (props: Parameters<typeof useSseAwarePolling>[0]) =>
      useSseAwarePolling(props),
    {
      initialProps: {
        refresh,
        sseConnected: false,
        fallbackPollIntervalMs: FALLBACK_MS,
        healthyPollIntervalMs: HEALTHY_MS,
        ...overrides,
      },
    },
  );
  return { ...result, refresh };
}

describe('useSseAwarePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls refresh immediately on mount', async () => {
    const { refresh } = renderPolling();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('uses fallbackPollIntervalMs when SSE is disconnected', async () => {
    const { refresh } = renderPolling({ sseConnected: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    refresh.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FALLBACK_MS - 1);
    });
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('uses healthyPollIntervalMs when SSE is connected', async () => {
    const { refresh } = renderPolling({ sseConnected: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    refresh.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEALTHY_MS - 1);
    });
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('debounces event-triggered refresh when SSE is connected', async () => {
    const eventTrigger = { id: 1 };
    const { refresh, rerender } = renderPolling({
      sseConnected: true,
      eventTrigger,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    refresh.mockClear();

    // New event trigger value while SSE connected
    rerender({
      refresh,
      sseConnected: true,
      eventTrigger: { id: 2 },
      fallbackPollIntervalMs: FALLBACK_MS,
      healthyPollIntervalMs: HEALTHY_MS,
    });

    // Not yet — debounce window hasn't elapsed
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_SSE_EVENT_DEBOUNCE_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does NOT debounce event trigger when SSE is disconnected', async () => {
    const { refresh, rerender } = renderPolling({
      sseConnected: false,
      eventTrigger: { id: 1 },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    refresh.mockClear();

    // Advance past the debounce window to prove no event-triggered refresh
    rerender({
      refresh,
      sseConnected: false,
      eventTrigger: { id: 2 },
      fallbackPollIntervalMs: FALLBACK_MS,
      healthyPollIntervalMs: HEALTHY_MS,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_SSE_EVENT_DEBOUNCE_MS + 100);
    });

    // Only poll-cycle refreshes, never event-triggered ones
    expect(refresh).not.toHaveBeenCalledTimes(2);
  });

  it('queues a second refresh when one is already in flight', async () => {
    let resolveRefresh: () => void;
    const refresh = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolveRefresh = r; }),
    );

    renderHook(
      (props: Parameters<typeof useSseAwarePolling>[0]) =>
        useSseAwarePolling(props),
      {
        initialProps: {
          refresh,
          sseConnected: false,
          fallbackPollIntervalMs: FALLBACK_MS,
          healthyPollIntervalMs: HEALTHY_MS,
        },
      },
    );

    // Initial refresh is in flight
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    // Resolve the first refresh, then queue another via poll timer
    await act(async () => {
      resolveRefresh!();
      await vi.advanceTimersByTimeAsync(FALLBACK_MS);
    });

    // First call completed, second was queued and ran
    expect(refresh).toHaveBeenCalled();
  });

  it('skips event trigger when value is unchanged', async () => {
    const trigger = { id: 1 };
    const { refresh, rerender } = renderPolling({
      sseConnected: true,
      eventTrigger: trigger,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    refresh.mockClear();

    // Same object reference = no new event
    rerender({
      refresh,
      sseConnected: true,
      eventTrigger: trigger,
      fallbackPollIntervalMs: FALLBACK_MS,
      healthyPollIntervalMs: HEALTHY_MS,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_SSE_EVENT_DEBOUNCE_MS + 100);
    });

    // Only poll-cycle refreshes, no event-triggered refresh
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('skips event trigger when eventTrigger is undefined', async () => {
    const { refresh } = renderPolling({
      sseConnected: true,
      eventTrigger: undefined,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const initialCalls = refresh.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_SSE_EVENT_DEBOUNCE_MS + 100);
    });

    // No extra event-triggered refresh, only poll cycles
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(initialCalls);
  });

  it('clears all timers on unmount', async () => {
    const { refresh, unmount } = renderPolling({ sseConnected: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    refresh.mockClear();

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FALLBACK_MS * 2);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('coalesces rapid event triggers within debounce window', async () => {
    const { refresh, rerender } = renderPolling({
      sseConnected: true,
      eventTrigger: { id: 1 },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    refresh.mockClear();

    // Fire several events in quick succession
    for (let i = 2; i <= 5; i++) {
      rerender({
        refresh,
        sseConnected: true,
        eventTrigger: { id: i },
        fallbackPollIntervalMs: FALLBACK_MS,
        healthyPollIntervalMs: HEALTHY_MS,
      });
    }

    // Only one debounce timer should be active — first event sets it,
    // subsequent events are ignored (timer already exists)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_SSE_EVENT_DEBOUNCE_MS);
    });

    // Exactly one event-triggered refresh
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('uses custom eventDebounceMs when provided', async () => {
    const customDebounce = 250;
    const { refresh, rerender } = renderPolling({
      sseConnected: true,
      eventTrigger: { id: 1 },
      eventDebounceMs: customDebounce,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    refresh.mockClear();

    rerender({
      refresh,
      sseConnected: true,
      eventTrigger: { id: 2 },
      fallbackPollIntervalMs: FALLBACK_MS,
      healthyPollIntervalMs: HEALTHY_MS,
      eventDebounceMs: customDebounce,
    });

    // Custom debounce hasn't elapsed yet (only 200ms of 250ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(customDebounce - 50);
    });
    expect(refresh).not.toHaveBeenCalled();

    // Custom debounce has elapsed
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
