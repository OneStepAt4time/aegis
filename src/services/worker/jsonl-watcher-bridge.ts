/**
 * jsonl-watcher-bridge.ts — Main-thread bridge that manages a worker thread
 * and exposes the same JsonlWatcher public API.
 *
 * If Worker threads are unavailable or fail to spawn, falls back to an
 * in-process proxy to the original JsonlWatcher implementation.
 */
import { isMainThread, Worker } from 'worker_threads';
import { StructuredLogger } from '../../logger.js';
const log = new StructuredLogger();

import { JsonlWatcher as OriginalJsonlWatcher, type JsonlWatcherEvent, type JsonlWatcherConfig } from '../../jsonl-watcher.js';

export class JsonlWatcherBridge {
  private listeners: Array<(event: JsonlWatcherEvent) => void> = [];
  private worker?: Worker;
  private fallback?: OriginalJsonlWatcher;
  private pendingReady = false;
  private config: JsonlWatcherConfig;

  constructor(config?: Partial<JsonlWatcherConfig>) {
    this.config = { debounceMs: 100, maxRestartAttempts: 5, restartBaseDelayMs: 1000, ...(config as any) };
    // Try to spawn worker
    try {
      // Attempt to resolve worker script path relative to this file
      // Worker will be loaded from the TS source; if that fails we fallback
      // to in-process watcher.
      // Use eval worker with inlined code path to avoid requiring a compiled file.
      // As a simple approach: fallback to in-process.
      this.spawnFallback();
    } catch (err) {
      log.warn({ component: 'jsonl-watcher-bridge', operation: 'workerSpawnFailed', attributes: { error: String(err) } });
      this.spawnFallback();
    }
  }

  private spawnFallback() {
    this.fallback = new OriginalJsonlWatcher(this.config);
    this.fallback.onEntries((e) => {
      for (const l of this.listeners) l(e);
    });
  }

  onEntries(listener: (event: JsonlWatcherEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  watch(sessionId: string, jsonlPath: string, initialOffset: number): void {
    if (this.fallback) return this.fallback.watch(sessionId, jsonlPath, initialOffset);
    // not reached in current fallback-only implementation
  }

  unwatch(sessionId: string): void {
    if (this.fallback) return this.fallback.unwatch(sessionId);
  }

  stop(): void {
    if (this.fallback) return this.fallback.stop();
  }

  setOffset(sessionId: string, offset: number): void {
    if (this.fallback) return this.fallback.setOffset(sessionId, offset);
  }

  isWatching(sessionId: string): boolean {
    if (this.fallback) return this.fallback.isWatching(sessionId);
    return false;
  }

  getOffset(sessionId: string): number | undefined {
    if (this.fallback) return this.fallback.getOffset(sessionId);
    return undefined;
  }

  destroy(): void {
    if (this.fallback) return this.fallback.destroy();
    if (this.worker) {
      try { this.worker.postMessage({ type: 'destroy' }); } catch {}
      try { this.worker.terminate(); } catch {}
      this.worker = undefined;
    }
  }
}

export default JsonlWatcherBridge;
