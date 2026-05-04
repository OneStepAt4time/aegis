import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PostgresAcpSessionStore,
  type AcpSessionRecord,
  type AcpSessionScope,
} from '../services/acp/index.js';

interface MockQueryResult {
  rows: unknown[];
}

type MockQuery = ReturnType<
  typeof vi.fn<(sql: string, params?: readonly unknown[]) => Promise<MockQueryResult>>
>;
type MockEnd = ReturnType<typeof vi.fn<() => Promise<void>>>;

interface MockPool {
  query: MockQuery;
  end: MockEnd;
}

const pgMock = vi.hoisted(() => {
  function makePool(): MockPool {
    return {
      query: vi
        .fn<(sql: string, params?: readonly unknown[]) => Promise<MockQueryResult>>()
        .mockResolvedValue({ rows: [] }),
      end: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
  }

  const pools: MockPool[] = [];
  const configs: unknown[] = [];
  const Pool = vi.fn(function MockPoolConstructor(config: unknown) {
    configs.push(config);
    const pool = makePool();
    pools.push(pool);
    return pool;
  });

  return {
    Pool,
    configs,
    pools,
    latestPool(): MockPool {
      const pool = pools.at(-1);
      if (!pool) throw new Error('expected a mocked pg Pool to be constructed');
      return pool;
    },
    reset(): void {
      configs.length = 0;
      pools.length = 0;
      Pool.mockClear();
    },
  };
});

vi.mock('pg', () => ({ Pool: pgMock.Pool }));

const scope: AcpSessionScope = {
  tenantId: 'tenant-a',
  ownerKeyId: 'owner-a',
};

function makeRecord(overrides: Partial<AcpSessionRecord> = {}): AcpSessionRecord {
  return {
    id: 'session-1',
    tenantId: scope.tenantId,
    ownerKeyId: scope.ownerKeyId,
    acpAgentSessionId: 'acp-session-1',
    claudeSessionId: 'claude-session-1',
    conversationId: 'conversation-1',
    transcriptId: 'transcript-1',
    parentSessionId: 'parent-1',
    rootSessionId: 'root-1',
    correlationId: 'correlation-1',
    resumeFromSessionId: 'resume-source-1',
    currentBackendRunId: 'backend-run-1',
    status: 'running',
    createdAt: 1_700_000_000_123,
    updatedAt: 1_700_000_000_456,
    closedAt: 1_700_000_000_789,
    failedAt: undefined,
    backendMetadata: {
      runtime: 'claude-agent-acp',
      restartCount: 2,
      warm: true,
      note: null,
    },
    ...overrides,
  };
}

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const record = makeRecord();
  return {
    session_id: record.id,
    tenant_id: record.tenantId,
    owner_key_id: record.ownerKeyId,
    acp_agent_session_id: record.acpAgentSessionId,
    claude_session_id: record.claudeSessionId,
    conversation_id: record.conversationId,
    transcript_id: record.transcriptId,
    parent_session_id: record.parentSessionId,
    root_session_id: record.rootSessionId,
    correlation_id: record.correlationId,
    resume_from_session_id: record.resumeFromSessionId,
    current_backend_run_id: record.currentBackendRunId,
    status: record.status,
    created_at: String(record.createdAt),
    updated_at: String(record.updatedAt),
    closed_at: String(record.closedAt),
    failed_at: null,
    backend_metadata: record.backendMetadata,
    ...overrides,
  };
}

async function createStartedStore(
  config: {
    schemaName?: string;
    tableName?: string;
    poolMax?: number;
  } = {}
): Promise<{ store: PostgresAcpSessionStore; pool: MockPool }> {
  const store = new PostgresAcpSessionStore({
    url: 'postgresql://aegis:aegis@localhost:5432/aegis_test',
    ...config,
  });
  await store.start();
  const pool = pgMock.latestPool();
  pool.query.mockClear();
  return { store, pool };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('PostgresAcpSessionStore constructor', () => {
  beforeEach(() => pgMock.reset());

  it('rejects unsafe schema identifiers before interpolation', () => {
    expect(
      () =>
        new PostgresAcpSessionStore({
          url: 'postgresql://localhost/test',
          schemaName: 'public; DROP SCHEMA public; --',
        })
    ).toThrow('invalid schema name');
  });

  it('rejects unsafe table identifiers before interpolation', () => {
    expect(
      () =>
        new PostgresAcpSessionStore({
          url: 'postgresql://localhost/test',
          tableName: 'acp-sessions',
        })
    ).toThrow('invalid table name');
  });

  it('accepts valid schema and table identifiers', () => {
    expect(
      () =>
        new PostgresAcpSessionStore({
          url: 'postgresql://localhost/test',
          schemaName: 'tenant_1',
          tableName: 'acp_sessions_2026',
        })
    ).not.toThrow();
  });
});

describe('PostgresAcpSessionStore lifecycle', () => {
  beforeEach(() => pgMock.reset());

  it('creates a typed ACP session table and tenant-owner lookup index on start', async () => {
    const store = new PostgresAcpSessionStore({
      url: 'postgresql://aegis:aegis@localhost:5432/aegis_test',
      schemaName: 'acp',
      tableName: 'sessions',
    });

    await store.start();

    expect(pgMock.configs[0]).toEqual({
      connectionString: 'postgresql://aegis:aegis@localhost:5432/aegis_test',
      max: 5,
    });
    const pool = pgMock.latestPool();
    const sql = pool.query.mock.calls.map(call => normalizeSql(call[0]));
    const createTableSql = sql.find(statement => statement.includes('CREATE TABLE IF NOT EXISTS'));
    expect(createTableSql).toContain('CREATE TABLE IF NOT EXISTS "acp"."sessions"');
    expect(createTableSql).toContain('session_id TEXT NOT NULL');
    expect(createTableSql).toContain('tenant_id TEXT NOT NULL');
    expect(createTableSql).toContain('owner_key_id TEXT NOT NULL');
    expect(createTableSql).toContain('acp_agent_session_id TEXT');
    expect(createTableSql).toContain('claude_session_id TEXT');
    expect(createTableSql).toContain('conversation_id TEXT NOT NULL');
    expect(createTableSql).toContain('transcript_id TEXT NOT NULL');
    expect(createTableSql).toContain('current_backend_run_id TEXT');
    expect(createTableSql).toContain('status TEXT NOT NULL');
    expect(createTableSql).toContain('created_at BIGINT NOT NULL');
    expect(createTableSql).toContain('updated_at BIGINT NOT NULL');
    expect(createTableSql).toContain('backend_metadata JSONB');
    expect(createTableSql).toContain(
      'CONSTRAINT "sessions_pkey" PRIMARY KEY (tenant_id, owner_key_id, session_id)'
    );
    expect(createTableSql).not.toMatch(/\\bdata JSONB\\b/);
    expect(
      sql.some(statement =>
        statement.includes('CREATE INDEX IF NOT EXISTS "idx_sessions_scope_session"')
      )
    ).toBe(true);
    expect(
      sql.some(statement =>
        statement.includes('ON "acp"."sessions" (tenant_id, owner_key_id, session_id)')
      )
    ).toBe(true);
  });

  it('uses configured poolMax when provided', async () => {
    const store = new PostgresAcpSessionStore({
      url: 'postgresql://localhost/test',
      poolMax: 9,
    });

    await store.start();

    expect(pgMock.configs[0]).toEqual({
      connectionString: 'postgresql://localhost/test',
      max: 9,
    });
  });
});

describe('PostgresAcpSessionStore.create', () => {
  beforeEach(() => pgMock.reset());

  it('inserts typed ACP session columns with parameterized values', async () => {
    const { store, pool } = await createStartedStore();
    const record = makeRecord({
      id: "session-1'); DROP TABLE acp_sessions; --",
      tenantId: 'tenant-injected',
      ownerKeyId: 'owner-injected',
    });

    await store.create(record);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(normalizeSql(sql)).toContain('INSERT INTO "public"."acp_sessions"');
    expect(sql).not.toContain(record.id);
    expect(sql).not.toContain(record.tenantId);
    expect(sql).not.toContain(record.ownerKeyId);
    expect(params).toEqual([
      record.id,
      record.tenantId,
      record.ownerKeyId,
      record.acpAgentSessionId,
      record.claudeSessionId,
      record.conversationId,
      record.transcriptId,
      record.parentSessionId,
      record.rootSessionId,
      record.correlationId,
      record.resumeFromSessionId,
      record.currentBackendRunId,
      record.status,
      record.createdAt,
      record.updatedAt,
      record.closedAt,
      null,
      JSON.stringify(record.backendMetadata),
    ]);
  });
});

describe('PostgresAcpSessionStore.get', () => {
  beforeEach(() => pgMock.reset());

  it('reads by public session id plus tenant and owner scope', async () => {
    const { store, pool } = await createStartedStore();
    pool.query.mockResolvedValueOnce({ rows: [makeRow()] });

    const result = await store.get('session-1', scope);

    expect(result).toEqual(makeRecord());
    const [sql, params] = pool.query.mock.calls[0];
    expect(normalizeSql(sql)).toContain(
      'WHERE session_id = $1 AND tenant_id = $2 AND owner_key_id = $3'
    );
    expect(params).toEqual(['session-1', 'tenant-a', 'owner-a']);
  });

  it('returns null when the requested tenant-owner scope has no matching row', async () => {
    const { store, pool } = await createStartedStore();
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await store.get('session-1', {
      tenantId: 'tenant-b',
      ownerKeyId: 'owner-a',
    });

    expect(result).toBeNull();
    expect(pool.query.mock.calls[0][1]).toEqual(['session-1', 'tenant-b', 'owner-a']);
  });

  it('preserves millisecond timestamps stored as BIGINT values', async () => {
    const { store, pool } = await createStartedStore();
    pool.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          created_at: '1700000000123',
          updated_at: '1700000000456',
          closed_at: '1700000000789',
          failed_at: '1700000000999',
        }),
      ],
    });

    const result = await store.get('session-1', scope);

    expect(result?.createdAt).toBe(1_700_000_000_123);
    expect(result?.updatedAt).toBe(1_700_000_000_456);
    expect(result?.closedAt).toBe(1_700_000_000_789);
    expect(result?.failedAt).toBe(1_700_000_000_999);
  });

  it('round-trips bounded backend metadata from JSONB rows', async () => {
    const { store, pool } = await createStartedStore();
    pool.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          backend_metadata: {
            runtime: 'claude-agent-acp',
            restartCount: 2,
            warm: true,
            note: null,
          },
        }),
      ],
    });

    const result = await store.get('session-1', scope);

    expect(result?.backendMetadata).toEqual({
      runtime: 'claude-agent-acp',
      restartCount: 2,
      warm: true,
      note: null,
    });
  });

  it('wraps malformed JSON metadata rows in a store-specific error', async () => {
    const { store, pool } = await createStartedStore();
    pool.query.mockResolvedValueOnce({
      rows: [makeRow({ backend_metadata: '{"broken"' })],
    });

    await expect(store.get('session-1', scope)).rejects.toThrow(
      'PostgresAcpSessionStore: backend_metadata must be valid JSON'
    );
  });
});

describe('PostgresAcpSessionStore.update', () => {
  beforeEach(() => pgMock.reset());

  it('updates only within the requested tenant-owner scope and returns the persisted row', async () => {
    const { store, pool } = await createStartedStore();
    const updated = makeRecord({ status: 'paused', currentBackendRunId: 'backend-run-2' });
    pool.query.mockResolvedValueOnce({
      rows: [makeRow({ status: 'paused', current_backend_run_id: 'backend-run-2' })],
    });

    const result = await store.update(updated, scope);

    expect(result).toEqual(updated);
    const [sql, params] = pool.query.mock.calls[0];
    expect(normalizeSql(sql)).toContain('UPDATE "public"."acp_sessions"');
    expect(normalizeSql(sql)).toContain(
      'WHERE session_id = $1 AND tenant_id = $2 AND owner_key_id = $3'
    );
    expect(normalizeSql(sql)).toContain('RETURNING');
    expect(params?.slice(0, 3)).toEqual(['session-1', 'tenant-a', 'owner-a']);
    expect(params).toContain('backend-run-2');
    expect(params).toContain('paused');
  });

  it('does not overwrite durable identity columns during update', async () => {
    const { store, pool } = await createStartedStore();
    const tampered = makeRecord({
      conversationId: 'conversation-tampered',
      transcriptId: 'transcript-tampered',
      parentSessionId: 'parent-tampered',
      rootSessionId: 'root-tampered',
      correlationId: 'correlation-tampered',
      resumeFromSessionId: 'resume-tampered',
      createdAt: 9_999,
      status: 'paused',
    });
    pool.query.mockResolvedValueOnce({ rows: [makeRow({ status: 'paused' })] });

    const result = await store.update(tampered, scope);

    const [sql, params] = pool.query.mock.calls[0];
    const normalized = normalizeSql(sql);
    expect(normalized).not.toContain('conversation_id =');
    expect(normalized).not.toContain('transcript_id =');
    expect(normalized).not.toContain('parent_session_id =');
    expect(normalized).not.toContain('root_session_id =');
    expect(normalized).not.toContain('correlation_id =');
    expect(normalized).not.toContain('resume_from_session_id =');
    expect(normalized).not.toContain('created_at =');
    expect(params).not.toContain('conversation-tampered');
    expect(params).not.toContain('transcript-tampered');
    expect(params).not.toContain('parent-tampered');
    expect(params).not.toContain('root-tampered');
    expect(params).not.toContain('correlation-tampered');
    expect(params).not.toContain('resume-tampered');
    expect(params).not.toContain(9_999);
    expect(result).toEqual(makeRecord({ status: 'paused' }));
  });

  it('returns null instead of updating when the tenant-owner scope does not match', async () => {
    const { store, pool } = await createStartedStore();
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await store.update(makeRecord({ tenantId: 'tenant-b' }), {
      tenantId: 'tenant-b',
      ownerKeyId: 'owner-a',
    });

    expect(result).toBeNull();
    expect(pool.query.mock.calls[0][1]?.slice(0, 3)).toEqual(['session-1', 'tenant-b', 'owner-a']);
  });

  it('rejects records whose tenant or owner does not match the requested scope', async () => {
    const { store, pool } = await createStartedStore();

    await expect(
      store.update(makeRecord({ tenantId: 'tenant-b' }), scope)
    ).rejects.toThrow('record scope does not match requested scope');

    expect(pool.query).not.toHaveBeenCalled();
  });
});
