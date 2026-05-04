import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { PostgresAcpEventStore } from '../services/acp/postgres-event-store.js';
import type { AcpAppendEventInput, AcpListEventsInput } from '../services/acp/event-store.js';

type QueryRows = { rows: unknown[] };
type MockQueryFn = ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<QueryRows>>>;

interface MockClient {
  query: MockQueryFn;
  release: ReturnType<typeof vi.fn<() => void>>;
}

function makeMockPool(): { query: MockQueryFn; connect: ReturnType<typeof vi.fn<() => Promise<MockClient>>>; end: ReturnType<typeof vi.fn<() => Promise<void>>>; client: MockClient } {
  const query = vi.fn<(sql: string, params?: unknown[]) => Promise<QueryRows>>().mockResolvedValue({ rows: [] });
  const client: MockClient = {
    query: vi.fn<(sql: string, params?: unknown[]) => Promise<QueryRows>>().mockResolvedValue({ rows: [] }),
    release: vi.fn<() => void>(),
  };
  const connect = vi.fn<() => Promise<MockClient>>().mockResolvedValue(client);
  const end = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  return { query, connect, end, client };
}

function createStore(config: Partial<ConstructorParameters<typeof PostgresAcpEventStore>[0]> = {}): {
  store: PostgresAcpEventStore;
  mocks: ReturnType<typeof makeMockPool>;
} {
  const store = new PostgresAcpEventStore({
    url: 'postgresql://test:test@localhost:5432/aegis_test',
    ...config,
  });
  const mocks = makeMockPool();
  Object.defineProperty(store, 'pool', {
    value: { query: mocks.query, connect: mocks.connect, end: mocks.end },
    writable: true,
  });
  return { store, mocks };
}

async function ensureSchemaForTest(store: PostgresAcpEventStore): Promise<void> {
  // Validate DDL emitted by the private startup helper without opening a real database connection.
  await (store as unknown as { ensureSchema(): Promise<void> }).ensureSchema();
}

function appendInput(overrides: Partial<AcpAppendEventInput> = {}): AcpAppendEventInput {
  return {
    sessionId: 'sess-1',
    tenantId: 'tenant-1',
    ownerKeyId: 'owner-1',
    backendRunId: 'run-1',
    eventType: 'message.delta',
    occurredAt: new Date('2026-01-02T03:04:05.000Z'),
    payload: { text: 'hello', tokenCount: 3 },
    payloadRef: 'blob://payloads/sess-1/1',
    ...overrides,
  };
}

function unsafeAppendInput(overrides: Record<string, unknown>): AcpAppendEventInput {
  return { ...appendInput(), ...overrides } as unknown as AcpAppendEventInput;
}

function unsafeListInput(overrides: Record<string, unknown>): AcpListEventsInput {
  return {
    sessionId: 'sess-1',
    tenantId: 'tenant-1',
    ownerKeyId: 'owner-1',
    ...overrides,
  } as unknown as AcpListEventsInput;
}

function eventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: 'sess-1',
    tenant_id: 'tenant-1',
    owner_key_id: 'owner-1',
    event_seq: '1',
    event_id: '11111111-1111-4111-8111-111111111111',
    backend_run_id: 'run-1',
    event_type: 'message.delta',
    occurred_at: new Date('2026-01-02T03:04:05.000Z'),
    ingested_at: new Date('2026-01-02T03:04:06.000Z'),
    payload: { text: 'hello', tokenCount: 3 },
    payload_ref: 'blob://payloads/sess-1/1',
    ...overrides,
  };
}

describe('PostgresAcpEventStore config', () => {
  it('rejects unsafe schema and table identifiers before interpolating SQL', () => {
    expect(() => new PostgresAcpEventStore({ url: 'postgresql://localhost/test', schemaName: 'public; DROP SCHEMA public' }))
      .toThrow('invalid schema name');
    expect(() => new PostgresAcpEventStore({ url: 'postgresql://localhost/test', tableName: 'events-table' }))
      .toThrow('invalid table name');
  });

  it('rejects invalid pool sizes before creating a Postgres pool', () => {
    expect(() => new PostgresAcpEventStore({ url: 'postgresql://localhost/test', poolMax: 0 }))
      .toThrow('poolMax');
    expect(() => new PostgresAcpEventStore({ url: 'postgresql://localhost/test', poolMax: 1.5 }))
      .toThrow('poolMax');
    expect(() => new PostgresAcpEventStore({ url: 'postgresql://localhost/test', poolMax: Number.MAX_SAFE_INTEGER + 1 }))
      .toThrow('poolMax');
  });

  it('accepts valid custom schema and table identifiers', () => {
    expect(() => new PostgresAcpEventStore({
      url: 'postgresql://localhost/test',
      schemaName: 'tenant_events',
      tableName: 'acp_events_2026',
      poolMax: 8,
    })).not.toThrow();
  });
});

describe('PostgresAcpEventStore schema', () => {
  it('creates a typed ACP event table with uniqueness constraints and scoped replay index', async () => {
    const { store, mocks } = createStore({ schemaName: 'acp', tableName: 'events' });

    await ensureSchemaForTest(store);

    const sql = mocks.query.mock.calls.map(call => call[0] as string).join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "acp"."events"');
    expect(sql).toContain('session_id TEXT NOT NULL');
    expect(sql).toContain('tenant_id TEXT NOT NULL');
    expect(sql).toContain('owner_key_id TEXT NOT NULL');
    expect(sql).toContain('event_seq BIGINT NOT NULL');
    expect(sql).toContain('event_id TEXT NOT NULL');
    expect(sql).toContain('backend_run_id TEXT');
    expect(sql).toContain('event_type TEXT NOT NULL');
    expect(sql).toContain('occurred_at TIMESTAMPTZ NOT NULL');
    expect(sql).toContain('ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    expect(sql).toContain('payload JSONB NOT NULL');
    expect(sql).toContain('payload_ref TEXT');
    expect(sql).toContain('PRIMARY KEY (session_id, event_seq)');
    expect(sql).toContain('UNIQUE (event_id)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "idx_events_scope_replay"');
    expect(sql).toContain('ON "acp"."events" (tenant_id, owner_key_id, session_id, event_seq)');
  });
});

describe('PostgresAcpEventStore.append()', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('assigns the next event sequence inside a transaction and returns the stored record', async () => {
    const { store, mocks } = createStore();
    mocks.client.query.mockImplementation(async (sql: string): Promise<QueryRows> => {
      if (sql.includes('INSERT INTO')) {
        return { rows: [eventRow({ event_seq: '7' })] };
      }
      return { rows: [] };
    });

    const stored = await store.append(appendInput());

    const queries = mocks.client.query.mock.calls.map(call => call[0] as string);
    expect(queries[0]).toBe('BEGIN');
    expect(queries.some(sql => sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(queries.some(sql => sql.includes('hashtextextended'))).toBe(false);
    expect(queries.some(sql => sql.includes('md5($1)'))).toBe(true);
    const insertCall = mocks.client.query.mock.calls.find(call => (call[0] as string).includes('INSERT INTO'));
    expect(insertCall).toBeDefined();
    const insertSql = insertCall![0] as string;
    expect(insertSql).toContain('COALESCE(MAX(event_seq), 0) + 1');
    expect(insertSql).toContain('RETURNING');
    expect(queries.some(sql => sql.includes('COMMIT'))).toBe(true);
    expect(stored.eventSeq).toBe(7);
    expect(stored.eventId).toBe('11111111-1111-4111-8111-111111111111');
    expect(mocks.client.release).toHaveBeenCalledTimes(1);
  });

  it('parameterizes append values and never interpolates caller input into SQL', async () => {
    const { store, mocks } = createStore();
    const maliciousSessionId = `sess'; DROP TABLE acp_events; --`;
    mocks.client.query.mockImplementation(async (sql: string): Promise<QueryRows> => {
      if (sql.includes('INSERT INTO')) {
        return { rows: [eventRow({ session_id: maliciousSessionId })] };
      }
      return { rows: [] };
    });

    await store.append(appendInput({ sessionId: maliciousSessionId, payload: { text: `'); DROP TABLE x; --` } }));

    const insertCall = mocks.client.query.mock.calls.find(call => (call[0] as string).includes('INSERT INTO'));
    expect(insertCall).toBeDefined();
    const [sql, params] = insertCall as [string, unknown[]];
    expect(sql).not.toContain(maliciousSessionId);
    expect(params[0]).toBe(maliciousSessionId);
    expect(params[7]).toBe(JSON.stringify({ text: `'); DROP TABLE x; --` }));
  });

  it('rolls back and releases the client when the database rejects a duplicate event id', async () => {
    const { store, mocks } = createStore();
    const duplicate = new Error('duplicate key value violates unique constraint "aegis_acp_events_event_id_key"');
    mocks.client.query.mockImplementation(async (sql: string): Promise<QueryRows> => {
      if (sql.includes('INSERT INTO')) {
        throw duplicate;
      }
      return { rows: [] };
    });

    await expect(store.append(appendInput())).rejects.toThrow('duplicate key value');

    const queries = mocks.client.query.mock.calls.map(call => call[0] as string);
    expect(queries).toContain('BEGIN');
    expect(queries.some(sql => sql.includes('ROLLBACK'))).toBe(true);
    expect(mocks.client.release).toHaveBeenCalledTimes(1);
  });

  it('round-trips timestamps, payload, and optional payload references from the returned row', async () => {
    const { store, mocks } = createStore();
    const occurredAt = '2026-02-03T04:05:06.000Z';
    const ingestedAt = '2026-02-03T04:05:07.000Z';
    mocks.client.query.mockImplementation(async (sql: string): Promise<QueryRows> => {
      if (sql.includes('INSERT INTO')) {
        return { rows: [eventRow({ occurred_at: occurredAt, ingested_at: ingestedAt, payload: { nested: { ok: true } }, payload_ref: null })] };
      }
      return { rows: [] };
    });

    const stored = await store.append(appendInput({ payload: { nested: { ok: true } }, payloadRef: undefined }));

    expect(stored.occurredAt.toISOString()).toBe(occurredAt);
    expect(stored.ingestedAt.toISOString()).toBe(ingestedAt);
    expect(stored.payload).toEqual({ nested: { ok: true } });
    expect(stored.payloadRef).toBeUndefined();
  });

  it('rejects an append when the public session id already belongs to another tenant-owner scope', async () => {
    const { store, mocks } = createStore();
    mocks.client.query.mockImplementation(async (sql: string): Promise<QueryRows> => {
      if (sql.includes('tenant_id <> $2')) {
        return { rows: [{ tenant_id: 'tenant-other', owner_key_id: 'owner-other' }] };
      }
      return { rows: [] };
    });

    await expect(store.append(appendInput())).rejects.toThrow('session scope');

    const queries = mocks.client.query.mock.calls.map(call => call[0] as string);
    expect(queries.some(sql => sql.includes('ROLLBACK'))).toBe(true);
    expect(queries.some(sql => sql.includes('INSERT INTO'))).toBe(false);
    expect(mocks.client.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['sessionId', { sessionId: '' }],
    ['tenantId', { tenantId: '   ' }],
    ['ownerKeyId', { ownerKeyId: 42 }],
    ['eventType', { eventType: '' }],
    ['backendRunId', { backendRunId: '' }],
    ['payloadRef', { payloadRef: 123 }],
  ])('rejects malformed %s before opening a database client', async (_field, overrides) => {
    const { store, mocks } = createStore();

    await expect(store.append(unsafeAppendInput(overrides))).rejects.toThrow('PostgresAcpEventStore');

    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['top-level undefined', undefined],
    ['function property', { callback: () => 'unsafe' }],
    ['symbol in array', [Symbol('unsafe')]],
    ['bigint value', { count: 1n }],
    ['NaN number', { value: Number.NaN }],
    ['Infinity number', { value: Infinity }],
    ['undefined object property', { omitted: undefined }],
    ['sparse array', Object.assign([], { 1: 'x' })],
  ])('rejects payloads that cannot be losslessly persisted as JSON: %s', async (_label, payload) => {
    const { store, mocks } = createStore();

    await expect(store.append(unsafeAppendInput({ payload }))).rejects.toThrow('payload');

    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('rejects circular payloads instead of surfacing a JSON.stringify TypeError', async () => {
    const { store, mocks } = createStore();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(store.append(unsafeAppendInput({ payload: circular }))).rejects.toThrow('payload');

    expect(mocks.connect).not.toHaveBeenCalled();
  });
});

describe('PostgresAcpEventStore.list()', () => {
  it('replays events for one scoped session after an optional event sequence in ascending order with a limit', async () => {
    const { store, mocks } = createStore();
    mocks.query.mockResolvedValue({
      rows: [eventRow({ event_seq: '2' }), eventRow({ event_seq: '3', event_id: '33333333-3333-4333-8333-333333333333' })],
    });

    const events = await store.list({
      sessionId: 'sess-1',
      tenantId: 'tenant-1',
      ownerKeyId: 'owner-1',
      afterEventSeq: 1,
      limit: 2,
    });

    expect(events.map(event => event.eventSeq)).toEqual([2, 3]);
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE session_id = $1');
    expect(sql).toContain('tenant_id = $2');
    expect(sql).toContain('owner_key_id = $3');
    expect(sql).toContain('event_seq > $4');
    expect(sql).toContain('ORDER BY event_seq ASC');
    expect(sql).toContain('LIMIT $5');
    expect(params).toEqual(['sess-1', 'tenant-1', 'owner-1', 1, 2]);
  });

  it('keeps cross-scope replay isolated by tenant and owner predicates', async () => {
    const { store, mocks } = createStore();
    mocks.query.mockResolvedValue({ rows: [] });

    const events = await store.list({
      sessionId: 'shared-session-id',
      tenantId: 'tenant-a',
      ownerKeyId: 'owner-a',
    });

    expect(events).toEqual([]);
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('tenant_id = $2');
    expect(sql).toContain('owner_key_id = $3');
    expect(params.slice(0, 3)).toEqual(['shared-session-id', 'tenant-a', 'owner-a']);
  });

  it.each([
    ['sessionId', { sessionId: '' }],
    ['tenantId', { tenantId: [] }],
    ['ownerKeyId', { ownerKeyId: '   ' }],
  ])('rejects malformed list %s before querying Postgres', async (_field, overrides) => {
    const { store, mocks } = createStore();

    await expect(store.list(unsafeListInput(overrides))).rejects.toThrow('PostgresAcpEventStore');

    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects unsafe BIGINT event sequences returned by Postgres', async () => {
    const { store, mocks } = createStore();
    mocks.query.mockResolvedValue({
      rows: [eventRow({ event_seq: `${Number.MAX_SAFE_INTEGER + 1}` })],
    });

    await expect(store.list({
      sessionId: 'sess-1',
      tenantId: 'tenant-1',
      ownerKeyId: 'owner-1',
    })).rejects.toThrow('event_seq');
  });
});

describe('PostgresAcpEventStore health', () => {
  it('reports unhealthy before the store is started', async () => {
    const store = new PostgresAcpEventStore({ url: 'postgresql://localhost/test' });

    await expect(store.health()).resolves.toEqual({
      healthy: false,
      details: 'postgres ACP event store not started',
    });
  });
});

describe('PostgresAcpEventStore lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears and closes the pool when startup fails so a later start can retry', async () => {
    const query = vi
      .spyOn(Pool.prototype, 'query')
      .mockRejectedValueOnce(new Error('schema unavailable'))
      .mockResolvedValue({ rows: [{ ok: 1 }] } as never);
    const end = vi.spyOn(Pool.prototype, 'end').mockResolvedValue(undefined as never);
    const store = new PostgresAcpEventStore({ url: 'postgresql://localhost/test' });

    await expect(store.start()).rejects.toThrow('schema unavailable');
    await expect(store.health()).resolves.toEqual({
      healthy: false,
      details: 'postgres ACP event store not started',
    });

    await store.start();

    expect(end).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.length).toBeGreaterThan(1);
  });
});

const postgresTestUrl = process.env.ACP_POSTGRES_TEST_URL;
const describePostgres = postgresTestUrl === undefined ? describe.skip : describe;

describePostgres('PostgresAcpEventStore integration', () => {
  const schemaName = 'acp_event_store_test';
  const tableName = `events_${process.pid}`;
  const pool = new Pool({ connectionString: postgresTestUrl });
  const store = new PostgresAcpEventStore({
    url: postgresTestUrl ?? '',
    schemaName,
    tableName,
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS "${schemaName}"."${tableName}"`);
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}"`);
    await pool.end();
  });

  it('serializes concurrent appends into contiguous per-session event sequences and scoped replay', async () => {
    await store.start();
    try {
      const append = () => store.append(appendInput({
        tenantId: 'tenant-a',
        ownerKeyId: 'owner-a',
        sessionId: 'integration-session',
        payload: { tenantId: 'tenant-a', ownerKeyId: 'owner-a' },
      }));

      const events = await Promise.all([
        append(),
        append(),
        append(),
      ]);
      await expect(store.append(appendInput({
        tenantId: 'tenant-b',
        ownerKeyId: 'owner-b',
        sessionId: 'integration-session',
      }))).rejects.toThrow('session scope');

      expect(events.map(event => event.eventSeq).sort((a, b) => a - b)).toEqual([1, 2, 3]);

      const tenantAReplay = await store.list({
        tenantId: 'tenant-a',
        ownerKeyId: 'owner-a',
        sessionId: 'integration-session',
      });
      const tenantBReplay = await store.list({
        tenantId: 'tenant-b',
        ownerKeyId: 'owner-b',
        sessionId: 'integration-session',
      });

      expect(tenantAReplay).toHaveLength(3);
      expect(tenantAReplay.map(event => event.eventSeq)).toEqual([1, 2, 3]);
      expect(tenantBReplay).toHaveLength(0);
    } finally {
      await store.stop(new AbortController().signal);
    }
  });
});
