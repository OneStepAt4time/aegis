/**
 * tmux-capture-cache.test.ts — Tests for TmuxCaptureCache (#395).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TmuxCaptureCache } from '../tmux-capture-cache.js';

describe('TmuxCaptureCache', () => {
  let cache: TmuxCaptureCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new TmuxCaptureCache();
  });

  it('calls captureFn on first access', async () => {
    const fn = vi.fn(async () => 'pane-text');
    const result = await cache.get('win-1', fn);

    expect(result).toBe('pane-text');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns cached result within TTL', async () => {
    const fn = vi.fn(async () => 'pane-text');

    await cache.get('win-1', fn);
    const result = await cache.get('win-1', fn);

    expect(result).toBe('pane-text');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls captureFn again after TTL expires', async () => {
    const fn = vi.fn(async () => 'pane-text');

    await cache.get('win-1', fn);
    vi.advanceTimersByTime(501);
    await cache.get('win-1', fn);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('caches different windows independently', async () => {
    const fn1 = vi.fn(async () => 'text-a');
    const fn2 = vi.fn(async () => 'text-b');

    const a = await cache.get('win-1', fn1);
    const b = await cache.get('win-2', fn2);

    expect(a).toBe('text-a');
    expect(b).toBe('text-b');
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it('respects custom TTL', async () => {
    const customCache = new TmuxCaptureCache(1000);
    const fn = vi.fn(async () => 'pane-text');

    await customCache.get('win-1', fn);
    vi.advanceTimersByTime(500);
    await customCache.get('win-1', fn);

    expect(fn).toHaveBeenCalledTimes(1); // still within 1000ms TTL

    vi.advanceTimersByTime(501);
    await customCache.get('win-1', fn);

    expect(fn).toHaveBeenCalledTimes(2); // TTL expired
  });

  it('invalidate removes cached entry', async () => {
    const fn = vi.fn(async () => 'pane-text');

    await cache.get('win-1', fn);
    cache.invalidate('win-1');
    await cache.get('win-1', fn);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clear removes all cached entries', async () => {
    const fn = vi.fn(async () => 'pane-text');

    await cache.get('win-1', fn);
    await cache.get('win-2', fn);
    cache.clear();
    await cache.get('win-1', fn);
    await cache.get('win-2', fn);

    expect(fn).toHaveBeenCalledTimes(4);
  });

  describe('LRU eviction', () => {
    it('evicts oldest entries when maxEntries is exceeded', async () => {
      const smallCache = new TmuxCaptureCache(5000, 3);
      const fn = vi.fn(async (id: string) => `text-${id}`);

      await smallCache.get('win-1', () => fn('1'));
      await smallCache.get('win-2', () => fn('2'));
      await smallCache.get('win-3', () => fn('3'));
      // Adding 4th entry should evict win-1
      await smallCache.get('win-4', () => fn('4'));

      expect(smallCache.size).toBe(3);

      // win-1 should have been evicted (oldest)
      const fnRefresh = vi.fn(async () => 'refreshed');
      await smallCache.get('win-1', fnRefresh);
      expect(fnRefresh).toHaveBeenCalledTimes(1);
    });

    it('defaults maxEntries to 100', () => {
      const defaultCache = new TmuxCaptureCache();
      expect((defaultCache as any).maxEntries).toBe(100);
    });

    it('accessing an entry moves it to most-recent', async () => {
      const smallCache = new TmuxCaptureCache(5000, 3);
      const fn = vi.fn(async (id: string) => `text-${id}`);

      await smallCache.get('win-1', () => fn('1'));
      await smallCache.get('win-2', () => fn('2'));
      await smallCache.get('win-3', () => fn('3'));
      // Re-access win-1 to make it most-recent
      await smallCache.get('win-1', () => fn('1-refresh'));
      // Add new entry — should evict win-2 (now oldest), not win-1
      await smallCache.get('win-4', () => fn('4'));

      // win-1 should still be cached (not evicted)
      const fnCheck = vi.fn(async () => 'new');
      await smallCache.get('win-1', fnCheck);
      expect(fnCheck).toHaveBeenCalledTimes(0);
    });
  });

  describe('invalidateSession', () => {
    it('removes all entries with matching prefix', async () => {
      const fn = vi.fn(async () => 'text');
      await cache.get('session-abc/win-1', fn);
      await cache.get('session-abc/win-2', fn);
      await cache.get('session-xyz/win-1', fn);

      cache.invalidateSession('session-abc/');

      expect(cache.size).toBe(1);
      // session-xyz/win-1 should still be cached
      const fnCheck = vi.fn(async () => 'new');
      await cache.get('session-xyz/win-1', fnCheck);
      expect(fnCheck).toHaveBeenCalledTimes(0);
    });
  });

  it('size returns current cache count', async () => {
    const fn = vi.fn(async () => 'text');
    expect(cache.size).toBe(0);
    await cache.get('win-1', fn);
    expect(cache.size).toBe(1);
    await cache.get('win-2', fn);
    expect(cache.size).toBe(2);
  });
});
