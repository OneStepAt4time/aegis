/**
 * tmux-capture-cache.ts — TTL + LRU cache for capture-pane results.
 *
 * Avoids redundant tmux capture-pane CLI calls when same window
 * is polled multiple times within a short window (e.g. monitor poll +
 * status check hitting the same pane).
 *
 * LRU eviction prevents unbounded growth from dead session entries.
 */

interface CacheEntry {
  text: string;
  at: number;
}

const DEFAULT_TTL_MS = 500;
const DEFAULT_MAX_ENTRIES = 100;

export class TmuxCaptureCache {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS, maxEntries: number = DEFAULT_MAX_ENTRIES) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  /** Evict oldest entries when cache exceeds maxEntries. */
  private evict(): void {
    while (this.cache.size > this.maxEntries) {
      // Map iterates in insertion order; first key is oldest
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }
  }

  /** Evict entries for sessions no longer in the active session set. */
  evictDeadSessions(activeSessionIds: Set<string>): void {
    for (const key of this.cache.keys()) {
      // Extract session ID from "sessionId:windowId" format
      const sessionId = key.split(':')[0];
      if (!activeSessionIds.has(sessionId)) {
        this.cache.delete(key);
      }
    }
  }

  /** Return cached capture-pane text if within TTL, otherwise call `captureFn` and cache. */
  async get(windowId: string, captureFn: () => Promise<string>): Promise<string> {
    const now = Date.now();
    const entry = this.cache.get(windowId);

    if (entry && now - entry.at < this.ttlMs) {
      // Move to end (most-recently-used) by re-inserting
      this.cache.delete(windowId);
      this.cache.set(windowId, entry);
      return entry.text;
    }

    const text = await captureFn();
    // Delete then re-insert to move to end (most-recently-used)
    this.cache.delete(windowId);
    this.cache.set(windowId, { text, at: now });
    this.evict();
    return text;
  }

  /** Invalidate a single window's cached result. */
  invalidate(windowId: string): void {
    this.cache.delete(windowId);
  }

  /** Remove all entries matching a session prefix. */
  invalidateSession(sessionPrefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(sessionPrefix)) {
        this.cache.delete(key);
      }
    }
  }

  /** Clear all cached entries. */
  clear(): void {
    this.cache.clear();
  }

  /** Current number of cached entries (useful for diagnostics). */
  get size(): number {
    return this.cache.size;
  }
}
