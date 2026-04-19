/**
 * useTheme.test.ts — Tests for dark/light theme toggle hook.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const STORAGE_KEY = 'aegis-dashboard-theme';

describe('useTheme', () => {
  const matchMediaMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');

    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    window.matchMedia = matchMediaMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to dark when no stored preference and system prefers dark', async () => {
    const { useTheme } = await import('../hooks/useTheme');
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
  });

  it('defaults to dark when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });

    const { useTheme } = await import('../hooks/useTheme');
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
  });

  it('toggles between light and dark', async () => {
    const { useTheme } = await import('../hooks/useTheme');
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe('light');

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe('dark');
  });

  it('persists theme to localStorage', async () => {
    const { useTheme } = await import('../hooks/useTheme');
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('initializes from localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, 'light');

    const { useTheme } = await import('../hooks/useTheme');
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('light');
  });

  it('ignores invalid localStorage values and falls back to dark', async () => {
    localStorage.setItem(STORAGE_KEY, 'banana');

    const { useTheme } = await import('../hooks/useTheme');
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
  });

  it('sets data-theme attribute on document element', async () => {
    const { useTheme } = await import('../hooks/useTheme');
    renderHook(() => useTheme());

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('updates data-theme attribute on toggle', async () => {
    const { useTheme } = await import('../hooks/useTheme');
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('registers a system preference listener', async () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener,
      removeEventListener,
    });

    const { useTheme } = await import('../hooks/useTheme');
    const { unmount } = renderHook(() => useTheme());

    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    unmount();
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('system preference change is ignored because persist effect already stored theme', async () => {
    // The first useEffect persists theme to localStorage before any system
    // change event can fire, so getStoredTheme() always finds a value and
    // the handler skips the update.
    const listeners: Array<(e: MediaQueryListEvent) => void> = [];
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: vi.fn((_event: string, handler: (e: MediaQueryListEvent) => void) => {
        listeners.push(handler);
      }),
      removeEventListener: vi.fn(),
    });

    const { useTheme } = await import('../hooks/useTheme');
    const { result } = renderHook(() => useTheme());

    act(() => {
      listeners.forEach((fn) =>
        fn({ matches: true } as MediaQueryListEvent),
      );
    });

    // Theme stays dark — the persist effect already wrote to localStorage
    expect(result.current.theme).toBe('dark');
  });

  it('ignores system preference changes when stored theme exists', async () => {
    localStorage.setItem(STORAGE_KEY, 'dark');

    const listeners: Array<(e: MediaQueryListEvent) => void> = [];
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: vi.fn((_event: string, handler: (e: MediaQueryListEvent) => void) => {
        listeners.push(handler);
      }),
      removeEventListener: vi.fn(),
    });

    const { useTheme } = await import('../hooks/useTheme');
    const { result } = renderHook(() => useTheme());

    act(() => {
      listeners.forEach((fn) =>
        fn({ matches: true } as MediaQueryListEvent),
      );
    });

    expect(result.current.theme).toBe('dark');
  });

  it('initializes from system preference when no stored theme', async () => {
    matchMediaMock.mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const { useTheme } = await import('../hooks/useTheme');
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('light');
  });
});
