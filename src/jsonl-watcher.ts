/**
 * jsonl-watcher.ts — fs.watch()-based JSONL file watcher.
 *
 * Replaces polling-based JSONL reading in the monitor with near-instant
 * file change detection. Uses fs.watch() with debouncing to avoid
 * duplicate events from rapid writes.
 *
 * Issue #84: Replace JSONL polling with fs.watch.
 * Issue #1420: Auto-restart watcher on fs.watch errors with exponential backoff.
 */

import { watch, type FSWatcher } from 'node:fs';
import { existsSync } from 'node:fs';
import { readNewEntries, extractTokenDelta, type ParsedEntry, type TokenUsageDelta } from './transcript.js';

export interface JsonlWatcherEvent {
  sessionId: string;
  messages: ParsedEntry[];
  newOffset: number;
  /** True if the file was truncated (e.g. after /clear). */
  truncated: boolean;
  /** Issue #488: Aggregated token usage delta from this batch of entries. */
  tokenUsageDelta: TokenUsageDelta;
}

export interface JsonlWatcherConfig {
  /** Debounce interval in ms to coalesce rapid writes (default: 100). */
  debounceMs: number;
  /** Maximum number of restart attempts before giving up (default: 5). */
  maxRestartAttempts: number;
  /** Base delay in ms for exponential backoff on restart (default: 1000). */
  restartBaseDelayMs: number;
}

const DEFAULT_CONFIG: JsonlWatcherConfig = {
  debounceMs: 100,
  maxRestartAttempts: 5,
  restartBaseDelayMs: 1000,
};

/** Watch state for a single JSONL file. */
interface WatchEntry {
  sessionId: string;
  jsonlPath: string;
  fsWatcher: FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  /** Current byte offset — updated after each read. */
  offset: number;
  /** Issue #1420: Consecutive restart attempt count for exponential backoff. */
  restartAttempts: number;
  /** Issue #1420: Pending restart timer handle. */
  restartTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Watches JSONL files for changes and emits parsed entries.
 *
 * Usage:
 *   const watcher = new JsonlWatcher();
 *   watcher.onEntries((event) => { ... });
 *   watcher.watch('session-123', '/path/to/session.jsonl', 0);
 *   watcher.unwatch('session-123');
 *   watcher.destroy();
 */
export class JsonlWatcher {
  private entries = new Map<string, WatchEntry>();
  private listeners = new Array<(event: JsonlWatcherEvent) => void>();
  private config: JsonlWatcherConfig;

  constructor(config?: Partial<JsonlWatcherConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register a callback for new entries. */
  onEntries(listener: (event: JsonlWatcherEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /** Start watching a JSONL file for a session.
   *  @param initialOffset - byte offset to start reading from (usually 0 or current session.monitorOffset).
   */
  watch(sessionId: string, jsonlPath: string, initialOffset: number): void {
    // Issue #846: Clear stale timer before re-watching to prevent
    // old timer closures from operating on stale entry data.
    if (this.entries.has(sessionId)) {
      const oldEntry = this.entries.get(sessionId)!;
      if (oldEntry.debounceTimer) {
        clearTimeout(oldEntry.debounceTimer);
        oldEntry.debounceTimer = null;
      }
      oldEntry.fsWatcher.close();
      this.entries.delete(sessionId);
    }

    if (!existsSync(jsonlPath)) return;

    const fsWatcher = watch(jsonlPath, (eventType) => {
      // 'rename' can mean file was deleted or replaced — check if it still exists
      if (eventType === 'rename') {
        if (!existsSync(jsonlPath)) {
          // File deleted — session likely ended, stop watching
          this.unwatch(sessionId);
          return;
        }
        // File was replaced (e.g. rotated) — re-read from current offset
        this.scheduleRead(sessionId);
        return;
      }

      // 'change' — new data written
      this.scheduleRead(sessionId);
    });

    fsWatcher.on('error', (err) => {
      console.error(`JsonlWatcher: error watching ${jsonlPath}:`, err.message);
      // Issue #1420: Attempt restart with exponential backoff instead of giving up.
      this.scheduleRestart(sessionId);
    });

    this.entries.set(sessionId, {
      sessionId,
      jsonlPath,
      fsWatcher,
      debounceTimer: null,
      offset: initialOffset,
      restartAttempts: 0,
      restartTimer: null,
    });
  }

  /** Stop watching a session's JSONL file. */
  unwatch(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;

    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
    }
    if (entry.restartTimer) {
      clearTimeout(entry.restartTimer);
    }
    entry.fsWatcher.close();
    this.entries.delete(sessionId);
  }

  /** Stop watching all sessions and release resources. */
  stop(): void {
    for (const [sessionId, entry] of this.entries) {
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
      }
      if (entry.restartTimer) {
        clearTimeout(entry.restartTimer);
      }
      entry.fsWatcher.close();
    }
    this.entries.clear();
    this.listeners.length = 0;
  }

  /** Update the offset for a session (e.g. after manual read during discovery). */
  setOffset(sessionId: string, offset: number): void {
    const entry = this.entries.get(sessionId);
    if (entry) {
      entry.offset = offset;
    }
  }

  /** Check if a session is being watched. */
  isWatching(sessionId: string): boolean {
    return this.entries.has(sessionId);
  }

  /** Get the current offset for a watched session. */
  getOffset(sessionId: string): number | undefined {
    return this.entries.get(sessionId)?.offset;
  }

  /** Stop all watchers and clean up. */
  destroy(): void {
    for (const sessionId of this.entries.keys()) {
      this.unwatch(sessionId);
    }
    this.listeners.length = 0;
  }

  /** Issue #1420: Schedule a restart with exponential backoff after an fs.watch error. */
  private scheduleRestart(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;

    if (entry.restartAttempts >= this.config.maxRestartAttempts) {
      console.error(
        `JsonlWatcher: max restart attempts (${this.config.maxRestartAttempts}) reached for ${entry.jsonlPath}, giving up`,
      );
      this.unwatch(sessionId);
      return;
    }

    const delay = this.config.restartBaseDelayMs * Math.pow(2, entry.restartAttempts);
    entry.restartAttempts++;

    console.error(
      `JsonlWatcher: scheduling restart attempt ${entry.restartAttempts}/${this.config.maxRestartAttempts} for ${entry.jsonlPath} in ${delay}ms`,
    );

    entry.restartTimer = setTimeout(() => {
      entry.restartTimer = null;
      const currentOffset = entry.offset;
      // Close the broken watcher first, then re-watch from saved offset
      entry.fsWatcher.close();
      this.entries.delete(sessionId);
      this.watch(sessionId, entry.jsonlPath, currentOffset);
      // Preserve restart counter across the re-watch
      const newEntry = this.entries.get(sessionId);
      if (newEntry) {
        newEntry.restartAttempts = entry.restartAttempts;
      }
    }, delay);
  }

  /** Schedule a debounced read for a session. */
  private scheduleRead(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;

    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
    }

    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null;
      void this.readAndEmit(entry);
    }, this.config.debounceMs);
  }

  /** Read new bytes from the JSONL file and emit entries. */
  private async readAndEmit(entry: WatchEntry): Promise<void> {
    // Session may have been removed during debounce
    if (!this.entries.has(entry.sessionId)) return;
    if (!existsSync(entry.jsonlPath)) {
      this.unwatch(entry.sessionId);
      return;
    }

    try {
      const previousOffset = entry.offset;
      const result = await readNewEntries(entry.jsonlPath, previousOffset);
      entry.offset = result.newOffset;

      if (result.entries.length > 0 || result.newOffset < previousOffset) {
        // Detect truncation: newOffset went backwards
        const truncated = result.newOffset < previousOffset;

        // Emit to all listeners
        const event: JsonlWatcherEvent = {
          sessionId: entry.sessionId,
          messages: result.entries,
          newOffset: result.newOffset,
          truncated,
          tokenUsageDelta: extractTokenDelta(result.raw),
        };

        for (const listener of this.listeners) {
          listener(event);
        }
      }
    } catch {
      // File may be temporarily unavailable — ignore
    }
  }
}
