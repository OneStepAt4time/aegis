/**
 * jsonl-watcher-bridge.ts — Main-thread bridge for JSONL worker.
 *
 * Spawns a worker_threads Worker that runs jsonl-watcher-worker.ts.
 * Implements the same public API as JsonlWatcher so it can be used as a
 * drop-in replacement.
 *
 * Issue #4230: Worker offloads JSONL parsing from the main event loop.
 */

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { StructuredLogger } from '../../logger.js';
import type { ParsedEntry, TokenUsageDelta } from '../../transcript.js';
import type { EventBus } from '../../event-bus.js';
import type {
  WorkerCommand,
  WorkerResponse,
} from './jsonl-watcher-worker.js';

const log = new StructuredLogger();

// ── Public types (re-exported for compatibility with JsonlWatcher) ───────────

export interface JsonlWatcherBridgeEvent {
  sessionId: string;
  messages: ParsedEntry[];
  newOffset: number;
  truncated: boolean;
  tokenUsageDelta: TokenUsageDelta;
}

export interface JsonlWatcherBridgeConfig {
  debounceMs?: number;
  maxRestartAttempts?: number;
  restartBaseDelayMs?: number;
  /** Optional EventBus to publish session.lineParsed events. */
  eventBus?: EventBus;
}

// ── Bridge ───────────────────────────────────────────────────────────────────

export class JsonlWatcherBridge {
  private worker: Worker | null = null;
  private listeners = new Array<(event: JsonlWatcherBridgeEvent) => void>();
  private config: JsonlWatcherBridgeConfig;
  private offsets = new Map<string, number>();
  private destroyed = false;

  constructor(config?: JsonlWatcherBridgeConfig) {
    this.config = config ?? {};
    this.initWorker();
  }

  private initWorker(): void {
    const workerFile = join(
      dirname(fileURLToPath(import.meta.url)),
      'jsonl-watcher-worker.js',
    );

    this.worker = new Worker(workerFile, {
      workerData: {
        config: {
          debounceMs: this.config.debounceMs,
          maxRestartAttempts: this.config.maxRestartAttempts,
          restartBaseDelayMs: this.config.restartBaseDelayMs,
        },
      },
    });

    this.worker.on('message', (msg: WorkerResponse) => {
      if (msg.type === 'entries') {
        // Track offset
        this.offsets.set(msg.sessionId, msg.newOffset);

        const event: JsonlWatcherBridgeEvent = {
          sessionId: msg.sessionId,
          messages: msg.messages,
          newOffset: msg.newOffset,
          truncated: msg.truncated,
          tokenUsageDelta: msg.tokenUsageDelta,
        };

        // Publish to EventBus if configured
        if (this.config.eventBus) {
          this.config.eventBus.publish(
            `session:${msg.sessionId}`,
            'session.lineParsed',
            {
              messages: msg.messages.length,
              newOffset: msg.newOffset,
              truncated: msg.truncated,
            },
          );
        }

        // Notify local listeners
        for (const listener of this.listeners) {
          listener(event);
        }
      } else if (msg.type === 'error') {
        log.error({
          component: 'jsonl-watcher-bridge',
          operation: 'workerError',
          attributes: { sessionId: msg.sessionId, error: msg.error },
        });
      }
    });

    this.worker.on('error', (err) => {
      log.error({
        component: 'jsonl-watcher-bridge',
        operation: 'workerThreadError',
        attributes: { error: String(err) },
      });
    });
  }

  private send(cmd: WorkerCommand): void {
    if (!this.worker || this.destroyed) return;
    this.worker.postMessage(cmd);
  }

  /** Register a callback for new entries. */
  onEntries(listener: (event: JsonlWatcherBridgeEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /** Start watching a JSONL file for a session. */
  watch(sessionId: string, jsonlPath: string, initialOffset: number): void {
    this.offsets.set(sessionId, initialOffset);
    this.send({ type: 'watch', sessionId, jsonlPath, initialOffset });
  }

  /** Stop watching a session's JSONL file. */
  unwatch(sessionId: string): void {
    this.send({ type: 'unwatch', sessionId });
    this.offsets.delete(sessionId);
  }

  /** Stop watching all sessions. */
  stop(): void {
    this.send({ type: 'destroy' });
    this.offsets.clear();
  }

  /** Update the offset for a session. */
  setOffset(sessionId: string, offset: number): void {
    this.offsets.set(sessionId, offset);
    this.send({ type: 'setOffset', sessionId, offset });
  }

  /** Check if a session is being watched. */
  isWatching(sessionId: string): boolean {
    return this.offsets.has(sessionId);
  }

  /** Get the current offset for a watched session. */
  getOffset(sessionId: string): number | undefined {
    return this.offsets.get(sessionId);
  }

  /** Stop all watchers and terminate the worker. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.send({ type: 'destroy' });
    this.worker?.terminate().catch(() => {});
    this.worker = null;
    this.listeners.length = 0;
    this.offsets.clear();
  }
}
