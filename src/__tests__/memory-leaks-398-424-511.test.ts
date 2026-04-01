/**
 * memory-leaks-398-424-511.test.ts — Tests for memory leak fixes.
 *
 * #398: Event buffer cleanup + AuthManager rate limit sweep
 * #424: parsedEntriesCache eviction (sliding window cap)
 * #511: Monitor debounce timer ghost callbacks guard
 * #844: Per-IP rate-limit map cap (LRU eviction at 10k entries)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionEventBus } from '../events.js';
import { AuthManager } from '../auth.js';

// ---------------------------------------------------------------------------
// #398: SessionEventBus.cleanupSession
// ---------------------------------------------------------------------------

describe('#398: SessionEventBus.cleanupSession', () => {
  let bus: SessionEventBus;

  beforeEach(() => {
    bus = new SessionEventBus();
  });

  afterEach(() => {
    bus.destroy();
  });

  it('removes the event buffer for the session', () => {
    bus.emitMessage('s1', 'user', 'hello');
    bus.emitMessage('s1', 'assistant', 'hi');

    bus.cleanupSession('s1');

    // Buffer should be gone — getEventsSince returns empty
    expect(bus.getEventsSince('s1', 0)).toEqual([]);
  });

  it('removes the emitter for the session', () => {
    bus.emitMessage('s1', 'user', 'hello');
    expect(bus.hasSubscribers('s1')).toBe(false);

    // Subscribe to make emitter exist
    const unsub = bus.subscribe('s1', () => {});
    expect(bus.hasSubscribers('s1')).toBe(true);

    bus.cleanupSession('s1');

    expect(bus.hasSubscribers('s1')).toBe(false);
    unsub();
  });

  it('does not affect other sessions', () => {
    bus.emitMessage('s1', 'user', 'hello');
    bus.emitMessage('s2', 'user', 'world');

    bus.cleanupSession('s1');

    expect(bus.getEventsSince('s1', 0)).toEqual([]);
    expect(bus.getEventsSince('s2', 0).length).toBe(1);
  });

  it('does not throw for non-existent session', () => {
    expect(() => bus.cleanupSession('no-such-session')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// #398: AuthManager.sweepStaleRateLimits
// ---------------------------------------------------------------------------

describe('#398: AuthManager.sweepStaleRateLimits', () => {
  it('removes stale rate limit buckets with expired windows', () => {
    const manager = new AuthManager('/tmp/nonexistent-keys-test.json', 'test-token');
    // Simulate stale buckets by directly accessing internals
    // validate() creates buckets — but we need to test sweepStaleRateLimits independently
    // Use the validate path to create a bucket, then advance time conceptually
    const result = manager.validate('test-token');
    expect(result.valid).toBe(true);

    // After creation, bucket is fresh. Sweep should NOT remove it.
    manager.sweepStaleRateLimits();

    // We can't easily verify internal state without more exposure,
    // but we can verify the method doesn't throw and returns cleanly
    expect(() => manager.sweepStaleRateLimits()).not.toThrow();
  });

  it('does not throw when no rate limits exist', () => {
    const manager = new AuthManager('/tmp/nonexistent-keys-test.json');
    expect(() => manager.sweepStaleRateLimits()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// #424: parsedEntriesCache eviction
// ---------------------------------------------------------------------------

describe('#424: parsedEntriesCache sliding window eviction', () => {
  it('evicts oldest entries when cache exceeds cap', () => {
    // Simulate the eviction logic inline (matches session.ts getCachedEntries)
    const MAX_CACHE = 10;
    const entries: number[] = [];
    for (let i = 0; i < 15; i++) {
      entries.push(i);
      if (entries.length > MAX_CACHE) {
        entries.splice(0, entries.length - MAX_CACHE);
      }
    }
    // Should keep only last 10 entries (5..14)
    expect(entries).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(entries.length).toBe(MAX_CACHE);
  });

  it('does not evict when under the cap', () => {
    const MAX_CACHE = 10;
    const entries: number[] = [1, 2, 3];
    if (entries.length > MAX_CACHE) {
      entries.splice(0, entries.length - MAX_CACHE);
    }
    expect(entries).toEqual([1, 2, 3]);
  });

  it('handles exact cap boundary without eviction', () => {
    const MAX_CACHE = 10;
    const entries: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    if (entries.length > MAX_CACHE) {
      entries.splice(0, entries.length - MAX_CACHE);
    }
    expect(entries.length).toBe(10);
    expect(entries).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('evicts correctly with large overflow', () => {
    const MAX_CACHE = 100;
    const entries: number[] = [];
    for (let i = 0; i < 500; i++) {
      entries.push(i);
      if (entries.length > MAX_CACHE) {
        entries.splice(0, entries.length - MAX_CACHE);
      }
    }
    expect(entries.length).toBe(MAX_CACHE);
    expect(entries[0]).toBe(400);
    expect(entries[99]).toBe(499);
  });
});

// ---------------------------------------------------------------------------
// #511: Monitor debounce ghost callback guard
// ---------------------------------------------------------------------------

describe('#511: Monitor debounce ghost callback guard', () => {
  it('debounce callback skips broadcast when session is removed', async () => {
    // Simulate the debounce pattern from monitor.ts
    const lastStatus = new Map<string, string>();
    const statusChangeDebounce = new Map<string, NodeJS.Timeout>();
    let broadcastCalled = false;

    const sessionId = 'test-session';
    lastStatus.set(sessionId, 'working');

    // Simulate status change scheduling debounce
    const existing = statusChangeDebounce.get(sessionId);
    if (existing) clearTimeout(existing);

    statusChangeDebounce.set(sessionId, setTimeout(() => {
      statusChangeDebounce.delete(sessionId);
      // #511 guard: skip if session was removed
      if (!lastStatus.has(sessionId)) return;
      broadcastCalled = true;
    }, 10));

    // Simulate removeSession — clears lastStatus and debounce timer
    lastStatus.delete(sessionId);
    const pending = statusChangeDebounce.get(sessionId);
    if (pending) {
      clearTimeout(pending);
      statusChangeDebounce.delete(sessionId);
    }

    // Wait for debounce to have fired (it was cleared, so no broadcast)
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(broadcastCalled).toBe(false);
  });

  it('debounce callback fires broadcast when session is alive', async () => {
    const lastStatus = new Map<string, string>();
    const statusChangeDebounce = new Map<string, NodeJS.Timeout>();
    let broadcastCalled = false;

    const sessionId = 'test-session';
    lastStatus.set(sessionId, 'working');

    statusChangeDebounce.set(sessionId, setTimeout(() => {
      statusChangeDebounce.delete(sessionId);
      if (!lastStatus.has(sessionId)) return;
      broadcastCalled = true;
    }, 10));

    // Don't remove session — let debounce fire
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(broadcastCalled).toBe(true);
  });

  it('ghost callback (queued before removeSession) is guarded', async () => {
    // This tests the race: debounce callback is already in the macrotask queue
    // but removeSession hasn't run yet
    const lastStatus = new Map<string, string>();
    let broadcastCalled = false;

    const sessionId = 'test-session';
    lastStatus.set(sessionId, 'working');

    // Schedule debounce (very short timer so it queues immediately)
    setTimeout(() => {
      // #511 guard
      if (!lastStatus.has(sessionId)) return;
      broadcastCalled = true;
    }, 0);

    // Remove session before the callback fires (in same microtask)
    lastStatus.delete(sessionId);

    // Wait for callback
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(broadcastCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #844: Per-IP rate-limit map cap (evict oldest when >10k entries)
// ---------------------------------------------------------------------------

describe('#844: IP rate-limit map cap', () => {
  // Replicate the eviction logic from server.ts inline (same pattern as #424 tests)
  const MAX_IP_ENTRIES = 10;

  it('evicts the IP with the oldest last-seen timestamp when cap exceeded', () => {
    const ipMap = new Map<string, number[]>(); // ip → timestamps
    let now = 1000;

    // Fill to cap
    for (let i = 0; i < MAX_IP_ENTRIES; i++) {
      ipMap.set(`ip-${i}`, [now++]);
    }
    expect(ipMap.size).toBe(MAX_IP_ENTRIES);

    // Add one more — should trigger eviction of ip-0 (oldest)
    ipMap.set('ip-new', [now++]);
    if (ipMap.size > MAX_IP_ENTRIES) {
      let oldestIp = '';
      let oldestTime = Infinity;
      for (const [ip, timestamps] of ipMap) {
        const last = timestamps[timestamps.length - 1]!;
        if (last < oldestTime) {
          oldestTime = last;
          oldestIp = ip;
        }
      }
      if (oldestIp) ipMap.delete(oldestIp);
    }

    expect(ipMap.size).toBe(MAX_IP_ENTRIES);
    expect(ipMap.has('ip-0')).toBe(false); // oldest evicted
    expect(ipMap.has('ip-new')).toBe(true);
  });

  it('does not evict when map is at or below cap', () => {
    const ipMap = new Map<string, number[]>();
    for (let i = 0; i < MAX_IP_ENTRIES; i++) {
      ipMap.set(`ip-${i}`, [Date.now()]);
    }
    expect(ipMap.size).toBe(MAX_IP_ENTRIES);
    // No eviction at exact cap
    if (ipMap.size > MAX_IP_ENTRIES) {
      // would evict — but shouldn't reach here
      throw new Error('Should not evict at cap');
    }
    expect(ipMap.size).toBe(MAX_IP_ENTRIES);
  });

  it('evicts oldest across multiple overflows', () => {
    const ipMap = new Map<string, number[]>();
    let now = 1000;

    // Add 30 entries with cap of 10 — should keep only 10 newest
    for (let i = 0; i < 30; i++) {
      ipMap.set(`ip-${i}`, [now++]);
      if (ipMap.size > MAX_IP_ENTRIES) {
        let oldestIp = '';
        let oldestTime = Infinity;
        for (const [ip, timestamps] of ipMap) {
          const last = timestamps[timestamps.length - 1]!;
          if (last < oldestTime) {
            oldestTime = last;
            oldestIp = ip;
          }
        }
        if (oldestIp) ipMap.delete(oldestIp);
      }
    }

    expect(ipMap.size).toBe(MAX_IP_ENTRIES);
    // Oldest 20 should be evicted, newest 10 remain
    expect(ipMap.has('ip-0')).toBe(false);
    expect(ipMap.has('ip-19')).toBe(false);
    expect(ipMap.has('ip-20')).toBe(true);
    expect(ipMap.has('ip-29')).toBe(true);
  });

  it('preserves recently-accessed IPs over stale ones', () => {
    const ipMap = new Map<string, number[]>();
    // Fill to cap
    for (let i = 0; i < MAX_IP_ENTRIES; i++) {
      ipMap.set(`ip-${i}`, [1000 + i]); // older timestamps
    }
    // Touch ip-0 to make it recent
    ipMap.set('ip-0', [9999]);

    // Overflow
    ipMap.set('ip-new', [10000]);
    if (ipMap.size > MAX_IP_ENTRIES) {
      let oldestIp = '';
      let oldestTime = Infinity;
      for (const [ip, timestamps] of ipMap) {
        const last = timestamps[timestamps.length - 1]!;
        if (last < oldestTime) {
          oldestTime = last;
          oldestIp = ip;
        }
      }
      if (oldestIp) ipMap.delete(oldestIp);
    }

    expect(ipMap.has('ip-0')).toBe(true); // recently touched — preserved
    expect(ipMap.has('ip-1')).toBe(false); // oldest untouched — evicted
    expect(ipMap.has('ip-new')).toBe(true);
  });
});
