/**
 * redis-state-store.test.ts — Unit tests for RedisStateStore.
 *
 * Uses an in-memory mock of the Redis client so tests run without
 * a real Redis instance.
 *
 * Issue #1948: Horizontal scaling with Redis-backed state.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RedisStateStore } from '../services/state/RedisStateStore.js';
import type { SerializedSessionInfo } from '../services/state/state-store.js';
import type { UIState } from '../terminal-parser.js';

// ── In-memory mock Redis client ────────────────────────────────────────

function createMockRedis() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  let connected = false;

  return {
    store,
    sets,
    async connect() {
      connected = true;
    },
    async disconnect() {
      connected = false;
    },
    get isReady() {
      return connected;
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
      return 'OK';
    },
    async del(keys: string | string[]) {
      const arr = Array.isArray(keys) ? keys : [keys];
      let count = 0;
      for (const k of arr) {
        if (store.delete(k)) count++;
        // Also clean up hash-style entries stored as "key:field"
        for (const mapKey of [...store.keys()]) {
          if (mapKey === k || mapKey.startsWith(`${k}:`)) {
            store.delete(mapKey);
          }
        }
        sets.delete(k);
      }
      return count;
    },
    async sadd(key: string, ...members: string[]) {
      if (!sets.has(key)) sets.set(key, new Set());
      const s = sets.get(key)!;
      let added = 0;
      for (const m of members) {
        if (!s.has(m)) {
          s.add(m);
          added++;
        }
      }
      return added;
    },
    async srem(key: string, ...members: string[]) {
      const s = sets.get(key);
      if (!s) return 0;
      let removed = 0;
      for (const m of members) {
        if (s.delete(m)) removed++;
      }
      return removed;
    },
    async smembers(key: string) {
      const s = sets.get(key);
      return s ? [...s] : [];
    },
    async hget(key: string, field: string) {
      return store.get(`${key}:${field}`);
    },
    async hset(key: string, field: string, value: string) {
      store.set(`${key}:${field}`, value);
      return 1;
    },
    async hdel(key: string, ...fields: string[]) {
      let count = 0;
      for (const f of fields) {
        if (store.delete(`${key}:${f}`)) count++;
      }
      return count;
    },
    async ping() {
      if (!connected) throw new Error('Redis is not connected');
      return 'PONG';
    },
    on(event: 'error' | 'ready', _handler: ((err: Error) => void) | (() => void)) {
      return this;
    },
    multi() {
      const ops: Array<() => unknown> = [];
      const pipeline = {
        hset(key: string, field: string, value: string) {
          ops.push(() => { store.set(`${key}:${field}`, value); return 1; });
          return pipeline;
        },
        sadd(key: string, ...members: string[]) {
          ops.push(() => {
            if (!sets.has(key)) sets.set(key, new Set());
            const s = sets.get(key)!;
            for (const m of members) s.add(m);
            return Promise.resolve(members.length);
          });
          return pipeline;
        },
        srem(key: string, ...members: string[]) {
          ops.push(() => {
            const s = sets.get(key);
            if (s) for (const m of members) s.delete(m);
            return Promise.resolve(members.length);
          });
          return pipeline;
        },
        del(keys: string | string[]) {
          const arr = Array.isArray(keys) ? keys : [keys];
          ops.push(async () => {
            let count = 0;
            for (const k of arr) {
              if (store.delete(k)) count++;
              for (const mapKey of [...store.keys()]) {
                if (mapKey === k || mapKey.startsWith(`${k}:`)) {
                  store.delete(mapKey);
                }
              }
              sets.delete(k);
            }
            return count;
          });
          return pipeline;
        },
        async exec() {
          const results: unknown[] = [];
          for (const op of ops) {
            results.push(await op());
          }
          return results;
        },
      };
      return pipeline;
    },
  };
}

function makeSession(overrides: Partial<SerializedSessionInfo> = {}): SerializedSessionInfo {
  return {
    id: 'test-session-1',
    windowId: '@1',
    windowName: 'test',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle' as UIState,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 120_000,
    permissionStallMs: 60_000,
    permissionMode: 'bypassPermissions',
    ...overrides,
  };
}

describe('RedisStateStore', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let store: RedisStateStore;

  beforeEach(() => {
    redis = createMockRedis();
    store = new RedisStateStore(redis, { keyPrefix: 'aegis' });
  });

  // ── Lifecycle ─────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('connects on start and disconnects on stop', async () => {
      await store.start();
      expect(redis.isReady).toBe(true);

      await store.stop(new AbortController().signal);
      expect(redis.isReady).toBe(false);
    });

    it('reports healthy when connected', async () => {
      await store.start();
      const result = await store.health();
      expect(result.healthy).toBe(true);
    });

    it('reports unhealthy when not connected', async () => {
      // Not started — ping should throw
      const result = await store.health();
      expect(result.healthy).toBe(false);
      expect(result.details).toContain('redis ping failed');
    });
  });

  // ── Single session CRUD ───────────────────────────────────────────

  describe('putSession / getSession', () => {
    it('stores and retrieves a session', async () => {
      await store.start();
      const session = makeSession();
      await store.putSession('test-session-1', session);

      const retrieved = await store.getSession('test-session-1');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('test-session-1');
      expect(retrieved!.windowName).toBe('test');
    });

    it('returns undefined for missing session', async () => {
      await store.start();
      const result = await store.getSession('nonexistent');
      expect(result).toBeUndefined();
    });

    it('overwrites existing session on put', async () => {
      await store.start();
      const session = makeSession({ windowName: 'original' });
      await store.putSession('test-session-1', session);

      const updated = makeSession({ windowName: 'updated' });
      await store.putSession('test-session-1', updated);

      const retrieved = await store.getSession('test-session-1');
      expect(retrieved!.windowName).toBe('updated');
    });
  });

  describe('deleteSession', () => {
    it('removes a session from the store', async () => {
      await store.start();
      const session = makeSession();
      await store.putSession('test-session-1', session);
      await store.deleteSession('test-session-1');

      const retrieved = await store.getSession('test-session-1');
      expect(retrieved).toBeUndefined();
    });

    it('removes session ID from the sessions set', async () => {
      await store.start();
      await store.putSession('s1', makeSession({ id: 's1' }));
      await store.putSession('s2', makeSession({ id: 's2' }));

      await store.deleteSession('s1');
      const ids = await store.listSessionIds();
      expect(ids).toEqual(['s2']);
    });
  });

  // ── List / bulk operations ────────────────────────────────────────

  describe('listSessionIds', () => {
    it('returns empty array when no sessions exist', async () => {
      await store.start();
      const ids = await store.listSessionIds();
      expect(ids).toEqual([]);
    });

    it('returns all stored session IDs', async () => {
      await store.start();
      await store.putSession('s1', makeSession({ id: 's1' }));
      await store.putSession('s2', makeSession({ id: 's2' }));
      await store.putSession('s3', makeSession({ id: 's3' }));

      const ids = await store.listSessionIds();
      expect(ids.sort()).toEqual(['s1', 's2', 's3']);
    });
  });

  describe('load', () => {
    it('returns empty state when no sessions exist', async () => {
      await store.start();
      const state = await store.load();
      expect(state.sessions).toEqual({});
    });

    it('loads all sessions from Redis', async () => {
      await store.start();
      await store.putSession('s1', makeSession({ id: 's1', windowName: 'first' }));
      await store.putSession('s2', makeSession({ id: 's2', windowName: 'second' }));

      const state = await store.load();
      expect(Object.keys(state.sessions).sort()).toEqual(['s1', 's2']);
      expect(state.sessions['s1']!.windowName).toBe('first');
      expect(state.sessions['s2']!.windowName).toBe('second');
    });
  });

  describe('save', () => {
    it('writes full state to Redis', async () => {
      await store.start();
      const sessions: Record<string, SerializedSessionInfo> = {
        s1: makeSession({ id: 's1' }),
        s2: makeSession({ id: 's2', windowName: 'other' }),
      };

      await store.save({ sessions });

      const ids = await store.listSessionIds();
      expect(ids.sort()).toEqual(['s1', 's2']);

      const loaded = await store.getSession('s2');
      expect(loaded!.windowName).toBe('other');
    });

    it('removes sessions that are no longer in the state', async () => {
      await store.start();
      // Pre-populate with 3 sessions
      await store.putSession('s1', makeSession({ id: 's1' }));
      await store.putSession('s2', makeSession({ id: 's2' }));
      await store.putSession('s3', makeSession({ id: 's3' }));

      // Save state with only s1 and s3 — s2 should be removed
      await store.save({
        sessions: {
          s1: makeSession({ id: 's1' }),
          s3: makeSession({ id: 's3' }),
        },
      });

      const ids = await store.listSessionIds();
      expect(ids.sort()).toEqual(['s1', 's3']);

      const s2 = await store.getSession('s2');
      expect(s2).toBeUndefined();
    });

    it('handles empty state (clears everything)', async () => {
      await store.start();
      await store.putSession('s1', makeSession({ id: 's1' }));

      await store.save({ sessions: {} });

      const ids = await store.listSessionIds();
      expect(ids).toEqual([]);
    });
  });

  // ── Key prefix isolation ──────────────────────────────────────────

  describe('key prefix', () => {
    it('uses configured key prefix for all keys', async () => {
      const customRedis = createMockRedis();
      const customStore = new RedisStateStore(customRedis, { keyPrefix: 'myapp' });
      await customStore.start();

      await customStore.putSession('abc', makeSession({ id: 'abc' }));

      // Verify the key was stored with the custom prefix
      const data = customRedis.store.get('myapp:session:abc:data');
      expect(data).toBeDefined();
      expect(JSON.parse(data!).id).toBe('abc');

      // Verify the set key uses the prefix
      expect(customRedis.sets.has('myapp:sessions')).toBe(true);
    });
  });
});
