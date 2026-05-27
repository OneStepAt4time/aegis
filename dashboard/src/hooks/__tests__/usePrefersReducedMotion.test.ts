import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

describe('usePrefersReducedMotion', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when system does not prefer reduced motion', async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const { usePrefersReducedMotion } = await import('../usePrefersReducedMotion');
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it('returns true when system prefers reduced motion', async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    // Clear module cache so it re-initializes
    vi.resetModules();
    const { usePrefersReducedMotion } = await import('../usePrefersReducedMotion');
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it('updates when media query change event fires', async () => {
    const listeners: Array<(e: MediaQueryListEvent) => void> = [];
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn((_event: string, handler: (e: MediaQueryListEvent) => void) => listeners.push(handler)),
      removeEventListener: vi.fn(),
    });
    vi.resetModules();
    const { usePrefersReducedMotion } = await import('../usePrefersReducedMotion');
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    // Simulate change event
    act(() => {
      listeners.forEach(fn => fn({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current).toBe(true);
  });

  it('removes listener on unmount', async () => {
    const removeEventListener = vi.fn();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener,
    });
    vi.resetModules();
    const { usePrefersReducedMotion } = await import('../usePrefersReducedMotion');
    const { unmount } = renderHook(() => usePrefersReducedMotion());
    unmount();
    expect(removeEventListener).toHaveBeenCalled();
  });
});
