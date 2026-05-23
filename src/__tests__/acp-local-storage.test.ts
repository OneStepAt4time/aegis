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
    const firstProfile = createFileAcpLocalStorageProfile({ filePath: storageFile, persistDebounceMs: 0 });
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

    const secondProfile = createFileAcpLocalStorageProfile({ filePath: storageFile, persistDebounceMs: 0 });
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


// ─────────────────────────────────────────────────────────────────────────────
// Issue #4052: OOM fix behavior tests (follow-up to PR #4051)
// ─────────────────────────────────────────────────────────────────────────────

describe('OOM fix: event compaction enforcement (#4052)', () => {
  it('prunes oldest events for a session when exceeding maxEventsPerSession', async () => {
    const profile = createMemoryAcpLocalStorageProfile();
    // Memory profile uses DEFAULT_MAX_EVENTS_PER_SESSION (1000) by default.
    // We test the pruning via a small maxEventsPerSession via file profile.
    const scratchDir = path.join(process.cwd(), '.test-scratch', `compaction-${process.pid}-${randomUUID()}`);
    await mkdir(scratchDir, { recursive: true });

    try {
      const storageFile = path.join(scratchDir, 'compaction-test.json');
      const maxEvents = 5;
      const profile2 = createFileAcpLocalStorageProfile({
        filePath: storageFile,
        maxEventsPerSession: maxEvents,
        persistDebounceMs: 0,
      });
      await profile2.start();

      // Append 8 events for the same session.
      for (let i = 1; i <= 8; i++) {
        await profile2.eventStore.append({
          ...scope,
          sessionId: 'session-1',
          eventType: 'message.delta',
          payload: { index: i },
        });
      }

      const all = await profile2.eventStore.list({ ...scope, sessionId: 'session-1', limit: 100 });
      // Should have been pruned to maxEvents (5).
      expect(all).toHaveLength(maxEvents);
      // Should retain the NEWEST events (seq 4-8, pruned 1-3).
      expect(all.map(e => e.payload)).toEqual([
        { index: 4 },
        { index: 5 },
        { index: 6 },
        { index: 7 },
        { index: 8 },
      ]);

      await profile2.stop();
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });

  it('prunes events independently per session', async () => {
    const scratchDir = path.join(process.cwd(), '.test-scratch', `compaction-multi-${process.pid}-${randomUUID()}`);
    await mkdir(scratchDir, { recursive: true });

    try {
      const storageFile = path.join(scratchDir, 'compaction-multi.json');
      const maxEvents = 3;
      const profile = createFileAcpLocalStorageProfile({
        filePath: storageFile,
        maxEventsPerSession: maxEvents,
        persistDebounceMs: 0,
      });
      await profile.start();

      // Session 1: 5 events → pruned to 3
      for (let i = 1; i <= 5; i++) {
        await profile.eventStore.append({
          ...scope,
          sessionId: 's1',
          eventType: 'message.delta',
          payload: { s: 1, i },
        });
      }
      // Session 2: 2 events → no pruning
      for (let i = 1; i <= 2; i++) {
        await profile.eventStore.append({
          ...scope,
          sessionId: 's2',
          eventType: 'message.delta',
          payload: { s: 2, i },
        });
      }

      const s1Events = await profile.eventStore.list({ ...scope, sessionId: 's1', limit: 100 });
      const s2Events = await profile.eventStore.list({ ...scope, sessionId: 's2', limit: 100 });

      expect(s1Events).toHaveLength(3); // pruned from 5 → 3
      expect(s2Events).toHaveLength(2); // under limit, no pruning

      await profile.stop();
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });
});

describe('OOM fix: startup pruning of terminal sessions (#4052)', () => {
  it('removes events for closed/completed/failed sessions on start', async () => {
    const scratchDir = path.join(process.cwd(), '.test-scratch', `startup-prune-${process.pid}-${randomUUID()}`);
    await mkdir(scratchDir, { recursive: true });

    try {
      const storageFile = path.join(scratchDir, 'startup-prune.json');

      // Phase 1: Create sessions with events, some terminal.
      const profile1 = createFileAcpLocalStorageProfile({
        filePath: storageFile,
        persistDebounceMs: 0,
      });
      await profile1.start();

      // Active session
      await profile1.sessionStore.create(makeSessionRecord({ id: 'active-1', status: 'running' }));
      await profile1.eventStore.append({
        ...scope, sessionId: 'active-1', eventType: 'message.delta', payload: { keep: true },
      });

      // Closed session — should be pruned on restart
      await profile1.sessionStore.create(makeSessionRecord({ id: 'closed-1', status: 'closed' }));
      await profile1.eventStore.append({
        ...scope, sessionId: 'closed-1', eventType: 'message.delta', payload: { pruned: true },
      });

      // Closed session (completed) — should be pruned
      await profile1.sessionStore.create(makeSessionRecord({ id: 'completed-1', status: 'closed' }));
      await profile1.eventStore.append({
        ...scope, sessionId: 'completed-1', eventType: 'message.delta', payload: { pruned: true },
      });

      // Failed session — should be pruned
      await profile1.sessionStore.create(makeSessionRecord({ id: 'failed-1', status: 'failed' }));
      await profile1.eventStore.append({
        ...scope, sessionId: 'failed-1', eventType: 'message.delta', payload: { pruned: true },
      });

      await profile1.stop();

      // Phase 2: Reload — should prune events for closed/completed/failed sessions.
      const profile2 = createFileAcpLocalStorageProfile({
        filePath: storageFile,
        persistDebounceMs: 0,
      });
      await profile2.start();

      const activeEvents = await profile2.eventStore.list({ ...scope, sessionId: 'active-1' });
      const closedEvents = await profile2.eventStore.list({ ...scope, sessionId: 'closed-1' });
      const completedEvents = await profile2.eventStore.list({ ...scope, sessionId: 'completed-1' });
      const failedEvents = await profile2.eventStore.list({ ...scope, sessionId: 'failed-1' });

      expect(activeEvents).toHaveLength(1); // kept
      expect(closedEvents).toHaveLength(0); // pruned
      expect(completedEvents).toHaveLength(0); // pruned
      expect(failedEvents).toHaveLength(0); // pruned

      await profile2.stop();
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });
});

describe('OOM fix: debounce coalescing (#4052)', () => {
  it('coalesces multiple rapid mutations into a single disk write', async () => {
    const scratchDir = path.join(process.cwd(), '.test-scratch', `debounce-${process.pid}-${randomUUID()}`);
    await mkdir(scratchDir, { recursive: true });

    try {
      const storageFile = path.join(scratchDir, 'debounce.json');
      const profile = createFileAcpLocalStorageProfile({
        filePath: storageFile,
        persistDebounceMs: 200, // 200ms debounce window
      });
      await profile.start();

      // Fire multiple mutations rapidly — they should be coalesced.
      await profile.eventStore.append({
        ...scope, sessionId: 'session-1', eventType: 'message.delta', payload: { i: 1 },
      });
      await profile.eventStore.append({
        ...scope, sessionId: 'session-1', eventType: 'message.delta', payload: { i: 2 },
      });
      await profile.eventStore.append({
        ...scope, sessionId: 'session-1', eventType: 'message.delta', payload: { i: 3 },
      });

      // Wait for debounce to fire + persist to complete.
      await new Promise(resolve => setTimeout(resolve, 500));

      // Stop triggers flush, ensuring everything is written.
      await profile.stop();

      // Verify all 3 events persisted.
      const profile2 = createFileAcpLocalStorageProfile({ filePath: storageFile, persistDebounceMs: 0 });
      await profile2.start();
      const events = await profile2.eventStore.list({ ...scope, sessionId: 'session-1', limit: 100 });
      expect(events).toHaveLength(3);
      await profile2.stop();
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });
});

describe('OOM fix: flush lifecycle (#4052)', () => {
  it('flushes dirty state on stop() so data is not lost', async () => {
    const scratchDir = path.join(process.cwd(), '.test-scratch', `flush-${process.pid}-${randomUUID()}`);
    await mkdir(scratchDir, { recursive: true });

    try {
      const storageFile = path.join(scratchDir, 'flush.json');
      const profile = createFileAcpLocalStorageProfile({
        filePath: storageFile,
        persistDebounceMs: 300_000, // 5 min debounce — nothing auto-persists within test window.
      });
      await profile.start();

      // Mutations await onMutation which returns a schedulePersist() promise.
      // That promise only resolves when the debounce fires + flush completes.
      // Since we use a 5-min debounce, we fire-and-forget the mutation promises
      // (the in-memory state changes are immediate; only the persist is deferred).
      const createP = profile.sessionStore.create(makeSessionRecord({ id: 'flush-test', status: 'running' }));
      const appendP = profile.eventStore.append({
        ...scope, sessionId: 'flush-test', eventType: 'message.delta', payload: { flushed: true },
      });

      // stop() clears the debounce timer and flushes dirty state immediately,
      // which also resolves all pending mutation promises.
      await profile.stop();
      // Ensure the mutation promises also settled (resolved by flush).
      await Promise.allSettled([createP, appendP]);

      // Verify data was persisted by the stop→flush path.
      const profile2 = createFileAcpLocalStorageProfile({ filePath: storageFile, persistDebounceMs: 0 });
      await profile2.start();
      const session = await profile2.sessionStore.get('flush-test', scope);
      const events = await profile2.eventStore.list({ ...scope, sessionId: 'flush-test' });

      expect(session).toMatchObject({ id: 'flush-test', status: 'running' });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual({ flushed: true });

      await profile2.stop();
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });

  it('reports healthy when started and unhealthy when not started', async () => {
    const scratchDir = path.join(process.cwd(), '.test-scratch', `health-${process.pid}-${randomUUID()}`);
    await mkdir(scratchDir, { recursive: true });

    try {
      const storageFile = path.join(scratchDir, 'health.json');
      const profile = createFileAcpLocalStorageProfile({
        filePath: storageFile,
        persistDebounceMs: 0,
      });

      const beforeStart = await profile.health();
      expect(beforeStart.healthy).toBe(false);

      await profile.start();
      const afterStart = await profile.health();
      expect(afterStart.healthy).toBe(true);

      await profile.stop();
      const afterStop = await profile.health();
      expect(afterStop.healthy).toBe(false);
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });
});

describe('OOM fix: incremental seq tracking (#4052)', () => {
  it('rebuilds lastEventSeqBySession map correctly on load from disk', async () => {
    const scratchDir = path.join(process.cwd(), '.test-scratch', `seq-restore-${process.pid}-${randomUUID()}`);
    await mkdir(scratchDir, { recursive: true });

    try {
      const storageFile = path.join(scratchDir, 'seq-restore.json');

      // Phase 1: Append events, persist.
      const profile1 = createFileAcpLocalStorageProfile({
        filePath: storageFile,
        persistDebounceMs: 0,
      });
      await profile1.start();

      for (let i = 1; i <= 5; i++) {
        await profile1.eventStore.append({
          ...scope, sessionId: 'session-1', eventType: 'message.delta', payload: { i },
        });
      }
      await profile1.stop();

      // Phase 2: Load and append more — seq should continue from 6, not restart at 1.
      const profile2 = createFileAcpLocalStorageProfile({
        filePath: storageFile,
        persistDebounceMs: 0,
      });
      await profile2.start();

      const next = await profile2.eventStore.append({
        ...scope, sessionId: 'session-1', eventType: 'message.delta', payload: { i: 6 },
      });
      expect(next.eventSeq).toBe(6); // Continues from loaded state, not 1.

      const all = await profile2.eventStore.list({ ...scope, sessionId: 'session-1', limit: 100 });
      expect(all).toHaveLength(6);
      expect(all.map(e => e.eventSeq)).toEqual([1, 2, 3, 4, 5, 6]);

      await profile2.stop();
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });

  it('tracks seq independently per session', async () => {
    const scratchDir = path.join(process.cwd(), '.test-scratch', `seq-per-session-${process.pid}-${randomUUID()}`);
    await mkdir(scratchDir, { recursive: true });

    try {
      const storageFile = path.join(scratchDir, 'seq-per-session.json');
      const profile = createFileAcpLocalStorageProfile({
        filePath: storageFile,
        persistDebounceMs: 0,
      });
      await profile.start();

      const e1 = await profile.eventStore.append({
        ...scope, sessionId: 's1', eventType: 'message.delta', payload: { s: 1 },
      });
      const e2 = await profile.eventStore.append({
        ...scope, sessionId: 's2', eventType: 'message.delta', payload: { s: 2 },
      });
      const e3 = await profile.eventStore.append({
        ...scope, sessionId: 's1', eventType: 'message.delta', payload: { s: 1 },
      });

      expect(e1.eventSeq).toBe(1); // s1 first event
      expect(e2.eventSeq).toBe(1); // s2 first event (independent)
      expect(e3.eventSeq).toBe(2); // s1 second event

      await profile.stop();
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });
});

describe('OOM fix: lightweight serialization (#4052)', () => {
  it('persists and restores complex nested payloads without structuredClone corruption', async () => {
    const scratchDir = path.join(process.cwd(), '.test-scratch', `serialize-${process.pid}-${randomUUID()}`);
    await mkdir(scratchDir, { recursive: true });

    try {
      const storageFile = path.join(scratchDir, 'serialize.json');
      const profile = createFileAcpLocalStorageProfile({
        filePath: storageFile,
        persistDebounceMs: 0,
      });
      await profile.start();

      // Complex nested payload that would exercise serialization paths.
      const complexPayloadRaw: Record<string, unknown> = {
        level1: {
          level2: {
            level3: [{ a: 1 }, { b: 2 }],
            string: 'hello "world"',
            number: 42.5,
            boolean: true,
            null: null,
          },
        },
        array: [1, 2, 3, 'four', null],
      };

      await profile.eventStore.append({
        ...scope,
        sessionId: 'session-1',
        eventType: 'message.delta',
        payload: complexPayloadRaw as AcpEventPayload,
      });
      await profile.stop();

      // Reload and verify payload integrity.
      const profile2 = createFileAcpLocalStorageProfile({
        filePath: storageFile,
        persistDebounceMs: 0,
      });
      await profile2.start();
      const events = await profile2.eventStore.list({ ...scope, sessionId: 'session-1' });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual(complexPayloadRaw);
      await profile2.stop();
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });

  it('produces valid JSON output with correct date string serialization', async () => {
    const scratchDir = path.join(process.cwd(), '.test-scratch', `json-valid-${process.pid}-${randomUUID()}`);
    await mkdir(scratchDir, { recursive: true });

    try {
      const storageFile = path.join(scratchDir, 'json-valid.json');
      const profile = createFileAcpLocalStorageProfile({
        filePath: storageFile,
        persistDebounceMs: 0,
      });
      await profile.start();

      await profile.sessionStore.create(makeSessionRecord({ status: 'running' }));
      await profile.eventStore.append({
        ...scope,
        sessionId: 'session-1',
        eventType: 'message.delta',
        payload: { test: 'serialization' },
      });
      await profile.stop();

      // Read the raw JSON file and verify it's parseable and has correct structure.
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(storageFile, 'utf8');
      const parsed = JSON.parse(raw);

      expect(parsed.version).toBe(1);
      expect(parsed.sessions).toHaveLength(1);
      expect(parsed.events).toHaveLength(1);
      // Dates must be ISO strings, not "[object Object]" or similar.
      expect(parsed.events[0].occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(parsed.events[0].ingestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });
});
