import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

describe('useLastUpdated', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with "just now"', async () => {
    const { useLastUpdated } = await import('../useLastUpdated');
    const { result } = renderHook(() => useLastUpdated());
    expect(result.current.relativeTime).toBe('just now');
    expect(result.current.isStale).toBe(false);
  });

  it('shows seconds ago after time passes', async () => {
    vi.resetModules();
    const { useLastUpdated } = await import('../useLastUpdated');
    const { result } = renderHook(() => useLastUpdated());
    vi.advanceTimersByTime(10000);
    // Force re-render by advancing timer tick
    act(() => { vi.advanceTimersByTime(5000); });
    // After ~11s, should show "10s ago" or similar
    expect(result.current.relativeTime).toMatch(/\ds ago/);
  });

  it('shows minutes ago after 60s', async () => {
    vi.resetModules();
    const { useLastUpdated } = await import('../useLastUpdated');
    const { result } = renderHook(() => useLastUpdated());
    act(() => { vi.advanceTimersByTime(61000); });
    expect(result.current.relativeTime).toMatch(/1m ago/);
  });

  it('isStale becomes true after 30s', async () => {
    vi.resetModules();
    const { useLastUpdated } = await import('../useLastUpdated');
    const { result } = renderHook(() => useLastUpdated());
    expect(result.current.isStale).toBe(false);
    act(() => { vi.advanceTimersByTime(31000); });
    expect(result.current.isStale).toBe(true);
  });

  it('markUpdated resets staleness', async () => {
    vi.resetModules();
    const { useLastUpdated } = await import('../useLastUpdated');
    const { result } = renderHook(() => useLastUpdated());
    act(() => { vi.advanceTimersByTime(31000); });
    expect(result.current.isStale).toBe(true);
    act(() => { result.current.markUpdated(); });
    expect(result.current.isStale).toBe(false);
    expect(result.current.relativeTime).toBe('just now');
  });

  it('cleans up interval on unmount', async () => {
    vi.resetModules();
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const { useLastUpdated } = await import('../useLastUpdated');
    const { unmount } = renderHook(() => useLastUpdated());
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
