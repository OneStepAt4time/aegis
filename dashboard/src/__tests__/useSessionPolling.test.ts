/**
 * useSessionPolling.test.ts — Tests for debounce timer cleanup (Issue #299).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionPolling } from '../hooks/useSessionPolling';

// Mock dependencies
vi.mock('../api/client', () => ({
  getSession: vi.fn(),
  getSessionHealth: vi.fn(),
  getSessionPane: vi.fn(),
  getSessionMetrics: vi.fn(),
  getSessionLatency: vi.fn(),
  subscribeSSE: vi.fn(),
}));

vi.mock('../store/useStore', () => ({
  useStore: vi.fn(),
}));

vi.mock('../store/useToastStore', () => ({
  useToastStore: vi.fn(),
}));

import { getSession, getSessionHealth, getSessionPane, getSessionMetrics, getSessionLatency, subscribeSSE } from '../api/client';
import { useStore } from '../store/useStore';
import { useToastStore } from '../store/useToastStore';

const mockedGetSession = vi.mocked(getSession);
const mockedGetSessionHealth = vi.mocked(getSessionHealth);
const mockedGetSessionPane = vi.mocked(getSessionPane);
const mockedGetSessionMetrics = vi.mocked(getSessionMetrics);
const mockedGetSessionLatency = vi.mocked(getSessionLatency);

describe('useSessionPolling', () => {
  let capturedHandler: ((e: MessageEvent) => void) | null = null;
  let unsubscribeFn: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    capturedHandler = null;
    unsubscribeFn = vi.fn();

    vi.mocked(useStore).mockReturnValue({ token: 'test-token' });
    vi.mocked(useToastStore).mockReturnValue({ addToast: vi.fn() });

    mockedGetSession.mockResolvedValue({
      id: 'session-a',
      windowId: 'w1',
      windowName: 'test',
      workDir: '/tmp',
      status: 'idle',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      stallThresholdMs: 300000,
      permissionMode: 'default',
      byteOffset: 0,
      monitorOffset: 0,
    } as any);
    mockedGetSessionHealth.mockResolvedValue({
      alive: true,
      windowExists: true,
      claudeRunning: true,
      paneCommand: null,
      status: 'idle',
      hasTranscript: false,
      lastActivity: Date.now(),
      lastActivityAgo: 0,
      sessionAge: 0,
      details: '',
    });
    mockedGetSessionPane.mockResolvedValue({ pane: 'content' });
    mockedGetSessionMetrics.mockResolvedValue({
      durationSec: 0,
      messages: 0,
      toolCalls: 0,
      approvals: 0,
      autoApprovals: 0,
      statusChanges: [],
    });
    mockedGetSessionLatency.mockResolvedValue({
      sessionId: 'session-a',
      realtime: {
        hook_latency_ms: 12,
        state_change_detection_ms: 12,
        permission_response_ms: null,
      },
      aggregated: {
        hook_latency_ms: { min: 12, max: 12, avg: 12, count: 1 },
        state_change_detection_ms: { min: 12, max: 12, avg: 12, count: 1 },
        permission_response_ms: { min: null, max: null, avg: null, count: 0 },
        channel_delivery_ms: { min: null, max: null, avg: null, count: 0 },
      },
    });

    (subscribeSSE as any).mockImplementation(
      (_sessionId: string, handler: (e: MessageEvent) => void): (() => void) => {
        capturedHandler = handler;
        return () => { unsubscribeFn(); };
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('cancels pending debounce timers when sessionId changes', async () => {
    const { rerender } = renderHook(
      ({ id }) => useSessionPolling(id),
      { initialProps: { id: 'session-a' } },
    );

    // Wait for initial load to complete
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Reset call counts after initial load
    mockedGetSessionPane.mockClear();
    mockedGetSessionHealth.mockClear();

    // Simulate an SSE event that triggers debounced refetch
    act(() => {
      capturedHandler!(
        new MessageEvent('message', {
          data: JSON.stringify({
            event: 'status',
            sessionId: 'session-a',
            timestamp: new Date().toISOString(),
            data: {},
          }),
        }),
      );
    });

    // Change sessionId BEFORE debounce fires (debounce is 1000ms)
    mockedGetSession.mockResolvedValue({
      id: 'session-b',
      windowId: 'w2',
      windowName: 'test-b',
      workDir: '/tmp',
      status: 'idle',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      stallThresholdMs: 300000,
      permissionMode: 'default',
      byteOffset: 0,
      monitorOffset: 0,
    } as any);

    rerender({ id: 'session-b' });

    // Wait for new session's initial load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Reset after new session load
    mockedGetSessionPane.mockClear();
    mockedGetSessionHealth.mockClear();

    // Advance past the debounce period
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    // The old debounce timer should NOT have fired
    // If the fix is missing, getSessionPane would be called with the stale ref
    expect(mockedGetSessionPane).not.toHaveBeenCalled();
    expect(mockedGetSessionHealth).not.toHaveBeenCalled();
  });

  it('discards stale debounce callbacks via generation counter', async () => {
    const { rerender } = renderHook(
      ({ id }) => useSessionPolling(id),
      { initialProps: { id: 'session-a' } },
    );

    // Wait for initial load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    mockedGetSessionPane.mockClear();

    // Simulate SSE event triggering debounce
    act(() => {
      capturedHandler!(
        new MessageEvent('message', {
          data: JSON.stringify({
            event: 'message',
            sessionId: 'session-a',
            timestamp: new Date().toISOString(),
            data: {},
          }),
        }),
      );
    });

    // Switch session immediately
    rerender({ id: 'session-b' });

    // Wait for new session's initial load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Clear counters after new session load
    const callsAfterSwitch = mockedGetSessionPane.mock.calls.length;

    // Advance past debounce period
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    // No additional calls should have been made by the old debounce
    expect(mockedGetSessionPane.mock.calls.length).toBe(callsAfterSwitch);
  });

  it('cleans up prior SSE subscription when sessionId changes', async () => {
    const unsubscribeA = vi.fn();
    const unsubscribeB = vi.fn();

    let subscribeCount = 0;
    (subscribeSSE as any).mockImplementation(() => {
      subscribeCount++;
      return subscribeCount === 1 ? unsubscribeA : unsubscribeB;
    });

    const { rerender, unmount } = renderHook(
      ({ id }) => useSessionPolling(id),
      { initialProps: { id: 'session-a' } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    rerender({ id: 'session-b' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(unsubscribeA).toHaveBeenCalledTimes(1);
    expect(unsubscribeB).not.toHaveBeenCalled();

    unmount();
    expect(unsubscribeB).toHaveBeenCalledTimes(1);
  });

  it('does not leave dangling SSE subscriptions across mount/unmount cycles', async () => {
    let activeSubscriptions = 0;
    let maxActiveSubscriptions = 0;

    (subscribeSSE as any).mockImplementation(() => {
      activeSubscriptions++;
      maxActiveSubscriptions = Math.max(maxActiveSubscriptions, activeSubscriptions);
      return () => {
        activeSubscriptions--;
      };
    });

    const first = renderHook(() => useSessionPolling('session-a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    first.unmount();

    const second = renderHook(() => useSessionPolling('session-a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    second.unmount();

    expect(activeSubscriptions).toBe(0);
    expect(maxActiveSubscriptions).toBe(1);
  });
});
