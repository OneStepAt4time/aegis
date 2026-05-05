import { describe, expect, it } from 'vitest';

import {
  ACP_ACTION_WORKER_STALE_LEASE_RECOVERY_POLICY,
  AcpActionWorker,
  AcpActionWorkerRuntimeUnavailableError,
  type AcpActionWorkerBackend,
} from '../services/acp/action-worker.js';
import {
  createMemoryAcpLocalStorageProfile,
  type AcpActionQueue,
  type AcpActionRecord,
  type AcpControlActionInput,
  type AcpSessionScope,
} from '../services/acp/index.js';

const scope: AcpSessionScope = {
  tenantId: 'tenant-a',
  ownerKeyId: 'owner-a',
};

function actionInput(overrides: Partial<AcpControlActionInput> = {}): AcpControlActionInput {
  return {
    ...scope,
    sessionId: 'session-1',
    actionId: 'action-1',
    type: 'prompt',
    metadata: { text: 'hello' },
    ...overrides,
  };
}

function makeActionRecord(overrides: Partial<AcpActionRecord> = {}): AcpActionRecord {
  return {
    ...scope,
    actionId: 'action-1',
    sessionId: 'session-1',
    actionType: 'prompt',
    status: 'leased',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    availableAt: new Date('2026-01-01T00:00:00.000Z'),
    leasedUntil: new Date('2026-01-01T00:05:00.000Z'),
    attemptCount: 1,
    metadata: { text: 'hello' },
    ...overrides,
  };
}

describe('AcpActionWorker', () => {
  it('leases available actions in queue order and completes each dispatched action', async () => {
    const profile = createMemoryAcpLocalStorageProfile();
    const backend = new RecordingActionBackend();
    const worker = new AcpActionWorker({
      queue: profile.actionQueue,
      backend,
      scope,
      clock: fixedClock('2026-01-01T00:02:00.000Z'),
    });

    await profile.actionQueue.enqueue(actionInput({ actionId: 'later' }), {
      availableAt: new Date('2026-01-01T00:01:00.000Z'),
    });
    await profile.actionQueue.enqueue(actionInput({ actionId: 'earlier' }), {
      availableAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await worker.runOnce();
    await worker.runOnce();

    expect(backend.dispatched.map(action => action.actionId)).toEqual(['earlier', 'later']);
    const next = await profile.actionQueue.leaseNext(scope, {
      now: new Date('2026-01-01T00:03:00.000Z'),
      leaseUntil: new Date('2026-01-01T00:08:00.000Z'),
    });
    expect(next).toBeNull();
  });

  it('treats missing completion and failure transitions as idempotent final states', async () => {
    const leased = makeActionRecord();
    const queue = new ScriptedActionQueue([leased], {
      completeReturnsNull: true,
      failReturnsNull: true,
    });
    const backend = new RecordingActionBackend();
    const worker = new AcpActionWorker({ queue, backend, scope });

    await expect(worker.runOnce()).resolves.toMatchObject({
      status: 'dispatched',
      actionId: 'action-1',
      transition: 'already-finalized',
    });

    queue.actions.push(makeActionRecord({ actionId: 'action-2' }));
    backend.error = new Error('runtime failed after external cancellation');

    await expect(worker.runOnce()).resolves.toMatchObject({
      status: 'failed',
      actionId: 'action-2',
      transition: 'already-finalized',
    });
  });

  it('fails runtime-unavailable actions without requeueing when no retry contract exists', async () => {
    const leased = makeActionRecord();
    const queue = new ScriptedActionQueue([leased]);
    const backend = new RecordingActionBackend();
    backend.error = new AcpActionWorkerRuntimeUnavailableError('session-1');
    const worker = new AcpActionWorker({ queue, backend, scope });

    await expect(worker.runOnce()).resolves.toMatchObject({
      status: 'failed',
      actionId: 'action-1',
      transition: 'failed',
    });

    expect(queue.failures).toEqual([
      {
        actionId: 'action-1',
        scope,
        errorMetadata: {
          category: 'runtime_unavailable',
          errorName: 'AcpActionWorkerRuntimeUnavailableError',
          retryPolicy: 'not_defined',
        },
      },
    ]);
    expect(queue.actions).toHaveLength(0);
  });

  it('fails a leased action that does not match the worker scope before backend dispatch', async () => {
    const queue = new ScriptedActionQueue([
      makeActionRecord({ tenantId: 'tenant-b', actionId: 'cross-scope' }),
    ]);
    const backend = new RecordingActionBackend();
    const worker = new AcpActionWorker({ queue, backend, scope });

    await expect(worker.runOnce()).resolves.toMatchObject({
      status: 'failed',
      actionId: 'cross-scope',
      transition: 'failed',
    });

    expect(backend.dispatched).toEqual([]);
    expect(queue.failures[0]).toMatchObject({
      actionId: 'cross-scope',
      scope,
      errorMetadata: { category: 'scope_mismatch' },
    });
  });

  it('waits for an in-flight action on shutdown without leasing another action', async () => {
    const profile = createMemoryAcpLocalStorageProfile();
    const gate = deferred<void>();
    const backend = new RecordingActionBackend({ waitFor: gate.promise });
    const worker = new AcpActionWorker({
      queue: profile.actionQueue,
      backend,
      scope,
      idleDelayMs: 1,
      clock: fixedClock('2026-01-01T00:01:00.000Z'),
    });
    const availableAt = new Date('2026-01-01T00:00:00.000Z');
    await profile.actionQueue.enqueue(actionInput({ actionId: 'first' }), { availableAt });
    await profile.actionQueue.enqueue(actionInput({ actionId: 'second' }), { availableAt });

    worker.start();
    await waitForCondition(() => backend.dispatched.length === 1);
    const stopped = worker.stop();
    gate.resolve();
    await stopped;

    expect(backend.dispatched.map(action => action.actionId)).toEqual(['first']);
    const second = await profile.actionQueue.leaseNext(scope, {
      now: new Date('2026-01-01T00:02:00.000Z'),
      leaseUntil: new Date('2026-01-01T00:07:00.000Z'),
    });
    expect(second?.actionId).toBe('second');
  });

  it('reports worker-loop queue errors without creating unhandled rejections', async () => {
    const queue = new ThrowingLeaseQueue(new Error('database unavailable'));
    const backend = new RecordingActionBackend();
    const errors: Error[] = [];
    const worker = new AcpActionWorker({
      queue,
      backend,
      scope,
      idleDelayMs: 1,
      onError: error => errors.push(error),
    });

    worker.start();
    await waitForCondition(() => errors.length === 1);
    await worker.stop();

    expect(errors[0]?.message).toBe('database unavailable');
    expect(backend.dispatched).toEqual([]);
  });

  it('documents that stale leased action recovery is intentionally not implemented in the worker', () => {
    expect(ACP_ACTION_WORKER_STALE_LEASE_RECOVERY_POLICY).toContain('not implemented');
    expect(ACP_ACTION_WORKER_STALE_LEASE_RECOVERY_POLICY).toContain('typed requeue');
  });
});

class RecordingActionBackend implements AcpActionWorkerBackend {
  readonly dispatched: AcpActionRecord[] = [];
  error: Error | undefined;

  constructor(private readonly options: { waitFor?: Promise<void> } = {}) {}

  async dispatchAction(
    action: AcpActionRecord
  ): Promise<{ resultMetadata?: Record<string, string | number | boolean | null> }> {
    this.dispatched.push(action);
    await this.options.waitFor;
    if (this.error) throw this.error;
    return { resultMetadata: { delivered: true } };
  }
}

class ScriptedActionQueue implements AcpActionQueue {
  readonly failures: {
    actionId: string;
    scope: AcpSessionScope;
    errorMetadata: Record<string, string | number | boolean | null> | undefined;
  }[] = [];

  constructor(
    readonly actions: AcpActionRecord[],
    private readonly options: { completeReturnsNull?: boolean; failReturnsNull?: boolean } = {}
  ) {}

  async enqueue(): Promise<AcpActionRecord> {
    throw new Error('not used by this test');
  }

  async leaseNext(): Promise<AcpActionRecord | null> {
    return this.actions.shift() ?? null;
  }

  async complete(
    actionId: string,
    requestedScope: AcpSessionScope
  ): Promise<AcpActionRecord | null> {
    if (this.options.completeReturnsNull) return null;
    return makeActionRecord({ actionId, status: 'completed', ...requestedScope });
  }

  async fail(
    actionId: string,
    requestedScope: AcpSessionScope,
    options?: { errorMetadata?: Record<string, string | number | boolean | null> }
  ): Promise<AcpActionRecord | null> {
    this.failures.push({ actionId, scope: requestedScope, errorMetadata: options?.errorMetadata });
    if (this.options.failReturnsNull) return null;
    return makeActionRecord({
      actionId,
      status: 'failed',
      tenantId: requestedScope.tenantId,
      ownerKeyId: requestedScope.ownerKeyId,
      errorMetadata: options?.errorMetadata,
    });
  }

  async cancel(): Promise<AcpActionRecord | null> {
    throw new Error('not used by this test');
  }
}

class ThrowingLeaseQueue implements AcpActionQueue {
  constructor(private readonly error: Error) {}

  async enqueue(): Promise<AcpActionRecord> {
    throw new Error('not used by this test');
  }

  async leaseNext(): Promise<AcpActionRecord | null> {
    throw this.error;
  }

  async complete(): Promise<AcpActionRecord | null> {
    throw new Error('not used by this test');
  }

  async fail(): Promise<AcpActionRecord | null> {
    throw new Error('not used by this test');
  }

  async cancel(): Promise<AcpActionRecord | null> {
    throw new Error('not used by this test');
  }
}

function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(innerResolve => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition timed out');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
