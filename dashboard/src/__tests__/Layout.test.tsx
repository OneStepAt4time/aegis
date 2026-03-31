/**
 * Layout.test.tsx — Tests for Layout SSE error handling (#587).
 *
 * Verifies that if subscribeGlobalSSE throws synchronously, the component
 * survives (no crash), retries with exponential backoff, and shows error state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockSubscribeGlobalSSE = vi.fn();

vi.mock('../api/client', () => ({
  subscribeGlobalSSE: (...args: unknown[]) => mockSubscribeGlobalSSE(...args),
}));

vi.mock('../components/ToastContainer', () => ({
  default: () => <div data-testid="toast-container" />,
}));

// Lazy import so mocks are in place
import Layout from '../components/Layout';

function renderLayout(): RenderResult {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>Test Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Layout SSE error handling (#587)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders without crashing when subscribeGlobalSSE succeeds', () => {
    mockSubscribeGlobalSSE.mockReturnValue(() => {});
    renderLayout();
    expect(screen.getByText('Aegis Dashboard')).toBeDefined();
    expect(mockSubscribeGlobalSSE).toHaveBeenCalled();
  });

  it('renders without crashing when subscribeGlobalSSE throws synchronously', () => {
    mockSubscribeGlobalSSE.mockImplementation(() => {
      throw new Error('Invalid URL construction');
    });

    // Should NOT throw — the component catches the error
    expect(() => renderLayout()).not.toThrow();
    expect(screen.getByText('Aegis Dashboard')).toBeDefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to subscribe to global SSE"),
      expect.any(Number),
      expect.any(Error),
    );
  });

  it('calls unsubscribe on cleanup', () => {
    const unsubscribe = vi.fn();
    mockSubscribeGlobalSSE.mockReturnValue(unsubscribe);

    const { unmount } = renderLayout();
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('does not call unsubscribe on cleanup when subscribeGlobalSSE threw', () => {
    mockSubscribeGlobalSSE.mockImplementation(() => {
      throw new Error('boom');
    });

    const { unmount } = renderLayout();
    // Unmounting should not throw even though unsubscribe is undefined
    expect(() => unmount()).not.toThrow();
  });

  it('retries with exponential backoff when subscribeGlobalSSE throws', () => {
    const callCounts: number[] = [];
    mockSubscribeGlobalSSE.mockImplementation(() => {
      callCounts.push(callCounts.length + 1);
      throw new Error('Network error');
    });

    renderLayout();

    // First attempt happened immediately
    expect(callCounts).toHaveLength(1);

    // Advance past first retry delay (1s)
    act(() => { vi.advanceTimersByTime(1000); });
    expect(callCounts).toHaveLength(2);

    // Advance past second retry delay (2s)
    act(() => { vi.advanceTimersByTime(2000); });
    expect(callCounts).toHaveLength(3);

    // Advance past third retry delay (4s)
    act(() => { vi.advanceTimersByTime(4000); });
    expect(callCounts).toHaveLength(4);

    // Advance past fourth retry delay (8s)
    act(() => { vi.advanceTimersByTime(8000); });
    expect(callCounts).toHaveLength(5);

    // Fifth retry delay (16s) — last retry
    act(() => { vi.advanceTimersByTime(16000); });
    expect(callCounts).toHaveLength(6);

    // Should NOT retry beyond MAX_SSE_RETRIES (5 retries = 6 total attempts)
    act(() => { vi.advanceTimersByTime(32000); });
    expect(callCounts).toHaveLength(6);
  });

  it('shows error indicator after all retries exhausted', () => {
    mockSubscribeGlobalSSE.mockImplementation(() => {
      throw new Error('Persistent failure');
    });

    renderLayout();

    // Exhaust all retries
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { vi.advanceTimersByTime(4000); });
    act(() => { vi.advanceTimersByTime(8000); });
    act(() => { vi.advanceTimersByTime(16000); });

    expect(screen.getByText(/SSE Error/)).toBeDefined();
  });

  it('clears error state on successful reconnection', () => {
    let attempt = 0;
    mockSubscribeGlobalSSE.mockImplementation((_cb: any, _token: any, opts?: any) => {
      attempt++;
      if (attempt === 1) throw new Error('Temporary failure');
      // Simulate successful connection: invoke onOpen callback
      opts?.onOpen?.();
      return () => {};
    });

    renderLayout();

    // Advance past first retry — succeeds
    act(() => { vi.advanceTimersByTime(1000); });

    // Should not show error indicator after reconnection
    expect(screen.queryByText(/SSE Error/)).toBeNull();
  });

  it('stops retrying when component unmounts', () => {
    mockSubscribeGlobalSSE.mockImplementation(() => {
      throw new Error('Network error');
    });

    const { unmount } = renderLayout();
    expect(mockSubscribeGlobalSSE).toHaveBeenCalledTimes(1);

    unmount();

    // Advance time — should NOT trigger more retries
    act(() => { vi.advanceTimersByTime(10000); });
    expect(mockSubscribeGlobalSSE).toHaveBeenCalledTimes(1);
  });

  it('passes onGiveUp callback to subscribeGlobalSSE', () => {
    let capturedCallbacks: { onGiveUp?: () => void } = {};
    mockSubscribeGlobalSSE.mockImplementation((_handler: unknown, _token: unknown, callbacks: { onGiveUp?: () => void }) => {
      capturedCallbacks = callbacks;
      return () => {};
    });

    renderLayout();

    // Simulate the ResilientEventSource giving up
    act(() => {
      capturedCallbacks.onGiveUp?.();
    });

    expect(screen.getByText(/SSE Error/)).toBeDefined();
  });
});
