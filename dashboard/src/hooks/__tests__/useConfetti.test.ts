import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockConfetti = vi.fn();
vi.mock('canvas-confetti', () => ({
  default: (...args: unknown[]) => mockConfetti(...args),
}));

import { renderHook, act } from '@testing-library/react';
import { useConfetti } from '../useConfetti';

describe('useConfetti', () => {
  beforeEach(() => {
    localStorage.clear();
    mockConfetti.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('triggers confetti on first call', () => {
    const { result } = renderHook(() => useConfetti());
    act(() => {
      result.current.triggerFirstSessionConfetti();
    });
    expect(mockConfetti).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('aegis:first-session')).toBe('done');
  });

  it('does not trigger on subsequent calls within same hook', () => {
    const { result } = renderHook(() => useConfetti());
    act(() => {
      result.current.triggerFirstSessionConfetti();
    });
    expect(mockConfetti).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.triggerFirstSessionConfetti();
    });
    // Still 1 — second call should be no-op
    expect(mockConfetti).toHaveBeenCalledTimes(1);
  });

  it('does not trigger if already done in localStorage', () => {
    localStorage.setItem('aegis:first-session', 'done');
    const { result } = renderHook(() => useConfetti());
    act(() => {
      result.current.triggerFirstSessionConfetti();
    });
    expect(mockConfetti).not.toHaveBeenCalled();
  });
});
