/**
 * rate-limit-coordinator.ts — Cross-session rate-limit coordination.
 *
 * Issue #3931: When multiple sessions hit the CC rate limit independently,
 * their retries fire concurrently and amplify the problem. This coordinator
 * serializes rate-limit retries across sessions with a configurable
 * concurrency cap and stagger delay.
 *
 * Usage: the monitor calls `acquire()` before starting a rate-limit retry.
 * If the concurrency cap is reached, the session queues until a slot opens.
 */

import { logger } from './logger.js';

export interface RateLimitCoordinatorOptions {
  /** Max concurrent rate-limit retries across all sessions (default: 1). */
  maxConcurrent?: number;
  /** Minimum stagger delay between consecutive retry starts in ms (default: 2000). */
  staggerMs?: number;
}

interface QueueEntry {
  sessionId: string;
  resolve: () => void;
}

const DEFAULT_MAX_CONCURRENT = 1;
const DEFAULT_STAGGER_MS = 2_000;

export class RateLimitCoordinator {
  private readonly maxConcurrent: number;
  private readonly staggerMs: number;
  private activeCount = 0;
  private lastReleaseAt = 0;
  private queue: QueueEntry[] = [];

  constructor(options: RateLimitCoordinatorOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.staggerMs = options.staggerMs ?? DEFAULT_STAGGER_MS;
  }

  /**
   * Acquire a rate-limit retry slot. Returns when a slot is available.
   * If the concurrency cap is reached, queues until a slot opens.
   * Includes stagger delay so retries don't all fire simultaneously.
   */
  async acquire(sessionId: string): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      logger.info({
        component: 'rate-limit-coordinator',
        operation: 'acquire',
        sessionId,
        attributes: { activeCount: this.activeCount, maxConcurrent: this.maxConcurrent },
      });
      return;
    }

    // Queue the session
    logger.info({
      component: 'rate-limit-coordinator',
      operation: 'queued',
      sessionId,
      attributes: { queueDepth: this.queue.length, activeCount: this.activeCount },
    });

    return new Promise<void>((resolve) => {
      this.queue.push({ sessionId, resolve });
    });
  }

  /**
   * Release a rate-limit retry slot. Triggers the next queued session
   * after the stagger delay.
   */
  release(sessionId: string): void {
    if (this.activeCount > 0) {
      this.activeCount--;
    }
    this.lastReleaseAt = Date.now();

    logger.info({
      component: 'rate-limit-coordinator',
      operation: 'release',
      sessionId,
      attributes: { activeCount: this.activeCount, queueDepth: this.queue.length },
    });

    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      // Stagger: wait at least staggerMs from the last release
      const elapsed = Date.now() - this.lastReleaseAt;
      const waitMs = Math.max(0, this.staggerMs - elapsed);
      setTimeout(() => {
        this.activeCount++;
        next.resolve();
        logger.info({
          component: 'rate-limit-coordinator',
          operation: 'dequeue',
          sessionId: next.sessionId,
          attributes: { activeCount: this.activeCount, waitedMs: waitMs },
        });
      }, waitMs);
    }
  }

  /** Get current queue depth (for diagnostics/metrics). */
  get queueDepth(): number {
    return this.queue.length;
  }

  /** Get number of active retry slots in use. */
  get active(): number {
    return this.activeCount;
  }

  /** Remove a session from the queue (e.g. if session is killed while waiting). */
  dequeue(sessionId: string): void {
    const idx = this.queue.findIndex(e => e.sessionId === sessionId);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
    }
  }
}
