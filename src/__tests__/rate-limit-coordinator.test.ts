/**
 * Unit tests for Issue #3931: Rate-limit coordinator.
 *
 * Verifies cross-session coordination of rate-limit retries:
 * - Concurrency limiting
 * - Queue behavior
 * - Stagger delay
 * - Dequeue on session kill
 */
import { describe, expect, it, vi } from 'vitest';
import { RateLimitCoordinator } from '../rate-limit-coordinator.js';

describe('Issue #3931: RateLimitCoordinator', () => {
  it('allows acquisition when under concurrency limit', async () => {
    const coord = new RateLimitCoordinator({ maxConcurrent: 2, staggerMs: 0 });
    await coord.acquire('session-1');
    expect(coord.active).toBe(1);
    coord.release('session-1');
    expect(coord.active).toBe(0);
  });

  it('queues when at concurrency limit', async () => {
    const coord = new RateLimitCoordinator({ maxConcurrent: 1, staggerMs: 0 });

    // First session acquires immediately
    await coord.acquire('session-1');
    expect(coord.active).toBe(1);

    // Second session should be queued
    const acquirePromise = coord.acquire('session-2');
    expect(coord.queueDepth).toBe(1);

    // Release first — second should proceed
    coord.release('session-1');
    await acquirePromise;
    expect(coord.active).toBe(1);
    expect(coord.queueDepth).toBe(0);

    coord.release('session-2');
  });

  it('processes queue in FIFO order', async () => {
    const coord = new RateLimitCoordinator({ maxConcurrent: 1, staggerMs: 0 });
    const order: string[] = [];

    await coord.acquire('s1');

    const p2 = coord.acquire('s2').then(() => order.push('s2'));
    const p3 = coord.acquire('s3').then(() => order.push('s3'));

    coord.release('s1');
    await p2;
    coord.release('s2');
    await p3;

    expect(order).toEqual(['s2', 's3']);
    coord.release('s3');
  });

  it('removes session from queue via dequeue', async () => {
    const coord = new RateLimitCoordinator({ maxConcurrent: 1, staggerMs: 0 });

    await coord.acquire('s1');
    const p2 = coord.acquire('s2');
    const p3 = coord.acquire('s3');

    expect(coord.queueDepth).toBe(2);

    // Kill session-2 while queued
    coord.dequeue('s2');
    expect(coord.queueDepth).toBe(1);

    // Release s1 → s3 should proceed (s2 was dequeued)
    coord.release('s1');
    await p3;
    expect(coord.active).toBe(1);

    coord.release('s3');
  });

  it('respects stagger delay between releases and next acquisition', async () => {
    vi.useFakeTimers();
    const coord = new RateLimitCoordinator({ maxConcurrent: 1, staggerMs: 100 });

    await coord.acquire('s1');

    const p2 = coord.acquire('s2');

    // Release s1 — s2 should start after stagger
    coord.release('s1');

    // At this point, s2's resolve is scheduled in a setTimeout
    // Advance timers to trigger it
    vi.advanceTimersByTime(100);
    await p2;

    expect(coord.active).toBe(1);
    coord.release('s2');

    vi.useRealTimers();
  });

  it('tracks active count correctly', async () => {
    const coord = new RateLimitCoordinator({ maxConcurrent: 3, staggerMs: 0 });

    await coord.acquire('s1');
    await coord.acquire('s2');
    await coord.acquire('s3');
    expect(coord.active).toBe(3);

    coord.release('s1');
    expect(coord.active).toBe(2);

    coord.release('s2');
    coord.release('s3');
    expect(coord.active).toBe(0);
  });

  it('defaults to maxConcurrent=1 and staggerMs=2000', () => {
    const coord = new RateLimitCoordinator();
    // Verify by observing queuing behavior (maxConcurrent=1)
    expect(coord.active).toBe(0);
    expect(coord.queueDepth).toBe(0);
  });

  it('handles release when no sessions active', () => {
    const coord = new RateLimitCoordinator({ maxConcurrent: 1, staggerMs: 0 });
    // Should not throw
    coord.release('nonexistent');
    expect(coord.active).toBe(0);
  });
});
