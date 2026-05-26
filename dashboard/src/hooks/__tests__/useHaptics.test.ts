import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHaptics } from '../useHaptics';

describe('useHaptics', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { vibrate: vi.fn().mockReturnValue(true) });
  });

  it('vibrate calls navigator.vibrate with pattern', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.vibrate(200);
    expect(navigator.vibrate).toHaveBeenCalledWith(200);
  });

  it('approve triggers short vibration', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.approve();
    expect(navigator.vibrate).toHaveBeenCalledWith([30]);
  });

  it('reject triggers double vibration', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.reject();
    expect(navigator.vibrate).toHaveBeenCalledWith([60, 30, 60]);
  });

  it('returns false when vibrate API unavailable', () => {
    vi.stubGlobal('navigator', { vibrate: undefined });
    const { result } = renderHook(() => useHaptics());
    expect(result.current.vibrate(100)).toBe(false);
  });
});
