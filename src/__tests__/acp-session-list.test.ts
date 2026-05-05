import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AcpSessionService,
  AcpValidationError,
  MemoryAcpSessionStore,
  PostgresAcpSessionStore,
  type AcpListSessionsInput,
  type AcpSessionRecord,
  type AcpSessionScope,
  type AcpSessionStore,
} from '../services/acp/index.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const scope: AcpSessionScope = { tenantId: 'tenant-a', ownerKeyId: 'owner-a' };
const otherScope: AcpSessionScope = { tenantId: 'tenant-b', ownerKeyId: 'owner-b' };

function makeRecord(overrides: Partial<AcpSessionRecord> = {}): AcpSessionRecord {
  return {
    id: 'session-1',
    tenantId: scope.tenantId,
    ownerKeyId: scope.ownerKeyId,
    conversationId: 'conversation-1',
    transcriptId: 'transcript-1',
    status: 'running',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MemoryAcpSessionStore.list
// ---------------------------------------------------------------------------

describe('MemoryAcpSessionStore.list', () => {
  it('returns all sessions in scope', async () => {
    const store = new MemoryAcpSessionStore();
    const a = makeRecord({ id: 'session-a', updatedAt: 1_000 });
    const b = makeRecord({ id: 'session-b', updatedAt: 2_000 });
    await store.create(a);
    await store.create(b);

    const result = await store.list({ ...scope });

    expect(result).toHaveLength(2);
    expect(result.map(r => r.id)).toContain('session-a');
    expect(result.map(r => r.id)).toContain('session-b');
  });

  it('excludes sessions outside the requested tenant-owner scope', async () => {
    const store = new MemoryAcpSessionStore();
    await store.create(makeRecord({ id: 'mine' }));
    await store.create(makeRecord({ id: 'theirs', ...otherScope }));

    const result = await store.list({ ...scope });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('mine');
  });

  it('returns an empty array when no sessions match the scope', async () => {
    const store = new MemoryAcpSessionStore();

    const result = await store.list({ ...scope });

    expect(result).toEqual([]);
  });

  it('filters by status when statuses are provided', async () => {
    const store = new MemoryAcpSessionStore();
    await store.create(makeRecord({ id: 'running-1', status: 'running' }));
    await store.create(makeRecord({ id: 'idle-1', status: 'idle' }));
    await store.create(makeRecord({ id: 'closed-1', status: 'closed' }));

    const result = await store.list({ ...scope, statuses: ['running', 'idle'] });

    expect(result).toHaveLength(2);
    expect(result.map(r => r.id).sort()).toEqual(['idle-1', 'running-1']);
  });

  it('filters by updatedAfter when provided', async () => {
    const store = new MemoryAcpSessionStore();
    await store.create(makeRecord({ id: 'old', updatedAt: 1_000 }));
    await store.create(makeRecord({ id: 'new', updatedAt: 3_000 }));

    const result = await store.list({ ...scope, updatedAfter: 2_000 });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('new');
  });

  it('respects the limit option', async () => {
    const store = new MemoryAcpSessionStore();
    for (let i = 0; i < 5; i++) {
      await store.create(makeRecord({ id: `session-${i}`, updatedAt: i * 1_000 }));
    }

    const result = await store.list({ ...scope, limit: 3 });

    expect(result).toHaveLength(3);
  });

  it('sorts results by updatedAt descending', async () => {
    const store = new MemoryAcpSessionStore();
    await store.create(makeRecord({ id: 'first', updatedAt: 1_000 }));
    await store.create(makeRecord({ id: 'third', updatedAt: 3_000 }));
    await store.create(makeRecord({ id: 'second', updatedAt: 2_000 }));

    const result = await store.list({ ...scope });

    expect(result.map(r => r.id)).toEqual(['third', 'second', 'first']);
  });

  it('returns cloned records so mutations do not affect stored state', async () => {
    const store = new MemoryAcpSessionStore();
    await store.create(makeRecord({ id: 'session-a' }));

    const [record] = await store.list({ ...scope });
    record!.status = 'closed';

    const [unchanged] = await store.list({ ...scope });
    expect(unchanged!.status).toBe('running');
  });

  it('throws AcpValidationError when tenantId is empty', async () => {
    const store = new MemoryAcpSessionStore();

    await expect(
      store.list({ tenantId: '', ownerKeyId: 'owner-a' })
    ).rejects.toThrow(AcpValidationError);
  });

  it('throws AcpValidationError when ownerKeyId is empty', async () => {
    const store = new MemoryAcpSessionStore();

    await expect(
      store.list({ tenantId: 'tenant-a', ownerKeyId: '' })
    ).rejects.toThrow(AcpValidationError);
  });
});

// ---------------------------------------------------------------------------
// PostgresAcpSessionStore.list
// ---------------------------------------------------------------------------

interface MockQueryResult {
  rows: unknown[];
}

type MockQuery = ReturnType<
  typeof vi.fn<(sql: string, params?: readonly unknown[]) => Promise<MockQueryResult>>
>;

interface MockPool {
  query: MockQuery;
  end: ReturnType<typeof vi.fn<() => Promise<void>>>;
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
  const Pool = vi.fn(function MockPoolConstructor() {
    const pool = makePool();
    pools.push(pool);
    return pool;
  });

  return {
    Pool,
    pools,
    latestPool(): MockPool {
      const pool = pools.at(-1);
      if (!pool) throw new Error('expected a mocked pg Pool to be constructed');
      return pool;
    },
    reset(): void {
      pools.length = 0;
      Pool.mockClear();
    },
  };
});

vi.mock('pg', () => ({ Pool: pgMock.Pool }));

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: 'session-1',
    tenant_id: 'tenant-a',
    owner_key_id: 'owner-a',
    acp_agent_session_id: null,
    claude_session_id: null,
    conversation_id: 'conversation-1',
    transcript_id: 'transcript-1',
    parent_session_id: null,
    root_session_id: null,
    correlation_id: null,
    resume_from_session_id: null,
    current_backend_run_id: null,
    status: 'running',
    created_at: '1700000000000',
    updated_at: '1700000000000',
    closed_at: null,
    failed_at: null,
    backend_metadata: null,
    ...overrides,
  };
}

async function createStartedStore(): Promise<{ store: PostgresAcpSessionStore; pool: MockPool }> {
  const store = new PostgresAcpSessionStore({
    url: 'postgresql://aegis:aegis@localhost:5432/aegis_test',
  });
  await store.start();
  const pool = pgMock.latestPool();
  pool.query.mockClear();
  return { store, pool };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('PostgresAcpSessionStore.list', () => {
  beforeEach(() => pgMock.reset());

  it('queries within tenant-owner scope using parameterized values', async () => {
    const { store, pool } = await createStartedStore();
    pool.query.mockResolvedValueOnce({ rows: [makeRow()] });

    await store.list({ ...scope });

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0]!;
    expect(normalizeSql(sql)).toContain('WHERE tenant_id = $1 AND owner_key_id = $2');
    expect(params).toContain('tenant-a');
    expect(params).toContain('owner-a');
  });

  it('returns rows mapped to session records', async () => {
    const { store, pool } = await createStartedStore();
    pool.query.mockResolvedValueOnce({
      rows: [makeRow({ session_id: 'session-x', status: 'idle' })],
    });

    const result = await store.list({ ...scope });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('session-x');
    expect(result[0]!.status).toBe('idle');
  });

  it('returns an empty array when no rows are found', async () => {
    const { store, pool } = await createStartedStore();
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await store.list({ ...scope });

    expect(result).toEqual([]);
  });

  it('includes a status IN filter when statuses are provided', async () => {
    const { store, pool } = await createStartedStore();

    await store.list({ ...scope, statuses: ['running', 'paused'] });

    const [sql, params] = pool.query.mock.calls[0]!;
    expect(normalizeSql(sql)).toMatch(/status = ANY\(\$/);
    expect(params).toContainEqual(['running', 'paused']);
  });

  it('includes an updatedAfter filter when provided', async () => {
    const { store, pool } = await createStartedStore();

    await store.list({ ...scope, updatedAfter: 1_700_000_000_000 });

    const [sql, params] = pool.query.mock.calls[0]!;
    expect(normalizeSql(sql)).toContain('updated_at >');
    expect(params).toContain(1_700_000_000_000);
  });

  it('applies a default LIMIT to the query', async () => {
    const { store, pool } = await createStartedStore();

    await store.list({ ...scope });

    const [sql] = pool.query.mock.calls[0]!;
    expect(normalizeSql(sql)).toContain('LIMIT');
  });

  it('applies the caller-supplied limit when provided', async () => {
    const { store, pool } = await createStartedStore();

    await store.list({ ...scope, limit: 7 });

    const [, params] = pool.query.mock.calls[0]!;
    expect(params).toContain(7);
  });

  it('orders results by updated_at descending', async () => {
    const { store, pool } = await createStartedStore();

    await store.list({ ...scope });

    const [sql] = pool.query.mock.calls[0]!;
    expect(normalizeSql(sql)).toContain('ORDER BY updated_at DESC');
  });

  it('throws when not started', async () => {
    const store = new PostgresAcpSessionStore({
      url: 'postgresql://localhost/test',
    });

    await expect(store.list({ ...scope })).rejects.toThrow('not been started');
  });
});

// ---------------------------------------------------------------------------
// AcpSessionService.listSessions
// ---------------------------------------------------------------------------

class StubAcpSessionStore implements AcpSessionStore {
  readonly created: AcpSessionRecord[] = [];

  async create(record: AcpSessionRecord): Promise<void> {
    this.created.push({ ...record });
  }

  async get(_id: string, _scope: AcpSessionScope): Promise<AcpSessionRecord | null> {
    return null;
  }

  async update(_record: AcpSessionRecord, _scope: AcpSessionScope): Promise<AcpSessionRecord | null> {
    return null;
  }

  async list(input: AcpListSessionsInput): Promise<AcpSessionRecord[]> {
    return this.created.filter(
      r => r.tenantId === input.tenantId && r.ownerKeyId === input.ownerKeyId
    );
  }
}

describe('AcpSessionService.listSessions', () => {
  it('returns sessions from the underlying store', async () => {
    const store = new StubAcpSessionStore();
    store.created.push(
      makeRecord({ id: 'session-a' }),
      makeRecord({ id: 'session-b' })
    );
    const service = new AcpSessionService(store);

    const result = await service.listSessions(scope);

    expect(result).toHaveLength(2);
    expect(result.map(r => r.id).sort()).toEqual(['session-a', 'session-b']);
  });

  it('rejects an empty tenantId', async () => {
    const service = new AcpSessionService(new StubAcpSessionStore());

    await expect(
      service.listSessions({ tenantId: '', ownerKeyId: 'owner-a' })
    ).rejects.toThrow(AcpValidationError);
  });

  it('rejects an empty ownerKeyId', async () => {
    const service = new AcpSessionService(new StubAcpSessionStore());

    await expect(
      service.listSessions({ tenantId: 'tenant-a', ownerKeyId: '' })
    ).rejects.toThrow(AcpValidationError);
  });

  it('passes status filter through to the store', async () => {
    const store = new StubAcpSessionStore();
    store.created.push(
      makeRecord({ id: 'running-1', status: 'running' }),
      makeRecord({ id: 'idle-1', status: 'idle' })
    );

    // Override list to capture the input
    let capturedInput: AcpListSessionsInput | undefined;
    store.list = async (input: AcpListSessionsInput) => {
      capturedInput = input;
      return [];
    };

    const service = new AcpSessionService(store);
    await service.listSessions(scope, { statuses: ['running'] });

    expect(capturedInput?.statuses).toEqual(['running']);
  });

  it('passes limit through to the store', async () => {
    const store = new StubAcpSessionStore();
    let capturedInput: AcpListSessionsInput | undefined;
    store.list = async (input: AcpListSessionsInput) => {
      capturedInput = input;
      return [];
    };

    const service = new AcpSessionService(store);
    await service.listSessions(scope, { limit: 10 });

    expect(capturedInput?.limit).toBe(10);
  });
});
