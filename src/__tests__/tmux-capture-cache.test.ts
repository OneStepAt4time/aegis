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
});
