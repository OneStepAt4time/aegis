/**
 * useCopy.test.tsx — Tests for clipboard copy hook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCopy } from '../useCopy';

describe('useCopy', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('returns copied=false initially', () => {
    const { result } = renderHook(() => useCopy('test-value'));
    expect(result.current.copied).toBe(false);
  });

  it('sets copied=true after copy()', async () => {
    const { result } = renderHook(() => useCopy('hello'));
    await act(async () => {
      result.current.copy();
    });
    expect(result.current.copied).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello');
  });

  it('resets copied to false after timeout', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopy('hello'));
    await act(async () => {
      result.current.copy();
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.copied).toBe(false);
    vi.useRealTimers();
  });
});
