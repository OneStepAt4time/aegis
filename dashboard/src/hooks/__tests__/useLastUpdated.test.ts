/**
 * hooks/__tests__/useLastUpdated.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLastUpdated } from '../useLastUpdated';

describe('useLastUpdated', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" initially', () => {
    const { result } = renderHook(() => useLastUpdated());
    expect(result.current.relativeTime).toBe('just now');
    expect(result.current.isStale).toBe(false);
  });

  it('updates relative time as time passes', () => {
    const { result } = renderHook(() => useLastUpdated());

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.relativeTime).toBe('10s ago');
    expect(result.current.isStale).toBe(false);
  });

  it('marks stale after 30 seconds', () => {
    const { result } = renderHook(() => useLastUpdated());

    act(() => {
      vi.advanceTimersByTime(31_000);
    });

    expect(result.current.isStale).toBe(true);
    expect(result.current.relativeTime).toBe('31s ago');
  });

  it('markUpdated resets the timer', () => {
    const { result } = renderHook(() => useLastUpdated());

    act(() => {
      vi.advanceTimersByTime(45_000);
    });

    expect(result.current.isStale).toBe(true);

    act(() => {
      result.current.markUpdated();
    });

    expect(result.current.relativeTime).toBe('just now');
    expect(result.current.isStale).toBe(false);
  });

  it('shows minutes for >= 60s', () => {
    const { result } = renderHook(() => useLastUpdated());

    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    expect(result.current.relativeTime).toBe('2m ago');
  });

  it('shows hours for >= 3600s', () => {
    const { result } = renderHook(() => useLastUpdated());

    act(() => {
      vi.advanceTimersByTime(7200_000);
    });

    expect(result.current.relativeTime).toBe('2h ago');
  });
});
