import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

import {
  PostgresAcpChatCache,
  type AcpChatSnapshotRecord,
  type AcpGetChatSnapshotInput,
  type AcpSaveChatSnapshotInput,
} from '../services/acp/index.js';

type QueryRows = { rows: unknown[] };
type MockQueryFn = ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<QueryRows>>>;

interface MockClient {
  query: MockQueryFn;
  release: ReturnType<typeof vi.fn<() => void>>;
}

function makeMockPool(): {
  query: MockQueryFn;
  connect: ReturnType<typeof vi.fn<() => Promise<MockClient>>>;
  end: ReturnType<typeof vi.fn<() => Promise<void>>>;
  client: MockClient;
} {
  const query = vi.fn<(sql: string, params?: unknown[]) => Promise<QueryRows>>().mockResolvedValue({ rows: [] });
  const client: MockClient = {
    query: vi.fn<(sql: string, params?: unknown[]) => Promise<QueryRows>>().mockResolvedValue({ rows: [] }),
    release: vi.fn<() => void>(),
  };
  const connect = vi.fn<() => Promise<MockClient>>().mockResolvedValue(client);
  const end = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  return { query, connect, end, client };
}

function createCache(config: Partial<ConstructorParameters<typeof PostgresAcpChatCache>[0]> = {}): {
  cache: PostgresAcpChatCache;
  mocks: ReturnType<typeof makeMockPool>;
} {
  const cache = new PostgresAcpChatCache({
    url: 'postgresql://test:test@localhost:5432/aegis_test',
    ...config,
  });
  const mocks = makeMockPool();
  Object.defineProperty(cache, 'pool', {
    value: { query: mocks.query, connect: mocks.connect, end: mocks.end },
    writable: true,
  });
  return { cache, mocks };
}

async function ensureSchemaForTest(cache: PostgresAcpChatCache): Promise<void> {
  await (cache as unknown as { ensureSchema(): Promise<void> }).ensureSchema();
}

function saveInput(overrides: Partial<AcpSaveChatSnapshotInput> = {}): AcpSaveChatSnapshotInput {
  return {
    sessionId: 'sess-1',
    tenantId: 'tenant-1',
    ownerKeyId: 'owner-1',
    transcriptId: 'transcript-1',
    fromEventSeq: 8,
    toEventSeq: 12,
    messages: [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'Hello from Claude',
        eventSeq: 12,
        createdAt: '2026-01-02T03:04:05.000Z',
      },
    ],
    tokenUsage: {
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
    },
    metadata: {
      truncatedBeforeEventSeq: 0,
    },
    ...overrides,
  };
}

function unsafeSaveInput(overrides: Record<string, unknown>): AcpSaveChatSnapshotInput {
  return { ...saveInput(), ...overrides } as unknown as AcpSaveChatSnapshotInput;
}

function unsafeGetInput(overrides: Record<string, unknown>): AcpGetChatSnapshotInput {
  return {
    sessionId: 'sess-1',
    tenantId: 'tenant-1',
    ownerKeyId: 'owner-1',
    transcriptId: 'transcript-1',
    ...overrides,
  } as unknown as AcpGetChatSnapshotInput;
}

function snapshotRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: 'sess-1',
    tenant_id: 'tenant-1',
    owner_key_id: 'owner-1',
    snapshot_id: '22222222-2222-4222-8222-222222222222',
    transcript_id: 'transcript-1',
    snapshot_seq: '2',
    from_event_seq: '8',
    to_event_seq: '12',
    created_at: new Date('2026-01-02T03:04:06.000Z'),
    messages: saveInput().messages,
    token_usage: saveInput().tokenUsage,
    metadata: saveInput().metadata,
    ...overrides,
  };
}

describe('PostgresAcpChatCache config', () => {
  it('rejects unsafe schema and table identifiers before interpolating SQL', () => {
    expect(() => new PostgresAcpChatCache({ url: 'postgresql://localhost/test', schemaName: 'public; DROP SCHEMA public' }))
      .toThrow('invalid schema name');
    expect(() => new PostgresAcpChatCache({ url: 'postgresql://localhost/test', tableName: 'chat-cache' }))
      .toThrow('invalid table name');
  });
});

describe('PostgresAcpChatCache schema', () => {
  it('uses the epic table name by default', async () => {
    const { cache, mocks } = createCache();

    await ensureSchemaForTest(cache);

    const sql = mocks.query.mock.calls.map(call => call[0] as string).join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "public"."acp_chat_snapshots"');
  });

  it('creates a scoped snapshot table with replay indexes and JSON shape checks', async () => {
    const { cache, mocks } = createCache({ schemaName: 'acp', tableName: 'chat_snapshots' });

    await ensureSchemaForTest(cache);

    const sql = mocks.query.mock.calls.map(call => call[0] as string).join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "acp"."chat_snapshots"');
    expect(sql).toContain('session_id TEXT NOT NULL');
    expect(sql).toContain('tenant_id TEXT NOT NULL');
    expect(sql).toContain('owner_key_id TEXT NOT NULL');
    expect(sql).toContain('snapshot_id TEXT NOT NULL');
    expect(sql).toContain('transcript_id TEXT NOT NULL');
    expect(sql).toContain('snapshot_seq BIGINT NOT NULL');
    expect(sql).toContain('from_event_seq BIGINT NOT NULL');
    expect(sql).toContain('to_event_seq BIGINT NOT NULL');
    expect(sql).toContain('messages JSONB NOT NULL');
    expect(sql).toContain('token_usage JSONB');
    expect(sql).toContain('metadata JSONB');
    expect(sql).toContain('PRIMARY KEY (tenant_id, owner_key_id, session_id, snapshot_seq)');
    expect(sql).toContain('UNIQUE (tenant_id, owner_key_id, session_id, transcript_id, from_event_seq, to_event_seq)');
    expect(sql).toContain("jsonb_typeof(messages) = 'array'");
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "idx_chat_snapshots_scope_latest"');
    expect(sql).toContain('ON "acp"."chat_snapshots" (tenant_id, owner_key_id, session_id, transcript_id, to_event_seq DESC)');
  });
});

describe('PostgresAcpChatCache.save()', () => {
  it('assigns the next snapshot sequence inside a transaction and returns the stored snapshot', async () => {
    const { cache, mocks } = createCache();
    mocks.client.query.mockImplementation(async (sql: string): Promise<QueryRows> => {
      if (sql.includes('INSERT INTO')) {
        return { rows: [snapshotRow({ snapshot_seq: '7' })] };
      }
      return { rows: [] };
    });

    const saved = await cache.save(saveInput());

    const queries = mocks.client.query.mock.calls.map(call => call[0] as string);
    expect(queries[0]).toBe('BEGIN');
    expect(queries.some(sql => sql.includes('pg_advisory_xact_lock'))).toBe(true);
    const lockCall = mocks.client.query.mock.calls.find(call => (call[0] as string).includes('pg_advisory_xact_lock'));
    expect(lockCall?.[1]).toEqual(['tenant-1:owner-1:sess-1']);
    const insertCall = mocks.client.query.mock.calls.find(call => (call[0] as string).includes('INSERT INTO'));
    expect(insertCall).toBeDefined();
    const insertSql = insertCall![0] as string;
    expect(insertSql).toContain('COALESCE(MAX(snapshot_seq), 0) + 1');
    expect(insertSql).toContain('RETURNING');
    expect(queries.some(sql => sql.includes('COMMIT'))).toBe(true);
    expect(saved.snapshotId).toBe('22222222-2222-4222-8222-222222222222');
    expect(saved.snapshotSeq).toBe(7);
    expect(saved.fromEventSeq).toBe(8);
    expect(saved.toEventSeq).toBe(12);
    expect(saved.messages[0]?.content).toBe('Hello from Claude');
    expect(mocks.client.release).toHaveBeenCalledTimes(1);
  });

  it('parameterizes snapshot JSON and never interpolates caller content into SQL', async () => {
    const { cache, mocks } = createCache();
    const maliciousContent = `'); DROP TABLE acp_chat_snapshots; --`;
    mocks.client.query.mockImplementation(async (sql: string): Promise<QueryRows> => {
      if (sql.includes('INSERT INTO')) {
        return { rows: [snapshotRow({ messages: [{ ...saveInput().messages[0], content: maliciousContent }] })] };
      }
      return { rows: [] };
    });

    await cache.save(saveInput({
      messages: [{ ...saveInput().messages[0]!, content: maliciousContent }],
    }));

    const insertCall = mocks.client.query.mock.calls.find(call => (call[0] as string).includes('INSERT INTO'));
    expect(insertCall).toBeDefined();
    const [sql, params] = insertCall as [string, unknown[]];
    expect(sql).not.toContain(maliciousContent);
    expect(params).toContain(JSON.stringify([{ ...saveInput().messages[0]!, content: maliciousContent }]));
  });

  it('keeps same public session ids isolated when they appear under different tenant-owner scopes', async () => {
    const { cache, mocks } = createCache();
    mocks.client.query.mockImplementation(async (sql: string, params?: unknown[]): Promise<QueryRows> => {
      if (sql.includes('INSERT INTO')) {
        return {
          rows: [snapshotRow({
            tenant_id: params?.[1],
            owner_key_id: params?.[2],
            snapshot_seq: '1',
          })],
        };
      }
      return { rows: [] };
    });

    const saved = await cache.save(saveInput({
      sessionId: 'shared-session-id',
      tenantId: 'tenant-other',
      ownerKeyId: 'owner-other',
    }));

    const queries = mocks.client.query.mock.calls.map(call => call[0] as string);
    expect(queries.some(sql => sql.includes('tenant_id <> $2'))).toBe(false);
    expect(queries.some(sql => sql.includes('WHERE session_id = $1') && sql.includes('tenant_id = $2'))).toBe(true);
    expect(saved.tenantId).toBe('tenant-other');
    expect(saved.ownerKeyId).toBe('owner-other');
    expect(mocks.client.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['sessionId', { sessionId: '' }],
    ['tenantId', { tenantId: '   ' }],
    ['ownerKeyId', { ownerKeyId: 42 }],
    ['transcriptId', { transcriptId: '' }],
    ['fromEventSeq', { fromEventSeq: 0 }],
    ['toEventSeq', { toEventSeq: 7 }],
    ['messages', { messages: { id: 'not-an-array' } }],
    ['tokenUsage', { tokenUsage: { totalTokens: Number.NaN } }],
    ['metadata', { metadata: { callback: () => 'unsafe' } }],
  ])('rejects malformed %s before opening a database client', async (_field, overrides) => {
    const { cache, mocks } = createCache();

    await expect(cache.save(unsafeSaveInput(overrides))).rejects.toThrow('PostgresAcpChatCache');

    expect(mocks.connect).not.toHaveBeenCalled();
  });
});

describe('PostgresAcpChatCache.getLatest()', () => {
  it('loads the latest scoped snapshot at or before an optional event sequence', async () => {
    const { cache, mocks } = createCache();
    mocks.query.mockResolvedValue({ rows: [snapshotRow({ to_event_seq: '10' })] });

    const snapshot = await cache.getLatest({
      sessionId: 'sess-1',
      tenantId: 'tenant-1',
      ownerKeyId: 'owner-1',
      transcriptId: 'transcript-1',
      atOrBeforeEventSeq: 11,
    });

    expect(snapshot?.toEventSeq).toBe(10);
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE session_id = $1');
    expect(sql).toContain('tenant_id = $2');
    expect(sql).toContain('owner_key_id = $3');
    expect(sql).toContain('transcript_id = $4');
    expect(sql).toContain('to_event_seq <= $5');
    expect(sql).toContain('ORDER BY to_event_seq DESC, snapshot_seq DESC');
    expect(sql).toContain('LIMIT 1');
    expect(params).toEqual(['sess-1', 'tenant-1', 'owner-1', 'transcript-1', 11]);
  });

  it('returns null when no scoped snapshot exists', async () => {
    const { cache, mocks } = createCache();
    mocks.query.mockResolvedValue({ rows: [] });

    await expect(cache.getLatest(saveInput())).resolves.toBeNull();
  });

  it.each([
    ['sessionId', { sessionId: '' }],
    ['tenantId', { tenantId: [] }],
    ['ownerKeyId', { ownerKeyId: '   ' }],
    ['transcriptId', { transcriptId: null }],
    ['atOrBeforeEventSeq', { atOrBeforeEventSeq: -1 }],
  ])('rejects malformed getLatest %s before querying Postgres', async (_field, overrides) => {
    const { cache, mocks } = createCache();

    await expect(cache.getLatest(unsafeGetInput(overrides))).rejects.toThrow('PostgresAcpChatCache');

    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects unsafe BIGINT sequences returned by Postgres', async () => {
    const { cache, mocks } = createCache();
    mocks.query.mockResolvedValue({
      rows: [snapshotRow({ snapshot_seq: `${Number.MAX_SAFE_INTEGER + 1}` })],
    });

    await expect(cache.getLatest({
      sessionId: 'sess-1',
      tenantId: 'tenant-1',
      ownerKeyId: 'owner-1',
      transcriptId: 'transcript-1',
    })).rejects.toThrow('snapshot_seq');
  });
});

describe('PostgresAcpChatCache lifecycle', () => {
  it('reports unhealthy before the cache is started', async () => {
    const cache = new PostgresAcpChatCache({ url: 'postgresql://localhost/test' });

    await expect(cache.health()).resolves.toEqual({
      healthy: false,
      details: 'postgres ACP chat cache not started',
    });
  });
});

const postgresTestUrl = process.env.ACP_POSTGRES_TEST_URL;
const describePostgres = postgresTestUrl === undefined ? describe.skip : describe;

describePostgres('PostgresAcpChatCache integration', () => {
  const schemaName = 'acp_chat_cache_test';
  const tableName = `snapshots_${process.pid}`;
  const pool = new Pool({ connectionString: postgresTestUrl });
  const cache = new PostgresAcpChatCache({
    url: postgresTestUrl ?? '',
    schemaName,
    tableName,
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS "${schemaName}"."${tableName}"`);
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}"`);
    await pool.end();
  });

  it('stores scoped chat snapshots and loads the latest snapshot for replay warm start', async () => {
    await cache.start();
    try {
      const first = await cache.save(saveInput({
        sessionId: 'integration-session',
        fromEventSeq: 1,
        toEventSeq: 1,
        messages: [{ ...saveInput().messages[0]!, id: 'msg-1', eventSeq: 1, content: 'first' }],
      }));
      const second = await cache.save(saveInput({
        sessionId: 'integration-session',
        fromEventSeq: 2,
        toEventSeq: 3,
        messages: [{ ...saveInput().messages[0]!, id: 'msg-2', eventSeq: 3, content: 'second' }],
      }));
      const otherTenant = await cache.save(saveInput({
        tenantId: 'tenant-other',
        ownerKeyId: 'owner-other',
        sessionId: 'integration-session',
        fromEventSeq: 1,
        toEventSeq: 4,
      }));

      expect([first.snapshotSeq, second.snapshotSeq]).toEqual([1, 2]);
      expect(otherTenant.snapshotSeq).toBe(1);

      const latest = await cache.getLatest({
        tenantId: 'tenant-1',
        ownerKeyId: 'owner-1',
        sessionId: 'integration-session',
        transcriptId: 'transcript-1',
      });
      const replayStart = await cache.getLatest({
        tenantId: 'tenant-1',
        ownerKeyId: 'owner-1',
        sessionId: 'integration-session',
        transcriptId: 'transcript-1',
        atOrBeforeEventSeq: 2,
      });

      expect(latest?.toEventSeq).toBe(3);
      expect(latest?.messages[0]?.content).toBe('second');
      expect(replayStart?.toEventSeq).toBe(1);
      expect(replayStart?.messages[0]?.content).toBe('first');
    } finally {
      await cache.stop(new AbortController().signal);
    }
  });
});
