import { describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

import {
  AcpDurableIdentityError,
  AcpValidationError,
  type AcpSessionScope,
} from '../services/acp/index.js';
import { PostgresAcpPauseInterventionStore } from '../services/acp/postgres-pause-intervention-store.js';

type MockQueryResult = { rows: unknown[] };
type MockQueryFn = ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<MockQueryResult>>>;

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

function createStore(config?: { schemaName?: string; tableName?: string; poolMax?: number }): {
  store: PostgresAcpPauseInterventionStore;
  mocks: { query: MockQueryFn; end: ReturnType<typeof vi.fn<() => Promise<void>>> };
} {
  const mocks = makeMockPool();
  const store = new PostgresAcpPauseInterventionStore({
    url: 'postgresql://test:test@localhost:5432/aegis_test',
    ...config,
  });

  Object.defineProperty(store, 'pool', {
    value: {
      query: mocks.query,
      end: mocks.end,
    },
    writable: true,
  });

  return { store, mocks };
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    pause_id: 'pause-1',
    session_id: 'session-1',
    tenant_id: 'tenant-a',
    owner_key_id: 'owner-a',
    status: 'paused',
    idempotency_key: null,
    reason: 'operator requested review',
    requested_by: 'operator-1',
    requested_at: new Date('2026-01-01T00:00:00.000Z'),
    metadata: {},
    intervention_id: null,
    intervention_by: null,
    intervention_started_at: null,
    intervention_completed_by: null,
    intervention_completed_at: null,
    guidance: null,
    resume_id: null,
    resumed_by: null,
    resumed_at: null,
    resume_metadata: null,
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function pauseInput(overrides: Partial<Parameters<PostgresAcpPauseInterventionStore['pause']>[0]> = {}) {
  return {
    tenantId: 'tenant-a',
    ownerKeyId: 'owner-a',
    sessionId: 'session-1',
    pauseId: 'pause-1',
    reason: 'operator requested review',
    requestedBy: 'operator-1',
    ...overrides,
  };
}

describe('PostgresAcpPauseInterventionStore constructor', () => {
  it('rejects unsafe identifiers and pool sizes before SQL interpolation', () => {
    expect(
      () =>
        new PostgresAcpPauseInterventionStore({
          url: 'postgresql://localhost/test',
          schemaName: 'public; DROP TABLE acp_pause_interventions',
        })
    ).toThrow('invalid schema name');
    expect(
      () =>
        new PostgresAcpPauseInterventionStore({
          url: 'postgresql://localhost/test',
          tableName: 'acp-pause-interventions',
        })
    ).toThrow('invalid table name');
    expect(
      () => new PostgresAcpPauseInterventionStore({ url: 'postgresql://localhost/test', poolMax: 0 })
    ).toThrow('poolMax');
  });

  it('creates the lifecycle table with scoped active and idempotency indexes', async () => {
    const { store, mocks } = createStore({ schemaName: 'tenant_1', tableName: 'acp_pause_interventions' });
    mocks.query.mockResolvedValue({ rows: [{ ok: 1 }] });

    await store.start();

    const schemaSql = mocks.query.mock.calls.map(call => call[0]).join('\n');
    expect(schemaSql).toContain('CREATE SCHEMA IF NOT EXISTS "tenant_1"');
    expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS "tenant_1"."acp_pause_interventions"');
    expect(schemaSql).toContain('pause_id');
    expect(schemaSql).toContain('session_id');
    expect(schemaSql).toContain('tenant_id');
    expect(schemaSql).toContain('owner_key_id');
    expect(schemaSql).toContain('status');
    expect(schemaSql).toContain('intervention_id');
    expect(schemaSql).toContain('resume_id');
    expect(schemaSql).toContain('WHERE idempotency_key IS NOT NULL');
    expect(schemaSql).toContain("WHERE status IN ('paused', 'intervening')");
    expect(schemaSql).toContain('SELECT 1 AS ok');
  });

  it('clears and closes the pool when startup fails so initialization can retry', async () => {
    const query = vi
      .spyOn(Pool.prototype, 'query')
      .mockRejectedValueOnce(new Error('schema unavailable'))
      .mockResolvedValue({ rows: [{ ok: 1 }] } as never);
    const end = vi.spyOn(Pool.prototype, 'end').mockResolvedValue(undefined as never);
    const store = new PostgresAcpPauseInterventionStore({ url: 'postgresql://localhost/test' });

    await expect(store.start()).rejects.toThrow('schema unavailable');
    expect(end).toHaveBeenCalledTimes(1);
    await expect(store.stop()).resolves.toBeUndefined();
    await store.start();

    expect(query.mock.calls.length).toBeGreaterThan(1);
    vi.restoreAllMocks();
  });
});

describe('PostgresAcpPauseInterventionStore.pause()', () => {
  it('validates, serializes, and parameterizes a scoped pause request', async () => {
    const { store, mocks } = createStore();
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [makeRow({ idempotency_key: 'pause-key-1', metadata: { source: 'api' } })] });

    const record = await store.pause(
      pauseInput({ idempotencyKey: 'pause-key-1', metadata: { source: 'api' } })
    );

    expect(record).toMatchObject({
      pauseId: 'pause-1',
      sessionId: 'session-1',
      tenantId: 'tenant-a',
      ownerKeyId: 'owner-a',
      status: 'paused',
      reason: 'operator requested review',
      requestedBy: 'operator-1',
      idempotencyKey: 'pause-key-1',
      metadata: { source: 'api' },
    });
    const insertCall = mocks.query.mock.calls.find(call => call[0].includes('INSERT'));
    expect(insertCall).toBeDefined();
    expect(insertCall?.[0]).toContain('$1');
    expect(insertCall?.[0]).not.toContain('operator requested review');
    expect(insertCall?.[1]).toEqual([
      'pause-1',
      'session-1',
      'tenant-a',
      'owner-a',
      'pause-key-1',
      'operator requested review',
      'operator-1',
      undefined,
      { source: 'api' },
    ]);
  });

  it('returns an existing scoped pause for a repeated idempotency key', async () => {
    const { store, mocks } = createStore();
    mocks.query.mockResolvedValueOnce({ rows: [makeRow({ pause_id: 'existing-pause', idempotency_key: 'pause-key-1' })] });

    const record = await store.pause(pauseInput({ pauseId: 'new-pause', idempotencyKey: 'pause-key-1' }));

    expect(record.pauseId).toBe('existing-pause');
    expect(record.idempotencyKey).toBe('pause-key-1');
    expect(mocks.query.mock.calls).toHaveLength(1);
    expect(mocks.query.mock.calls[0][0]).toContain('WHERE tenant_id = $1');
    expect(mocks.query.mock.calls[0][1]).toEqual(['tenant-a', 'owner-a', 'session-1', 'pause-key-1']);
  });

  it('rejects unsafe metadata and JSON-RPC request ids before persistence', async () => {
    const { store, mocks } = createStore();
    const decodedPause: unknown = {
      ...pauseInput({ metadata: { source: 'api' } }),
      jsonRpcRequestId: 7,
    };

    await expect(store.pause(pauseInput({ metadata: { apiToken: 'secret' } }))).rejects.toBeInstanceOf(AcpValidationError);
    await expect(store.pause(decodedPause as Parameters<PostgresAcpPauseInterventionStore['pause']>[0])).rejects.toBeInstanceOf(AcpDurableIdentityError);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('does not treat duplicate pause ids as idempotent success', async () => {
    const { store, mocks } = createStore();
    mocks.query.mockResolvedValueOnce({ rows: [] });

    await expect(store.pause(pauseInput())).rejects.toThrow('pause id already exists');

    const [sql] = mocks.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (pause_id) DO NOTHING');
    expect(sql).not.toContain('DO UPDATE');
  });
});

describe('PostgresAcpPauseInterventionStore lifecycle', () => {
  it('reads only the active pause or intervention in the requested scope', async () => {
    const { store, mocks } = createStore();
    mocks.query.mockResolvedValueOnce({ rows: [makeRow({ status: 'intervening', intervention_id: 'intervention-1' })] });

    const active = await store.getActive('session-1', scope);

    expect(active?.status).toBe('intervening');
    expect(active?.interventionId).toBe('intervention-1');
    expect(mocks.query.mock.calls[0][0]).toContain("status IN ('paused', 'intervening')");
    expect(mocks.query.mock.calls[0][1]).toEqual(['session-1', 'tenant-a', 'owner-a']);
  });

  it('starts intervention by transitioning the active pause and is idempotent by intervention id', async () => {
    const { store, mocks } = createStore();
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [makeRow({ status: 'intervening', intervention_id: 'intervention-1', intervention_by: 'operator-2' })] });

    const record = await store.startIntervention({
      ...scope,
      sessionId: 'session-1',
      interventionId: 'intervention-1',
      interventionBy: 'operator-2',
    });

    expect(record?.status).toBe('intervening');
    expect(record?.interventionId).toBe('intervention-1');
    const updateCall = mocks.query.mock.calls.find(call => call[0].includes('UPDATE'));
    expect(updateCall?.[0]).toContain("status = 'paused'");
    expect(updateCall?.[1]).toEqual([
      'session-1',
      'tenant-a',
      'owner-a',
      'intervention-1',
      'operator-2',
      undefined,
    ]);
  });



  it('re-reads operation ids after zero-row lifecycle updates so concurrent retries are idempotent', async () => {
    const { store, mocks } = createStore();
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [makeRow({ status: 'intervening', intervention_id: 'intervention-1' })] });

    const record = await store.startIntervention({
      ...scope,
      sessionId: 'session-1',
      interventionId: 'intervention-1',
      interventionBy: 'operator-2',
    });

    expect(record?.status).toBe('intervening');
    expect(record?.interventionId).toBe('intervention-1');
    expect(mocks.query.mock.calls).toHaveLength(2);
  });

  it('does not overwrite completed intervention fields with a second intervention cycle', async () => {
    const { store, mocks } = createStore();
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const record = await store.startIntervention({
      ...scope,
      sessionId: 'session-1',
      interventionId: 'intervention-2',
      interventionBy: 'operator-2',
    });

    expect(record).toBeNull();
    const updateCall = mocks.query.mock.calls.find(call => call[0].includes('UPDATE'));
    expect(updateCall?.[0]).toContain('intervention_id IS NULL');
  });

  it('returns the latest lifecycle row including resumed state for recovery', async () => {
    const { store, mocks } = createStore();
    mocks.query.mockResolvedValueOnce({ rows: [makeRow({ status: 'resumed', resume_id: 'resume-1' })] });

    const latest = await store.getLatest('session-1', scope);

    expect(latest?.status).toBe('resumed');
    expect(latest?.resumeId).toBe('resume-1');
    expect(mocks.query.mock.calls[0][0]).not.toContain("status IN ('paused', 'intervening')");
    expect(mocks.query.mock.calls[0][1]).toEqual(['session-1', 'tenant-a', 'owner-a']);
  });

  it('completes intervention with durable guidance without resuming the pause', async () => {
    const { store, mocks } = createStore();
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [makeRow({ status: 'paused', intervention_id: 'intervention-1', intervention_completed_by: 'operator-2', intervention_completed_at: new Date('2026-01-01T00:01:00.000Z'), guidance: 'Wait for approval.' })],
      });

    const record = await store.completeIntervention({
      ...scope,
      sessionId: 'session-1',
      interventionId: 'intervention-1',
      completedBy: 'operator-2',
      guidance: 'Wait for approval.',
      completedAt: new Date('2026-01-01T00:01:00.000Z'),
    });

    expect(record?.status).toBe('paused');
    expect(record?.guidance).toBe('Wait for approval.');
    expect(record?.interventionCompletedBy).toBe('operator-2');
    const updateCall = mocks.query.mock.calls.find(call => call[0].includes('UPDATE'));
    expect(updateCall?.[0]).toContain("status = 'paused'");
    expect(updateCall?.[0]).toContain("AND status = 'intervening'");
  });

  it('resumes the active lifecycle once and returns an existing row for a repeated resume id', async () => {
    const { store, mocks } = createStore();
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [makeRow({ status: 'resumed', resume_id: 'resume-1', resumed_by: 'operator-3', resume_metadata: { releaseQueuedActions: true } })] });

    const record = await store.resume({
      ...scope,
      sessionId: 'session-1',
      resumeId: 'resume-1',
      resumedBy: 'operator-3',
      resumeMetadata: { releaseQueuedActions: true },
    });

    expect(record?.status).toBe('resumed');
    expect(record?.resumeId).toBe('resume-1');
    expect(record?.resumeMetadata).toEqual({ releaseQueuedActions: true });
    const updateCall = mocks.query.mock.calls.find(call => call[0].includes('UPDATE'));
    expect(updateCall?.[0]).toContain("status IN ('paused', 'intervening')");
  });
});
