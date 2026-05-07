import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createFileAcpLocalStorageProfile,
  createMemoryAcpLocalStorageProfile,
  type AcpControlActionInput,
  type AcpEventPayload,
  type AcpSessionRecord,
  type AcpSessionScope,
} from '../services/acp/index.js';

const scope: AcpSessionScope = {
  tenantId: 'tenant-a',
  ownerKeyId: 'owner-a',
};

const otherScope: AcpSessionScope = {
  tenantId: 'tenant-b',
  ownerKeyId: 'owner-b',
};

function makeSessionRecord(overrides: Partial<AcpSessionRecord> = {}): AcpSessionRecord {
  return {
    id: 'session-1',
    tenantId: scope.tenantId,
    ownerKeyId: scope.ownerKeyId,
    conversationId: 'conversation-1',
    transcriptId: 'transcript-1',
    status: 'initializing',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    backendMetadata: { runtime: 'local-dev', warm: true },
    ...overrides,
  };
}

function actionInput(overrides: Partial<AcpControlActionInput> = {}): AcpControlActionInput {
  return {
    tenantId: scope.tenantId,
    ownerKeyId: scope.ownerKeyId,
    sessionId: 'session-1',
    actionId: 'action-1',
    type: 'prompt',
    metadata: { source: 'test' },
    ...overrides,
  };
}

function unsafeEventPayload(payload: unknown): AcpEventPayload {
  // Bypass the compile-time contract to exercise runtime validation of decoded input.
  return payload as AcpEventPayload;
}

describe('memory ACP local-dev storage profile', () => {
  it('keeps session records isolated by tenant and owner scope', async () => {
    const profile = createMemoryAcpLocalStorageProfile();
    const record = makeSessionRecord();

    await profile.sessionStore.create(record);
    const stored = await profile.sessionStore.get('session-1', scope);
    const crossScope = await profile.sessionStore.get('session-1', otherScope);

    expect(stored).toEqual(record);
    expect(crossScope).toBeNull();

    const tampered = { ...record, tenantId: otherScope.tenantId };
    await expect(profile.sessionStore.update(tampered, scope)).rejects.toThrow('record scope');
  });

  it('assigns deterministic scoped event sequences and replays them in order', async () => {
    const profile = createMemoryAcpLocalStorageProfile();
    const occurredAt = new Date('2026-01-01T00:00:00.000Z');

    const first = await profile.eventStore.append({
      ...scope,
      sessionId: 'session-1',
      eventType: 'message.started',
      occurredAt,
      payload: { index: 1 },
    });
    const second = await profile.eventStore.append({
      ...scope,
      sessionId: 'session-1',
      eventType: 'message.delta',
      occurredAt: new Date('2026-01-01T00:00:01.000Z'),
      payload: { index: 2 },
    });

    expect(second.ingestedAt.getTime()).toBeGreaterThan(second.occurredAt.getTime());

    expect([first.eventSeq, second.eventSeq]).toEqual([1, 2]);
    await expect(
      profile.eventStore.append({
        ...otherScope,
        sessionId: 'session-1',
        eventType: 'message.delta',
        payload: { crossScope: true },
      })
    ).rejects.toThrow('session scope');

    const replay = await profile.eventStore.list({
      ...scope,
      sessionId: 'session-1',
      afterEventSeq: 1,
      limit: 1,
    });

    expect(replay).toHaveLength(1);
    expect(replay[0]).toMatchObject({
      eventSeq: 2,
      eventType: 'message.delta',
      payload: { index: 2 },
    });
  });

  it('rejects non-JSON event payload objects before local persistence', async () => {
    const profile = createMemoryAcpLocalStorageProfile();

    await expect(
      profile.eventStore.append({
        ...scope,
        sessionId: 'session-1',
        eventType: 'message.delta',
        payload: unsafeEventPayload({ happenedAt: new Date('2026-01-01T00:00:00.000Z') }),
      })
    ).rejects.toThrow('plain JSON object');
    await expect(
      profile.eventStore.append({
        ...scope,
        sessionId: 'session-1',
        eventType: 'message.delta',
        payload: unsafeEventPayload({ values: new Map([['key', 'value']]) }),
      })
    ).rejects.toThrow('plain JSON object');
  });

  it('preserves action idempotency and scoped lifecycle transitions', async () => {
    const profile = createMemoryAcpLocalStorageProfile();
    const queuedAt = new Date('2026-01-01T00:00:00.000Z');

    const first = await profile.actionQueue.enqueue(
      actionInput({ actionId: 'action-1', idempotencyKey: 'client-key-1' }),
      { availableAt: new Date('2026-01-01T00:01:00.000Z') }
    );
    const repeated = await profile.actionQueue.enqueue(
      actionInput({ actionId: 'action-duplicate', idempotencyKey: 'client-key-1' })
    );
    await profile.actionQueue.enqueue(actionInput({ actionId: 'action-2' }), {
      availableAt: queuedAt,
    });

    expect(repeated.actionId).toBe(first.actionId);

    const leased = await profile.actionQueue.leaseNext(scope, {
      now: new Date('2026-01-01T00:02:00.000Z'),
      leaseUntil: new Date('2026-01-01T00:07:00.000Z'),
    });

    expect(leased).toMatchObject({
      actionId: 'action-2',
      status: 'leased',
      attemptCount: 1,
    });

    const completed = await profile.actionQueue.complete('action-2', scope, {
      now: new Date('2026-01-01T00:03:00.000Z'),
      resultMetadata: { delivered: true },
    });
    const secondComplete = await profile.actionQueue.complete('action-2', scope, {
      now: new Date('2026-01-01T00:04:00.000Z'),
    });
    const crossScopeCancel = await profile.actionQueue.cancel('action-1', otherScope, {
      now: new Date('2026-01-01T00:05:00.000Z'),
    });
    const cancelled = await profile.actionQueue.cancel('action-1', scope, {
      now: new Date('2026-01-01T00:06:00.000Z'),
      errorMetadata: { reason: 'client-cancelled' },
    });

    expect(completed).toMatchObject({
      actionId: 'action-2',
      status: 'completed',
      resultMetadata: { delivered: true },
    });
    expect(secondComplete).toBeNull();
    expect(crossScopeCancel).toBeNull();
    expect(cancelled).toMatchObject({
      actionId: 'action-1',
      status: 'cancelled',
      errorMetadata: { reason: 'client-cancelled' },
    });
  });
});

describe('file ACP local-dev storage profile', () => {
  let scratchDir: string;

  beforeEach(async () => {
    scratchDir = path.join(process.cwd(), '.test-scratch', `acp-local-storage-${process.pid}-${randomUUID()}`);
    await mkdir(scratchDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  it('persists sessions, event replay, and queued actions across profile restart', async () => {
    const storageFile = path.join(scratchDir, 'local-acp-storage.json');
    const firstProfile = createFileAcpLocalStorageProfile({ filePath: storageFile });
    await firstProfile.start();

    await firstProfile.sessionStore.create(makeSessionRecord({ status: 'running' }));
    await firstProfile.eventStore.append({
      ...scope,
      sessionId: 'session-1',
      eventType: 'message.delta',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      payload: { text: 'hello' },
    });
    await firstProfile.actionQueue.enqueue(
      actionInput({ actionId: 'action-1', idempotencyKey: 'persisted-key' }),
      { availableAt: new Date('2026-01-01T00:00:00.000Z') }
    );
    await firstProfile.stop();

    const secondProfile = createFileAcpLocalStorageProfile({ filePath: storageFile });
    await secondProfile.start();

    const session = await secondProfile.sessionStore.get('session-1', scope);
    const replay = await secondProfile.eventStore.list({ ...scope, sessionId: 'session-1' });
    const leased = await secondProfile.actionQueue.leaseNext(scope, {
      now: new Date('2026-01-01T00:01:00.000Z'),
      leaseUntil: new Date('2026-01-01T00:06:00.000Z'),
    });

    expect(session).toMatchObject({ id: 'session-1', status: 'running' });
    expect(replay).toHaveLength(1);
    expect(replay[0]).toMatchObject({ eventSeq: 1, payload: { text: 'hello' } });
    expect(leased).toMatchObject({
      actionId: 'action-1',
      idempotencyKey: 'persisted-key',
      status: 'leased',
      attemptCount: 1,
    });

    await secondProfile.stop();
  });
});

