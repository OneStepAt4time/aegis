/**
 * usePrefersReducedMotion.test.tsx — Tests for reduced-motion media query hook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion';

let listeners: Record<string, (e: MediaQueryListEvent) => void> = {};
let matches = false;

const mockMql = {
  matches: false,
  media: '(prefers-reduced-motion: reduce)',
  addEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
    listeners[event] = handler;
  }),
  removeEventListener: vi.fn(),
};

const mockMatchMedia = vi.fn().mockImplementation(() => {
  mockMql.matches = matches;
  return mockMql;
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: mockMatchMedia,
});

function fireMediaChange(newMatches: boolean) {
  matches = newMatches;
  const handler = listeners['change'];
  if (handler) {
    act(() => {
      handler({ matches: newMatches } as MediaQueryListEvent);
    });
  }
}

describe('usePrefersReducedMotion', () => {
  beforeEach(() => {
    matches = false;
    listeners = {};
    vi.clearAllMocks();
  });

  it('returns false when user does not prefer reduced motion', () => {
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it('returns true when user prefers reduced motion', () => {
    matches = true;
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it('updates when media query changes', () => {
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    fireMediaChange(true);
    expect(result.current).toBe(true);

    fireMediaChange(false);
    expect(result.current).toBe(false);
  });

  it('queries the correct media query string', () => {
    renderHook(() => usePrefersReducedMotion());
    expect(mockMatchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('cleans up listener on unmount', () => {
    const { unmount } = renderHook(() => usePrefersReducedMotion());
    expect(mockMql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    unmount();
    expect(mockMql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
