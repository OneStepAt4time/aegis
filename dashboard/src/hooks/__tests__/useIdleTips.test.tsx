import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleTips } from '../useIdleTips';

describe('useIdleTips', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with showTip=false', () => {
    const { result } = renderHook(() => useIdleTips({ idleTimeMs: 10000 }));
    expect(result.current.showTip).toBe(false);
  });

  it('returns a tip string from the provided list', () => {
    const tips = ['Tip A', 'Tip B'];
    const { result } = renderHook(() => useIdleTips({ tips, idleTimeMs: 60000 }));
    expect(tips).toContain(result.current.currentTip);
  });

  it('shows tip after idle time elapses', () => {
    const { result } = renderHook(() => useIdleTips({ idleTimeMs: 1000 }));
    expect(result.current.showTip).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current.showTip).toBe(true);
  });

  it('hides tip on user interaction', () => {
    const { result } = renderHook(() => useIdleTips({ idleTimeMs: 500 }));
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.showTip).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('mousedown'));
    });
    expect(result.current.showTip).toBe(false);
  });
});
