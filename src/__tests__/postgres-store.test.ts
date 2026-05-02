/**
 * postgres-store.test.ts — Unit tests for PostgresStore using mocked pg.Pool.
 *
 * Issue #1937: Pluggable SessionStore interface.
 *
 * These tests verify SQL queries, parameterized inputs, transaction handling,
 * and the StateStore interface contract without requiring a running Postgres.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostgresStore } from '../services/state/PostgresStore.js';
import type { SerializedSessionInfo, SerializedPipelineEntry, SerializedPipelineState } from '../services/state/state-store.js';

// ── Mock factories ──────────────────────────────────────────────────

type MockQueryFn = ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>>;

function makeMockPool() {
  const query = vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>();
  const connect = vi.fn();
  const end = vi.fn();

  // Default: return empty rows
  query.mockResolvedValue({ rows: [] });

  // Mock client for transaction-based methods
  const mockClient = {
    query: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  connect.mockResolvedValue(mockClient);

  return { query, connect, end, mockClient };
}

/** Create a PostgresStore with a mocked pool injected after construction. */
async function createTestStore(config?: { tableName?: string; schemaName?: string; poolMax?: number; pipelineTableName?: string }) {
  const mocks = makeMockPool();
  const store = new PostgresStore({
    url: 'postgresql://test:test@localhost:5432/aegis_test',
    ...config,
  });

  // Replace the internal pool with our mock
  const poolProxy = {
    query: mocks.query,
    connect: mocks.connect,
    end: mocks.end,
  } as any;

  // Use Object.defineProperty to set the private pool
  Object.defineProperty(store, 'pool', { value: poolProxy, writable: true });

  // Call ensureSchema by triggering start (the pool is already set, but start also calls ensureSchema)
  // We'll skip start() and just call the methods directly since pool is injected
  return { store, mocks };
}

/** Minimal valid session for tests. */
function makeSession(id: string, overrides: Partial<SerializedSessionInfo> = {}): SerializedSessionInfo {
  return {
    id,
    windowId: `@${id.slice(0, 4)}`,
    windowName: `cc-${id.slice(0, 8)}`,
    workDir: '/tmp/project',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  };
}

/** Minimal valid pipeline entry for tests. */
function makePipeline(_id: string): SerializedPipelineEntry {
  return {
    state: { status: 'running' as any, id: 'p1', name: 'test', currentStage: 'plan', retryCount: 0, maxRetries: 3, stageHistory: [], stages: [], createdAt: Date.now() },
  };
}

// ── Constructor validation ───────────────────────────────────────────

describe('PostgresStore constructor', () => {
  it('rejects invalid schema name', () => {
    expect(() => new PostgresStore({ url: 'postgresql://localhost/test', schemaName: 'foo; DROP TABLE' }))
      .toThrow('invalid schema name');
  });

  it('rejects invalid table name', () => {
    expect(() => new PostgresStore({ url: 'postgresql://localhost/test', tableName: '1invalid' }))
      .toThrow('invalid table name');
  });

  it('rejects invalid pipeline table name', () => {
    expect(() => new PostgresStore({ url: 'postgresql://localhost/test', pipelineTableName: 'has-dash' }))
      .toThrow('invalid pipeline table name');
  });

  it('accepts valid identifier names', () => {
    expect(() => new PostgresStore({
      url: 'postgresql://localhost/test',
      schemaName: 'my_schema',
      tableName: 'my_table',
      pipelineTableName: 'my_pipelines',
    })).not.toThrow();
  });
});

// ── load() ───────────────────────────────────────────────────────────

describe('PostgresStore.load()', () => {
  it('returns empty sessions when table is empty', async () => {
    const { store, mocks } = await createTestStore();
    mocks.query.mockResolvedValue({ rows: [] });

    const state = await store.load();

    expect(state).toEqual({ sessions: {} });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    // Verify SQL uses qualified table name
    const sql = mocks.query.mock.calls[0][0] as string;
    expect(sql).toContain('SELECT');
    expect(sql).toContain('aegis_sessions');
  });

  it('returns sessions from rows', async () => {
    const { store, mocks } = await createTestStore();
    const session = makeSession('sess-1');
    mocks.query.mockResolvedValue({
      rows: [{ id: 'sess-1', data: session }],
    });

    const state = await store.load();

    expect(Object.keys(state.sessions)).toEqual(['sess-1']);
    expect(state.sessions['sess-1'].id).toBe('sess-1');
    expect(state.sessions['sess-1'].status).toBe('idle');
  });

  it('returns multiple sessions', async () => {
    const { store, mocks } = await createTestStore();
    const s1 = makeSession('s1');
    const s2 = makeSession('s2', { status: 'working' });
    mocks.query.mockResolvedValue({
      rows: [
        { id: 's1', data: s1 },
        { id: 's2', data: s2 },
      ],
    });

    const state = await store.load();

    expect(Object.keys(state.sessions).sort()).toEqual(['s1', 's2']);
  });
});

// ── save() ───────────────────────────────────────────────────────────

describe('PostgresStore.save()', () => {
  it('uses a transaction (BEGIN/COMMIT)', async () => {
    const { store, mocks } = await createTestStore();
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.mockClient.query.mockResolvedValue({ rows: [] });

    await store.save({ sessions: { 's1': makeSession('s1') } });

    const queries = mocks.mockClient.query.mock.calls.map(c => c[0] as string);
    expect(queries).toContain('BEGIN');
    expect(queries.some(q => q.includes('COMMIT'))).toBe(true);
  });

  it('rolls back on error', async () => {
    const { store, mocks } = await createTestStore();
    mocks.mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT current IDs
      .mockRejectedValueOnce(new Error('DB error')); // INSERT fails

    await expect(store.save({ sessions: { 's1': makeSession('s1') } }))
      .rejects.toThrow('DB error');

    const queries = mocks.mockClient.query.mock.calls.map(c => c[0] as string);
    expect(queries).toContain('BEGIN');
    expect(queries.some(q => q.includes('ROLLBACK'))).toBe(true);
    expect(mocks.mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('releases client even on error', async () => {
    const { store, mocks } = await createTestStore();
    mocks.mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('boom'));

    await expect(store.save({ sessions: {} })).rejects.toThrow();
    expect(mocks.mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('deletes removed sessions', async () => {
    const { store, mocks } = await createTestStore();
    mocks.mockClient.query.mockResolvedValue({ rows: [] });
    // SELECT current IDs returns 'old-sess'
    mocks.mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mocks.mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'old-sess' }] }); // SELECT current
    mocks.mockClient.query.mockResolvedValue({ rows: [] }); // rest

    await store.save({ sessions: { 'new-sess': makeSession('new-sess') } });

    const deleteCall = mocks.mockClient.query.mock.calls.find(
      c => (c[0] as string).includes('DELETE')
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toEqual([['old-sess']]);
  });

  it('upserts all sessions', async () => {
    const { store, mocks } = await createTestStore();
    mocks.mockClient.query.mockResolvedValue({ rows: [] });

    const sessions = {
      's1': makeSession('s1'),
      's2': makeSession('s2'),
    };
    await store.save({ sessions });

    const insertCalls = mocks.mockClient.query.mock.calls.filter(
      c => (c[0] as string).includes('INSERT') && (c[0] as string).includes('ON CONFLICT')
    );
    expect(insertCalls.length).toBe(2);
  });
});

// ── getSession() / putSession() / deleteSession() / listSessionIds() ─

describe('PostgresStore session CRUD', () => {
  it('getSession returns undefined for missing session', async () => {
    const { store, mocks } = await createTestStore();
    mocks.query.mockResolvedValue({ rows: [] });

    const result = await store.getSession('nonexistent');
    expect(result).toBeUndefined();
  });

  it('getSession returns session data when found', async () => {
    const { store, mocks } = await createTestStore();
    const session = makeSession('s1', { status: 'working' });
    mocks.query.mockResolvedValue({ rows: [{ data: session }] });

    const result = await store.getSession('s1');
    expect(result).toBeDefined();
    expect(result!.status).toBe('working');
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT data'),
      ['s1'],
    );
  });

  it('putSession uses parameterized query', async () => {
    const { store, mocks } = await createTestStore();
    mocks.query.mockResolvedValue({ rows: [] });
    const session = makeSession('s1');

    await store.putSession('s1', session);

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT'),
      ['s1', JSON.stringify(session)],
    );
  });

  it('deleteSession uses parameterized query', async () => {
    const { store, mocks } = await createTestStore();
    mocks.query.mockResolvedValue({ rows: [] });

    await store.deleteSession('s1');

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE'),
      ['s1'],
    );
  });

  it('listSessionIds returns empty array for empty table', async () => {
    const { store, mocks } = await createTestStore();
    mocks.query.mockResolvedValue({ rows: [] });

    const ids = await store.listSessionIds();
    expect(ids).toEqual([]);
  });

  it('listSessionIds returns all IDs', async () => {
    const { store, mocks } = await createTestStore();
    mocks.query.mockResolvedValue({ rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });

    const ids = await store.listSessionIds();
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});

// ── Pipeline operations ──────────────────────────────────────────────

describe('PostgresStore pipeline operations', () => {
  it('loadPipelines returns empty when table is empty', async () => {
    const { store, mocks } = await createTestStore();
    mocks.query.mockResolvedValue({ rows: [] });

    const state = await store.loadPipelines();
    expect(state).toEqual({ pipelines: {} });
  });

  it('loadPipelines returns pipeline entries', async () => {
    const { store, mocks } = await createTestStore();
    const p1 = makePipeline('p1');
    mocks.query.mockResolvedValue({ rows: [{ id: 'p1', data: p1 }] });

    const state = await store.loadPipelines();
    expect(Object.keys(state.pipelines)).toEqual(['p1']);
  });

  it('savePipelines uses a transaction', async () => {
    const { store, mocks } = await createTestStore();
    mocks.mockClient.query.mockResolvedValue({ rows: [] });

    await store.savePipelines({ pipelines: { 'p1': makePipeline('p1') } });

    const queries = mocks.mockClient.query.mock.calls.map(c => c[0] as string);
    expect(queries).toContain('BEGIN');
    expect(queries.some(q => q.includes('COMMIT'))).toBe(true);
  });

  it('getPipeline returns undefined for missing pipeline', async () => {
    const { store, mocks } = await createTestStore();
    mocks.query.mockResolvedValue({ rows: [] });

    const result = await store.getPipeline('nonexistent');
    expect(result).toBeUndefined();
  });

  it('getPipeline returns pipeline when found', async () => {
    const { store, mocks } = await createTestStore();
    const p1 = makePipeline('p1');
    mocks.query.mockResolvedValue({ rows: [{ data: p1 }] });

    const result = await store.getPipeline('p1');
    expect(result).toBeDefined();
    expect(result).toBeDefined();
  });

  it('putPipeline uses parameterized query', async () => {
    const { store, mocks } = await createTestStore();
    mocks.query.mockResolvedValue({ rows: [] });
    const p1 = makePipeline('p1');

    await store.putPipeline('p1', p1);

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT'),
      ['p1', JSON.stringify(p1)],
    );
  });

  it('deletePipeline uses parameterized query', async () => {
    const { store, mocks } = await createTestStore();
    mocks.query.mockResolvedValue({ rows: [] });

    await store.deletePipeline('p1');

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE'),
      ['p1'],
    );
  });

  it('listPipelineIds returns all IDs', async () => {
    const { store, mocks } = await createTestStore();
    mocks.query.mockResolvedValue({ rows: [{ id: 'p1' }, { id: 'p2' }] });

    const ids = await store.listPipelineIds();
    expect(ids).toEqual(['p1', 'p2']);
  });

  it('savePipelines rolls back on error', async () => {
    const { store, mocks } = await createTestStore();
    mocks.mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error('pipeline error'));

    await expect(store.savePipelines({ pipelines: { 'p1': makePipeline('p1') } }))
      .rejects.toThrow('pipeline error');

    const queries = mocks.mockClient.query.mock.calls.map(c => c[0] as string);
    expect(queries.some(q => q.includes('ROLLBACK'))).toBe(true);
  });
});

// ── SQL injection prevention ─────────────────────────────────────────

describe('PostgresStore SQL injection prevention', () => {
  it('uses qualified table names with schema', async () => {
    const { store, mocks } = await createTestStore({
      schemaName: 'tenant_1',
      tableName: 'sessions',
    });
    mocks.query.mockResolvedValue({ rows: [] });

    await store.load();

    const sql = mocks.query.mock.calls[0][0] as string;
    expect(sql).toContain('"tenant_1"."sessions"');
  });

  it('uses custom pipeline table name', async () => {
    const { store, mocks } = await createTestStore({
      pipelineTableName: 'custom_pipelines',
    });
    mocks.query.mockResolvedValue({ rows: [] });

    await store.loadPipelines();

    const sql = mocks.query.mock.calls[0][0] as string;
    expect(sql).toContain('"custom_pipelines"');
  });

  it('all session queries use parameterized IDs ($1)', async () => {
    const { store, mocks } = await createTestStore();
    mocks.query.mockResolvedValue({ rows: [] });

    await store.getSession("'; DROP TABLE users; --");
    await store.deleteSession("'; DROP TABLE users; --");

    // Verify ID is passed as parameter, not interpolated
    const params = mocks.query.mock.calls.map(c => c[1] as unknown[]);
    expect(params[0]).toEqual(["'; DROP TABLE users; --"]);
    expect(params[1]).toEqual(["'; DROP TABLE users; --"]);
  });
});

// ── health() ─────────────────────────────────────────────────────────

describe('PostgresStore.health()', () => {
  it('returns healthy when query succeeds', async () => {
    const { store, mocks } = await createTestStore();
    mocks.query.mockResolvedValue({ rows: [{ ok: 1 }] });

    const health = await store.health();
    expect(health.healthy).toBe(true);
    expect(health.details).toContain('postgres');
  });

  it('returns unhealthy when query fails', async () => {
    const { store, mocks } = await createTestStore();
    mocks.query.mockRejectedValue(new Error('connection refused'));

    const health = await store.health();
    expect(health.healthy).toBe(false);
    expect(health.details).toContain('connection refused');
  });
});
