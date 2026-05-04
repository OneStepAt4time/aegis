import { describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

import {
  AcpDurableIdentityError,
  AcpValidationError,
  type AcpActionRecord,
  type AcpSessionScope,
} from '../services/acp/index.js';
import { PostgresAcpActionQueue } from '../services/acp/postgres-action-queue.js';

type MockQueryResult = { rows: unknown[] };
type MockQueryFn = ReturnType<
  typeof vi.fn<(sql: string, params?: unknown[]) => Promise<MockQueryResult>>
>;

const scope: AcpSessionScope = {
  tenantId: 'tenant-a',
  ownerKeyId: 'owner-a',
};

function makeMockPool() {
  const query = vi.fn<(sql: string, params?: unknown[]) => Promise<MockQueryResult>>();
  const end = vi.fn<() => Promise<void>>();

  query.mockResolvedValue({ rows: [] });
  end.mockResolvedValue();

  return { query, end };
}

function createQueue(config?: {
  schemaName?: string;
  tableName?: string;
  poolMax?: number;
}): {
  queue: PostgresAcpActionQueue;
  mocks: { query: MockQueryFn; end: ReturnType<typeof vi.fn<() => Promise<void>>> };
} {
  const mocks = makeMockPool();
  const queue = new PostgresAcpActionQueue({
    url: 'postgresql://test:test@localhost:5432/aegis_test',
    ...config,
  });

  Object.defineProperty(queue, 'pool', {
    value: {
      query: mocks.query,
      end: mocks.end,
    },
    writable: true,
  });

  return { queue, mocks };
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    action_id: 'action-1',
    session_id: 'session-1',
    tenant_id: 'tenant-a',
    owner_key_id: 'owner-a',
    action_type: 'prompt',
    idempotency_key: null,
    status: 'queued',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    available_at: new Date('2026-01-01T00:00:00.000Z'),
    leased_until: null,
    attempt_count: 0,
    approval_id: null,
    control_request_id: null,
    metadata: null,
    result_metadata: null,
    error_metadata: null,
    completed_at: null,
    failed_at: null,
    cancelled_at: null,
    ...overrides,
  };
}

function baseActionInput(overrides: Partial<Parameters<PostgresAcpActionQueue['enqueue']>[0]> = {}) {
  return {
    tenantId: 'tenant-a',
    ownerKeyId: 'owner-a',
    sessionId: 'session-1',
    actionId: 'action-1',
    type: 'prompt' as const,
    ...overrides,
  };
}

describe('PostgresAcpActionQueue constructor', () => {
  it('rejects invalid schema and table identifiers before SQL interpolation', () => {
    expect(
      () =>
        new PostgresAcpActionQueue({
          url: 'postgresql://localhost/test',
          schemaName: 'public; DROP TABLE acp_actions',
        })
    ).toThrow('invalid schema name');
    expect(
      () =>
        new PostgresAcpActionQueue({
          url: 'postgresql://localhost/test',
          tableName: 'acp-actions',
        })
      ).toThrow('invalid table name');
  });

  it('rejects invalid pool sizes before creating a Postgres pool', () => {
    expect(() => new PostgresAcpActionQueue({ url: 'postgresql://localhost/test', poolMax: 0 }))
      .toThrow('poolMax');
    expect(() => new PostgresAcpActionQueue({ url: 'postgresql://localhost/test', poolMax: 1.5 }))
      .toThrow('poolMax');
  });

  it('creates the typed action table and scoped idempotency index on start', async () => {
    const { queue, mocks } = createQueue({ schemaName: 'tenant_1', tableName: 'acp_actions' });
    mocks.query.mockResolvedValue({ rows: [{ ok: 1 }] });

    await queue.start();

    const schemaSql = mocks.query.mock.calls.map(call => call[0] as string).join('\n');
    expect(schemaSql).toContain('CREATE SCHEMA IF NOT EXISTS "tenant_1"');
    expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS "tenant_1"."acp_actions"');
    expect(schemaSql).toContain('action_id');
    expect(schemaSql).toContain('session_id');
    expect(schemaSql).toContain('tenant_id');
    expect(schemaSql).toContain('owner_key_id');
    expect(schemaSql).toContain('action_type');
    expect(schemaSql).toContain('idempotency_key');
    expect(schemaSql).toContain('status');
    expect(schemaSql).toContain('metadata');
    expect(schemaSql).toContain('result_metadata');
    expect(schemaSql).toContain('error_metadata');
    expect(schemaSql).toContain('WHERE idempotency_key IS NOT NULL');
    expect(schemaSql).toContain('SELECT 1 AS ok');
  });

  it('clears and closes the pool when startup fails so initialization can retry', async () => {
    const query = vi
      .spyOn(Pool.prototype, 'query')
      .mockRejectedValueOnce(new Error('schema unavailable'))
      .mockResolvedValue({ rows: [{ ok: 1 }] } as never);
    const end = vi.spyOn(Pool.prototype, 'end').mockResolvedValue(undefined as never);
    const queue = new PostgresAcpActionQueue({ url: 'postgresql://localhost/test' });

    await expect(queue.start()).rejects.toThrow('schema unavailable');
    expect(end).toHaveBeenCalledTimes(1);
    await expect(queue.stop()).resolves.toBeUndefined();
    await queue.start();

    expect(end).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.length).toBeGreaterThan(1);
    vi.restoreAllMocks();
  });
});

describe('PostgresAcpActionQueue.enqueue()', () => {
  it('validates action input and parameterizes values when inserting', async () => {
    const { queue, mocks } = createQueue();
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          makeRow({
            action_id: 'action-1',
            idempotency_key: 'client-key-1',
            metadata: { source: 'api' },
          }),
        ],
      });

    const record = await queue.enqueue(
      baseActionInput({
        idempotencyKey: 'client-key-1',
        metadata: { source: 'api' },
      }),
      { availableAt: new Date('2026-01-01T00:00:00.000Z') }
    );

    expect(record).toMatchObject<AcpActionRecord>({
      actionId: 'action-1',
      sessionId: 'session-1',
      tenantId: 'tenant-a',
      ownerKeyId: 'owner-a',
      actionType: 'prompt',
      idempotencyKey: 'client-key-1',
      status: 'queued',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      availableAt: new Date('2026-01-01T00:00:00.000Z'),
      attemptCount: 0,
      metadata: { source: 'api' },
    });
    const insertCall = mocks.query.mock.calls.find(call => (call[0] as string).includes('INSERT'));
    expect(insertCall).toBeDefined();
    expect(insertCall?.[0]).toContain('"public"."acp_actions"');
    expect(insertCall?.[0]).toContain('$1');
    expect(insertCall?.[0]).not.toContain('client-key-1');
    expect(insertCall?.[1]).toEqual([
      'action-1',
      'session-1',
      'tenant-a',
      'owner-a',
      'prompt',
      'client-key-1',
      new Date('2026-01-01T00:00:00.000Z'),
      { source: 'api' },
      undefined,
      undefined,
    ]);
  });

  it('returns an existing scoped action for a repeated explicit idempotency key', async () => {
    const { queue, mocks } = createQueue();
    mocks.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          action_id: 'existing-action',
          idempotency_key: 'client-key-1',
        }),
      ],
    });

    const record = await queue.enqueue(
      baseActionInput({
        actionId: 'new-action',
        idempotencyKey: 'client-key-1',
      })
    );

    expect(record.actionId).toBe('existing-action');
    expect(record.idempotencyKey).toBe('client-key-1');
    expect(mocks.query.mock.calls).toHaveLength(1);
    expect(mocks.query.mock.calls[0][0]).toContain('WHERE tenant_id = $1');
    expect(mocks.query.mock.calls[0][1]).toEqual([
      'tenant-a',
      'owner-a',
      'session-1',
      'client-key-1',
    ]);
  });

  it('rejects an idempotency row that does not match the requested scope', async () => {
    const { queue, mocks } = createQueue();
    mocks.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          tenant_id: 'tenant-b',
          idempotency_key: 'client-key-1',
        }),
      ],
    });

    await expect(
      queue.enqueue(
        baseActionInput({
          idempotencyKey: 'client-key-1',
        })
      )
    ).rejects.toBeInstanceOf(AcpDurableIdentityError);
  });

  it('stores an empty metadata object when action metadata is omitted', async () => {
    const { queue, mocks } = createQueue();
    mocks.query.mockResolvedValueOnce({ rows: [makeRow({ metadata: {} })] });

    await queue.enqueue(baseActionInput());

    const insertCall = mocks.query.mock.calls.find(call => (call[0] as string).includes('INSERT'));
    expect(insertCall?.[1]?.[7]).toEqual({});
  });

  it('rejects JSON-RPC request ids instead of using them for idempotency', async () => {
    const { queue, mocks } = createQueue();
    const decodedAction: unknown = {
      ...baseActionInput(),
      jsonRpcRequestId: 99,
    };

    await expect(queue.enqueue(decodedAction as Parameters<PostgresAcpActionQueue['enqueue']>[0]))
      .rejects.toBeInstanceOf(AcpDurableIdentityError);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('does not use action ids as an idempotency return-existing path', async () => {
    const { queue, mocks } = createQueue();
    mocks.query.mockResolvedValueOnce({ rows: [] });

    await expect(queue.enqueue(baseActionInput())).rejects.toThrow('action id already exists');

    const [sql] = mocks.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (action_id) DO NOTHING');
    expect(sql).not.toContain('DO UPDATE');
  });

  it('rejects a returned action row that does not match the requested scope', async () => {
    const { queue, mocks } = createQueue();
    mocks.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          tenant_id: 'tenant-b',
          owner_key_id: 'owner-b',
        }),
      ],
    });

    await expect(queue.enqueue(baseActionInput())).rejects.toBeInstanceOf(AcpDurableIdentityError);
  });

  it('rejects unsafe action metadata before persistence', async () => {
    const { queue, mocks } = createQueue();

    await expect(
      queue.enqueue(
        baseActionInput({
          metadata: { nested: JSON.parse('{"value":1}') } as Parameters<
            PostgresAcpActionQueue['enqueue']
          >[0]['metadata'],
        })
      )
    ).rejects.toBeInstanceOf(AcpValidationError);
    await expect(
      queue.enqueue(baseActionInput({ metadata: { authToken: 'secret' } }))
    ).rejects.toThrow('metadata key is sensitive');
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects invalid availability timestamps before persistence', async () => {
    const { queue, mocks } = createQueue();

    await expect(
      queue.enqueue(baseActionInput(), { availableAt: new Date(Number.NaN) })
    ).rejects.toBeInstanceOf(AcpValidationError);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

describe('PostgresAcpActionQueue.leaseNext()', () => {
  it('claims only queued available actions in the requested scope with SKIP LOCKED', async () => {
    const { queue, mocks } = createQueue();
    mocks.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          status: 'leased',
          leased_until: new Date('2026-01-01T00:05:00.000Z'),
          attempt_count: 1,
        }),
      ],
    });

    const leased = await queue.leaseNext(scope, {
      now: new Date('2026-01-01T00:00:00.000Z'),
      leaseUntil: new Date('2026-01-01T00:05:00.000Z'),
    });

    expect(leased?.status).toBe('leased');
    expect(leased?.attemptCount).toBe(1);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("status = 'queued'");
    expect(sql).toContain('available_at <= $3');
    expect(sql).toContain('attempt_count = attempt_count + 1');
    expect(params).toEqual([
      'tenant-a',
      'owner-a',
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-01T00:05:00.000Z'),
    ]);
  });

  it('rejects a leased row that does not match the requested scope', async () => {
    const { queue, mocks } = createQueue();
    mocks.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          tenant_id: 'tenant-b',
          status: 'leased',
          leased_until: new Date('2026-01-01T00:05:00.000Z'),
          attempt_count: 1,
        }),
      ],
    });

    await expect(queue.leaseNext(scope, {
      now: new Date('2026-01-01T00:00:00.000Z'),
      leaseUntil: new Date('2026-01-01T00:05:00.000Z'),
    })).rejects.toBeInstanceOf(AcpDurableIdentityError);
  });

  it('rejects invalid or expired lease windows before querying', async () => {
    const { queue, mocks } = createQueue();
    const now = new Date('2026-01-01T00:00:00.000Z');

    await expect(
      queue.leaseNext(scope, {
        now,
        leaseUntil: now,
      })
    ).rejects.toThrow('leaseUntil must be after now');
    await expect(
      queue.leaseNext(scope, {
        now: new Date(Number.NaN),
        leaseUntil: new Date('2026-01-01T00:05:00.000Z'),
      })
    ).rejects.toBeInstanceOf(AcpValidationError);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

describe('PostgresAcpActionQueue status updates', () => {
  it('completes only leased actions in the requested scope', async () => {
    const { queue, mocks } = createQueue();
    mocks.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          status: 'completed',
          result_metadata: { delivered: true },
          completed_at: new Date('2026-01-01T00:06:00.000Z'),
        }),
      ],
    });

    const completed = await queue.complete('action-1', scope, {
      resultMetadata: { delivered: true },
      now: new Date('2026-01-01T00:06:00.000Z'),
    });

    expect(completed?.status).toBe('completed');
    expect(completed?.resultMetadata).toEqual({ delivered: true });
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain('WHERE action_id = $1');
    expect(sql).toContain('tenant_id = $2');
    expect(sql).toContain('owner_key_id = $3');
    expect(sql).toContain("status = 'leased'");
    expect(params).toEqual([
      'action-1',
      'tenant-a',
      'owner-a',
      { delivered: true },
      new Date('2026-01-01T00:06:00.000Z'),
    ]);
  });

  it('marks leased actions failed with validated error metadata', async () => {
    const { queue, mocks } = createQueue();
    mocks.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          status: 'failed',
          error_metadata: { reason: 'agent-exit' },
          failed_at: new Date('2026-01-01T00:07:00.000Z'),
        }),
      ],
    });

    const failed = await queue.fail('action-1', scope, {
      errorMetadata: { reason: 'agent-exit' },
      now: new Date('2026-01-01T00:07:00.000Z'),
    });

    expect(failed?.status).toBe('failed');
    expect(failed?.errorMetadata).toEqual({ reason: 'agent-exit' });
    expect(mocks.query.mock.calls[0][0]).toContain("status = 'leased'");
  });

  it('cancels only queued or leased actions in the requested scope', async () => {
    const { queue, mocks } = createQueue();
    mocks.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          status: 'cancelled',
          error_metadata: { reason: 'client-cancelled' },
          cancelled_at: new Date('2026-01-01T00:08:00.000Z'),
        }),
      ],
    });

    const cancelled = await queue.cancel('action-1', scope, {
      errorMetadata: { reason: 'client-cancelled' },
      now: new Date('2026-01-01T00:08:00.000Z'),
    });

    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.errorMetadata).toEqual({ reason: 'client-cancelled' });
    expect(mocks.query.mock.calls[0][0]).toContain("status IN ('queued', 'leased')");
  });

  it('returns null without mutating cross-scope actions', async () => {
    const { queue, mocks } = createQueue();
    mocks.query.mockResolvedValueOnce({ rows: [] });

    const result = await queue.complete(
      'action-1',
      { tenantId: 'tenant-b', ownerKeyId: 'owner-a' },
      { now: new Date('2026-01-01T00:09:00.000Z') }
    );

    expect(result).toBeNull();
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain('tenant_id = $2');
    expect(sql).toContain('owner_key_id = $3');
    expect(params?.slice(0, 3)).toEqual(['action-1', 'tenant-b', 'owner-a']);
  });

  it('rejects a completed row that does not match the requested action scope', async () => {
    const { queue, mocks } = createQueue();
    mocks.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          action_id: 'action-other',
          status: 'completed',
          completed_at: new Date('2026-01-01T00:06:00.000Z'),
        }),
      ],
    });

    await expect(queue.complete('action-1', scope, {
      now: new Date('2026-01-01T00:06:00.000Z'),
    })).rejects.toBeInstanceOf(AcpDurableIdentityError);
  });

  it('rejects invalid completion timestamps before querying', async () => {
    const { queue, mocks } = createQueue();

    await expect(
      queue.complete('action-1', scope, { now: new Date(Number.NaN) })
    ).rejects.toBeInstanceOf(AcpValidationError);
    await expect(
      queue.fail('action-1', scope, { now: new Date(Number.NaN) })
    ).rejects.toBeInstanceOf(AcpValidationError);
    await expect(
      queue.cancel('action-1', scope, { now: new Date(Number.NaN) })
    ).rejects.toBeInstanceOf(AcpValidationError);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
