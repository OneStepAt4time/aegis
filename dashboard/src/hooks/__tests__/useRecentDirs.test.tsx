import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecentDirs } from '../useRecentDirs';

describe('useRecentDirs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts with empty recent dirs', () => {
    const { result } = renderHook(() => useRecentDirs());
    expect(result.current.recent).toEqual([]);
    expect(result.current.starred).toEqual([]);
  });

  it('adds a directory', () => {
    const { result } = renderHook(() => useRecentDirs());
    act(() => { result.current.add('/home/user/project'); });
    expect(result.current.recent).toHaveLength(1);
    expect(result.current.recent[0].path).toBe('/home/user/project');
    expect(result.current.recent[0].starred).toBe(false);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useRecentDirs());
    act(() => { result.current.add('/test/dir'); });
    const stored = JSON.parse(localStorage.getItem('aegis:recent-dirs:v1')!);
    expect(stored).toHaveLength(1);
    expect(stored[0].path).toBe('/test/dir');
  });

  it('loads from localStorage on init', () => {
    localStorage.setItem('aegis:recent-dirs:v1', JSON.stringify([
      { path: '/existing', starred: false, lastUsed: 1000 },
    ]));
    const { result } = renderHook(() => useRecentDirs());
    expect(result.current.recent).toHaveLength(1);
    expect(result.current.recent[0].path).toBe('/existing');
  });

  it('toggles star on a directory', () => {
    const { result } = renderHook(() => useRecentDirs());
    act(() => { result.current.add('/star/me'); });
    act(() => { result.current.toggleStar('/star/me'); });
    expect(result.current.starred).toHaveLength(1);
    expect(result.current.recent[0].starred).toBe(true);
  });

  it('removes a directory', () => {
    const { result } = renderHook(() => useRecentDirs());
    act(() => { result.current.add('/remove/me'); });
    act(() => { result.current.remove('/remove/me'); });
    expect(result.current.recent).toEqual([]);
  });

  it('limits to 10 directories', () => {
    const { result } = renderHook(() => useRecentDirs());
    for (let i = 0; i < 15; i++) {
      act(() => { result.current.add(`/dir/${i}`); });
    }
    expect(result.current.recent).toHaveLength(10);
  });

  it('ignores empty paths', () => {
    const { result } = renderHook(() => useRecentDirs());
    act(() => { result.current.add('   '); });
    expect(result.current.recent).toEqual([]);
  });

  it('updates lastUsed when re-adding existing path', () => {
    const { result } = renderHook(() => useRecentDirs());
    act(() => { result.current.add('/path'); });
    const firstTime = result.current.recent[0].lastUsed;
    act(() => { result.current.add('/path'); });
    expect(result.current.recent).toHaveLength(1);
    expect(result.current.recent[0].lastUsed).toBeGreaterThanOrEqual(firstTime);
  });
});
