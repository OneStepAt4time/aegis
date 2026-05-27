import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock localStorage
const storage: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((k: string) => storage[k] ?? null),
  setItem: vi.fn((k: string, v: string) => { storage[k] = v; }),
  removeItem: vi.fn((k: string) => { delete storage[k]; }),
  clear: vi.fn(() => Object.keys(storage).forEach(k => delete storage[k])),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock matchMedia
function createMatchMedia(matches: boolean) {
  return vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('light') ? matches : !matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('useTheme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(storage).forEach(k => delete storage[k]);
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
    window.matchMedia = createMatchMedia(false); // system prefers dark
  });

  it('defaults to dark when no stored theme and system prefers dark', async () => {
    const { useTheme } = await import('../useTheme');
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolvedTheme).toBe('dark');
    expect(result.current.theme).toBe('dark');
  });

  it('reads stored theme from localStorage', async () => {
    storage['aegis-dashboard-theme'] = 'light';
    const { useTheme } = await import('../useTheme');
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolvedTheme).toBe('light');
  });

  it('resolves auto to system preference (dark)', async () => {
    storage['aegis-dashboard-theme'] = 'auto';
    window.matchMedia = createMatchMedia(false);
    const { useTheme } = await import('../useTheme');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('auto');
    expect(result.current.resolvedTheme).toBe('dark');
  });

  it('resolves auto to system preference (light)', async () => {
    storage['aegis-dashboard-theme'] = 'auto';
    window.matchMedia = createMatchMedia(true);
    const { useTheme } = await import('../useTheme');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('auto');
    expect(result.current.resolvedTheme).toBe('light');
  });

  it('toggleTheme switches dark → light', async () => {
    const { useTheme } = await import('../useTheme');
    const { result } = renderHook(() => useTheme());
    act(() => { result.current.toggleTheme(); });
    expect(result.current.theme).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
  });

  it('toggleTheme switches light → dark', async () => {
    storage['aegis-dashboard-theme'] = 'light';
    const { useTheme } = await import('../useTheme');
    const { result } = renderHook(() => useTheme());
    act(() => { result.current.toggleTheme(); });
    expect(result.current.theme).toBe('dark');
  });

  it('setTheme can set light-paper', async () => {
    const { useTheme } = await import('../useTheme');
    const { result } = renderHook(() => useTheme());
    act(() => { result.current.setTheme('light-paper'); });
    expect(result.current.theme).toBe('light-paper');
    expect(result.current.resolvedTheme).toBe('light-paper');
  });

  it('toggleTheme collapses light-paper to light then dark', async () => {
    storage['aegis-dashboard-theme'] = 'light-paper';
    const { useTheme } = await import('../useTheme');
    const { result } = renderHook(() => useTheme());
    // light-paper → toggle → dark (light-paper collapses to light, then toggles to dark)
    act(() => { result.current.toggleTheme(); });
    expect(result.current.theme).toBe('dark');
  });

  it('sets data-theme attribute on document', async () => {
    const { useTheme } = await import('../useTheme');
    renderHook(() => useTheme());
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('adds dark class when theme is dark', async () => {
    const { useTheme } = await import('../useTheme');
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes dark class when theme is light', async () => {
    storage['aegis-dashboard-theme'] = 'light';
    const { useTheme } = await import('../useTheme');
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('persists theme to localStorage', async () => {
    const { useTheme } = await import('../useTheme');
    const { result } = renderHook(() => useTheme());
    act(() => { result.current.setTheme('light-aaa'); });
    expect(localStorageMock.setItem).toHaveBeenCalledWith('aegis-dashboard-theme', 'light-aaa');
  });
});
