import { describe, expect, it } from 'vitest';

import {
  AcpDurableIdentityError,
  AcpInvalidStateTransitionError,
  AcpSessionNotFoundError,
  AcpSessionService,
  AcpValidationError,
  validateAcpControlActionInput,
  type AcpAgentSessionAttachment,
  type AcpControlActionInput,
  type AcpCreateSessionInput,
  type AcpSessionRecord,
  type AcpSessionScope,
  type AcpSessionStore,
} from '../services/acp/index.js';

const scope: AcpSessionScope = {
  tenantId: 'tenant-a',
  ownerKeyId: 'owner-a',
};

function cloneRecord(record: AcpSessionRecord): AcpSessionRecord {
  return {
    ...record,
    backendMetadata:
      record.backendMetadata === undefined ? undefined : { ...record.backendMetadata },
  };
}

class InMemoryScopedAcpSessionStore implements AcpSessionStore {
  private readonly records = new Map<string, AcpSessionRecord>();

  async create(record: AcpSessionRecord): Promise<void> {
    if (this.records.has(record.id)) {
      throw new Error(`session already exists: ${record.id}`);
    }
    this.records.set(record.id, cloneRecord(record));
  }

  async get(id: string, requestedScope: AcpSessionScope): Promise<AcpSessionRecord | null> {
    const record = this.records.get(id);
    if (!record) return null;
    if (record.tenantId !== requestedScope.tenantId) return null;
    if (record.ownerKeyId !== requestedScope.ownerKeyId) return null;
    return cloneRecord(record);
  }

  async update(
    record: AcpSessionRecord,
    requestedScope: AcpSessionScope
  ): Promise<AcpSessionRecord | null> {
    const current = this.records.get(record.id);
    if (!current) return null;
    if (current.tenantId !== requestedScope.tenantId) return null;
    if (current.ownerKeyId !== requestedScope.ownerKeyId) return null;
    this.records.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }
}

class MutatingUpdateAcpSessionStore extends InMemoryScopedAcpSessionStore {
  async update(
    record: AcpSessionRecord,
    requestedScope: AcpSessionScope
  ): Promise<AcpSessionRecord | null> {
    const persisted = await super.update(record, requestedScope);
    if (!persisted) return null;
    return {
      ...persisted,
      conversationId: 'mutated-conversation-id',
    };
  }
}

class UnscopedReadAcpSessionStore extends InMemoryScopedAcpSessionStore {
  private storedRecord: AcpSessionRecord | null = null;

  async create(record: AcpSessionRecord): Promise<void> {
    await super.create(record);
    this.storedRecord = cloneRecord(record);
  }

  async get(id: string, requestedScope: AcpSessionScope): Promise<AcpSessionRecord | null> {
    const scoped = await super.get(id, requestedScope);
    return scoped ?? (this.storedRecord ? cloneRecord(this.storedRecord) : null);
  }
}

function createService(ids: string[] = ['session-1', 'conversation-1', 'transcript-1']): {
  service: AcpSessionService;
  store: InMemoryScopedAcpSessionStore;
} {
  const store = new InMemoryScopedAcpSessionStore();
  let idIndex = 0;
  let now = 1_700_000_000_000;
  const service = new AcpSessionService(store, {
    idProvider: () => {
      const id = ids[idIndex];
      idIndex += 1;
      return id ?? `generated-${idIndex}`;
    },
    clock: () => {
      now += 100;
      return now;
    },
  });

  return { service, store };
}

function isCreateSessionInput(value: unknown): value is AcpCreateSessionInput {
  return typeof value === 'object' && value !== null;
}

function isAgentSessionAttachment(value: unknown): value is AcpAgentSessionAttachment {
  return typeof value === 'object' && value !== null;
}

function isControlActionInput(value: unknown): value is AcpControlActionInput {
  return typeof value === 'object' && value !== null;
}

describe('AcpSessionService', () => {
  it('creates a scoped durable session before ACP agent attachment', async () => {
    const { service, store } = createService();

    const created = await service.createSession(scope);

    expect(created).toMatchObject({
      id: 'session-1',
      tenantId: 'tenant-a',
      ownerKeyId: 'owner-a',
      conversationId: 'conversation-1',
      transcriptId: 'transcript-1',
      status: 'initializing',
    });
    expect(created.id).not.toBe(created.conversationId);
    expect(created.id).not.toBe(created.transcriptId);
    expect(created.conversationId).not.toBe(created.transcriptId);
    expect(created.acpAgentSessionId).toBeUndefined();
    expect(created.claudeSessionId).toBeUndefined();
    expect(created.currentBackendRunId).toBeUndefined();

    await expect(store.get(created.id, scope)).resolves.toEqual(created);
  });

  it('rejects duplicate durable ids generated during session creation', async () => {
    const { service } = createService(['duplicate-id', 'duplicate-id', 'transcript-1']);

    await expect(service.createSession(scope)).rejects.toBeInstanceOf(AcpDurableIdentityError);
  });

  it('rejects public session ids that collide with tenant or owner scope values', async () => {
    const { service } = createService(['tenant-a', 'conversation-1', 'transcript-1']);

    await expect(service.createSession(scope)).rejects.toBeInstanceOf(AcpDurableIdentityError);
  });

  it('attaches and resumes ACP, Claude, and backend ids without replacing durable ids', async () => {
    const { service } = createService();
    const created = await service.createSession(scope);

    const attached = await service.attachAgentSession(created.id, scope, {
      acpAgentSessionId: 'acp-session-1',
      claudeSessionId: 'claude-session-1',
      backendRunId: 'backend-run-1',
    });
    const resumed = await service.attachAgentSession(created.id, scope, {
      acpAgentSessionId: 'acp-session-2',
      claudeSessionId: 'claude-session-2',
      backendRunId: 'backend-run-2',
    });

    expect(attached.id).toBe(created.id);
    expect(resumed.id).toBe(created.id);
    expect(resumed.conversationId).toBe(created.conversationId);
    expect(resumed.transcriptId).toBe(created.transcriptId);
    expect(resumed.tenantId).toBe(created.tenantId);
    expect(resumed.ownerKeyId).toBe(created.ownerKeyId);
    expect(resumed.createdAt).toBe(created.createdAt);
    expect(resumed.acpAgentSessionId).toBe('acp-session-2');
    expect(resumed.claudeSessionId).toBe('claude-session-2');
    expect(resumed.currentBackendRunId).toBe('backend-run-2');
    expect(resumed.updatedAt).toBeGreaterThan(created.updatedAt);
  });

  it('rejects store updates that return mutated durable identity fields', async () => {
    const store = new MutatingUpdateAcpSessionStore();
    let idIndex = 0;
    const ids = ['session-1', 'conversation-1', 'transcript-1'];
    const service = new AcpSessionService(store, {
      idProvider: () => ids[idIndex++] ?? `generated-${idIndex}`,
      clock: () => 1_700_000_000_000 + idIndex,
    });
    const created = await service.createSession(scope);

    await expect(
      service.attachAgentSession(created.id, scope, {
        acpAgentSessionId: 'acp-session-1',
      })
    ).rejects.toBeInstanceOf(AcpDurableIdentityError);
  });

  it('rejects ACP attachment ids that collide with durable identity namespaces', async () => {
    const { service } = createService();
    const created = await service.createSession(scope);

    await expect(
      service.attachAgentSession(created.id, scope, {
        acpAgentSessionId: created.id,
      })
    ).rejects.toBeInstanceOf(AcpDurableIdentityError);
    await expect(
      service.attachAgentSession(created.id, scope, {
        claudeSessionId: created.conversationId,
      })
    ).rejects.toBeInstanceOf(AcpDurableIdentityError);
    await expect(
      service.attachAgentSession(created.id, scope, {
        backendRunId: created.transcriptId,
      })
    ).rejects.toBeInstanceOf(AcpDurableIdentityError);
  });

  it('requires tenant and owner scope for reads and updates', async () => {
    const { service } = createService();
    const created = await service.createSession(scope);
    const wrongTenant: AcpSessionScope = { tenantId: 'tenant-b', ownerKeyId: 'owner-a' };
    const wrongOwner: AcpSessionScope = { tenantId: 'tenant-a', ownerKeyId: 'owner-b' };

    await expect(service.getSession(created.id, scope)).resolves.toEqual(created);
    await expect(service.getSession(created.id, wrongTenant)).rejects.toBeInstanceOf(
      AcpSessionNotFoundError
    );
    await expect(
      service.attachAgentSession(created.id, wrongOwner, {
        acpAgentSessionId: 'cross-scope-acp-session',
      })
    ).rejects.toBeInstanceOf(AcpSessionNotFoundError);

    const unchanged = await service.getSession(created.id, scope);
    expect(unchanged.acpAgentSessionId).toBeUndefined();
  });

  it('rejects records returned by a store that ignores tenant and owner scope', async () => {
    const store = new UnscopedReadAcpSessionStore();
    let idIndex = 0;
    const ids = ['session-1', 'conversation-1', 'transcript-1'];
    const service = new AcpSessionService(store, {
      idProvider: () => ids[idIndex++] ?? `generated-${idIndex}`,
      clock: () => 1_700_000_000_000,
    });
    const created = await service.createSession({
      ...scope,
      parentSessionId: 'parent-1',
    });

    await expect(
      service.getSession(created.id, { tenantId: 'tenant-b', ownerKeyId: 'owner-a' })
    ).rejects.toBeInstanceOf(AcpSessionNotFoundError);
  });

  it('records backend restarts without altering public, conversation, or transcript ids', async () => {
    const { service } = createService();
    const created = await service.createSession(scope);
    const firstRun = await service.recordBackendRestart(created.id, scope, 'backend-run-1');
    const secondRun = await service.recordBackendRestart(created.id, scope, 'backend-run-2');

    expect(firstRun.currentBackendRunId).toBe('backend-run-1');
    expect(secondRun.currentBackendRunId).toBe('backend-run-2');
    expect(secondRun.id).toBe(created.id);
    expect(secondRun.conversationId).toBe(created.conversationId);
    expect(secondRun.transcriptId).toBe(created.transcriptId);
    expect(secondRun.createdAt).toBe(created.createdAt);
    expect(secondRun.updatedAt).toBeGreaterThan(firstRun.updatedAt);
  });

  it('allows valid lifecycle transitions and rejects invalid transitions', async () => {
    const { service } = createService();
    const created = await service.createSession(scope);

    const idle = await service.transition(created.id, scope, { type: 'agent_ready' });
    const running = await service.transition(created.id, scope, { type: 'run_started' });
    const paused = await service.transition(created.id, scope, { type: 'pause_requested' });
    const intervening = await service.transition(created.id, scope, {
      type: 'intervention_started',
    });
    const interventionCompleted = await service.transition(created.id, scope, {
      type: 'intervention_completed',
    });
    const resumed = await service.transition(created.id, scope, { type: 'resume_requested' });
    const closing = await service.transition(created.id, scope, { type: 'close_requested' });
    const closed = await service.transition(created.id, scope, { type: 'close_completed' });

    expect(idle.status).toBe('idle');
    expect(running.status).toBe('running');
    expect(paused.status).toBe('paused');
    expect(intervening.status).toBe('intervening');
    expect(interventionCompleted.status).toBe('paused');
    expect(resumed.status).toBe('running');
    expect(closing.status).toBe('closing');
    expect(closed.status).toBe('closed');

    const { service: invalidService } = createService([
      'invalid-session',
      'invalid-conversation',
      'invalid-transcript',
    ]);
    const invalid = await invalidService.createSession(scope);
    await expect(
      invalidService.transition(invalid.id, scope, { type: 'close_completed' })
    ).rejects.toBeInstanceOf(AcpInvalidStateTransitionError);
  });

  it('rejects agent_ready while a run is active', async () => {
    const { service } = createService();
    const created = await service.createSession(scope);

    await service.transition(created.id, scope, { type: 'agent_ready' });
    await service.transition(created.id, scope, { type: 'run_started' });

    await expect(
      service.transition(created.id, scope, { type: 'agent_ready' })
    ).rejects.toBeInstanceOf(AcpInvalidStateTransitionError);
  });

  it('keeps paused sessions paused until intervention or explicit resume transition', async () => {
    const { service } = createService();
    const created = await service.createSession(scope);

    await service.transition(created.id, scope, { type: 'agent_ready' });
    await service.transition(created.id, scope, { type: 'run_started' });
    const paused = await service.transition(created.id, scope, { type: 'pause_requested' });

    await expect(
      service.transition(paused.id, scope, { type: 'run_started' })
    ).rejects.toBeInstanceOf(AcpInvalidStateTransitionError);
    const intervening = await service.transition(paused.id, scope, { type: 'intervention_started' });
    expect(intervening.status).toBe('intervening');

    const resumed = await service.transition(paused.id, scope, { type: 'resume_requested' });
    expect(resumed.status).toBe('running');
  });

  it('rejects non-primitive backend metadata values before persistence', async () => {
    const { service } = createService();
    const decodedInput: unknown = JSON.parse(
      JSON.stringify({
        tenantId: 'tenant-a',
        ownerKeyId: 'owner-a',
        backendMetadata: { nested: { pid: 123 } },
      })
    );

    if (!isCreateSessionInput(decodedInput)) {
      throw new Error('test fixture must decode to an object');
    }

    await expect(service.createSession(decodedInput)).rejects.toBeInstanceOf(AcpValidationError);
  });

  it('rejects malformed decoded scope and relationship identifiers', async () => {
    const { service } = createService();
    const malformedInputs: unknown[] = [
      { ownerKeyId: 'owner-a' },
      { tenantId: 123, ownerKeyId: 'owner-a' },
      { tenantId: 'tenant-a', ownerKeyId: null },
      { tenantId: 'tenant-a', ownerKeyId: 'owner-a', parentSessionId: {} },
    ];

    for (const malformedInput of malformedInputs) {
      if (!isCreateSessionInput(malformedInput)) {
        throw new Error('test fixture must decode to an object');
      }
      await expect(service.createSession(malformedInput)).rejects.toBeInstanceOf(
        AcpValidationError
      );
    }
  });

  it('rejects malformed decoded ACP attachment identifiers', async () => {
    const { service } = createService();
    const created = await service.createSession(scope);
    const malformedAttachments: unknown[] = [
      { acpAgentSessionId: 123 },
      { claudeSessionId: null },
      { backendRunId: false },
    ];

    for (const malformedAttachment of malformedAttachments) {
      if (!isAgentSessionAttachment(malformedAttachment)) {
        throw new Error('test fixture must decode to an object');
      }
      await expect(
        service.attachAgentSession(created.id, scope, malformedAttachment)
      ).rejects.toBeInstanceOf(AcpValidationError);
    }
  });

  it('rejects sensitive backend metadata keys before persistence', async () => {
    const { service } = createService();

    await expect(
      service.createSession({
        ...scope,
        backendMetadata: { ANTHROPIC_API_KEY: 'secret' },
      })
    ).rejects.toThrow('ACP backend metadata key is sensitive');
  });

  it('rejects non-finite backend metadata numbers before persistence', async () => {
    const { service } = createService();

    await expect(
      service.createSession({
        ...scope,
        backendMetadata: { exitCode: Number.NaN },
      })
    ).rejects.toBeInstanceOf(AcpValidationError);
  });

  it('rejects oversized backend metadata keys before persistence', async () => {
    const { service } = createService();
    const oversizedKey = 'k'.repeat(129);

    await expect(
      service.createSession({
        ...scope,
        backendMetadata: { [oversizedKey]: 'bounded-value' },
      })
    ).rejects.toThrow('ACP backend metadata key exceeds 128 bytes');
  });

  it('rejects blank durable relationship identifiers', async () => {
    const { service } = createService();

    await expect(
      service.createSession({
        ...scope,
        parentSessionId: ' ',
      })
    ).rejects.toBeInstanceOf(AcpValidationError);
  });

  it('rejects JSON-RPC request ids as durable ACP session identity', async () => {
    const { service } = createService();
    const inputWithJsonRpcId = {
      tenantId: 'tenant-a',
      ownerKeyId: 'owner-a',
      jsonRpcRequestId: 100,
    };

    await expect(service.createSession(inputWithJsonRpcId)).rejects.toThrow(
      'JSON-RPC request ids are transport-scoped'
    );

    const created = await service.createSession(scope);
    const attachmentWithJsonRpcId = {
      acpAgentSessionId: 'acp-session-1',
      jsonRpcRequestId: 'transport-1',
    };

    await expect(
      service.attachAgentSession(created.id, scope, attachmentWithJsonRpcId)
    ).rejects.toThrow('JSON-RPC request ids are transport-scoped');

    const persisted = await service.getSession(created.id, scope);
    expect(Object.hasOwn(persisted, 'jsonRpcRequestId')).toBe(false);
  });

  it('validates control action ids without accepting JSON-RPC ids as durable identity', () => {
    const decodedAction: unknown = {
      tenantId: 'tenant-a',
      ownerKeyId: 'owner-a',
      sessionId: 'session-1',
      actionId: 'action-1',
      type: 'approve',
      approvalId: 'action-1',
    };

    if (!isControlActionInput(decodedAction)) {
      throw new Error('test fixture must decode to an object');
    }

    expect(() => validateAcpControlActionInput(decodedAction)).toThrow(
      'ACP identity namespaces must be distinct'
    );
    const actionWithJsonRpcId: unknown = {
      tenantId: 'tenant-a',
      ownerKeyId: 'owner-a',
      sessionId: 'session-1',
      actionId: 'action-1',
      type: 'approve',
      approvalId: 'approval-1',
      jsonRpcRequestId: 1,
    };

    if (!isControlActionInput(actionWithJsonRpcId)) {
      throw new Error('test fixture must decode to an object');
    }

    expect(() => validateAcpControlActionInput(actionWithJsonRpcId)).toThrow(
      'JSON-RPC request ids are transport-scoped'
    );
  });
});
