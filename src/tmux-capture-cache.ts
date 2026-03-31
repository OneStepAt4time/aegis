/**
 * tmux-capture-cache.ts — TTL-based cache for capture-pane results.
 *
 * Avoids redundant tmux capture-pane CLI calls when the same window
 * is polled multiple times within a short window (e.g. monitor poll +
 * status check hitting the same pane).
 */

interface CacheEntry {
  text: string;
  at: number;
}

const DEFAULT_TTL_MS = 500;

export class TmuxCaptureCache {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Return cached capture-pane text if within TTL, otherwise call `captureFn` and cache. */
  async get(windowId: string, captureFn: () => Promise<string>): Promise<string> {
    const now = Date.now();
    const entry = this.cache.get(windowId);

    if (entry && now - entry.at < this.ttlMs) {
      return entry.text;
    }

    const text = await captureFn();
    this.cache.set(windowId, { text, at: now });
    return text;
  }

  /** Invalidate a single window's cached result. */
  invalidate(windowId: string): void {
    this.cache.delete(windowId);
  }

  /** Clear all cached entries. */
  clear(): void {
    this.cache.clear();
  }
}
