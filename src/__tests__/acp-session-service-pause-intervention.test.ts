import { describe, expect, it } from 'vitest';

import {
  AcpInvalidStateTransitionError,
  AcpSessionService,
  type AcpPauseInterventionRecord,
  type AcpPauseInterventionStore,
  type AcpPauseSessionInput,
  type AcpResumeSessionInput,
  type AcpCompleteInterventionInput,
  type AcpSessionRecord,
  type AcpSessionScope,
  type AcpSessionStore,
  type AcpStartInterventionInput,
} from '../services/acp/index.js';

const scope: AcpSessionScope = {
  tenantId: 'tenant-a',
  ownerKeyId: 'owner-a',
};

function cloneSession(record: AcpSessionRecord): AcpSessionRecord {
  return {
    ...record,
    backendMetadata: record.backendMetadata === undefined ? undefined : { ...record.backendMetadata },
  };
}

function clonePause(record: AcpPauseInterventionRecord): AcpPauseInterventionRecord {
  return {
    ...record,
    requestedAt: new Date(record.requestedAt),
    interventionStartedAt: record.interventionStartedAt === undefined ? undefined : new Date(record.interventionStartedAt),
    interventionCompletedAt: record.interventionCompletedAt === undefined ? undefined : new Date(record.interventionCompletedAt),
    resumedAt: record.resumedAt === undefined ? undefined : new Date(record.resumedAt),
    updatedAt: new Date(record.updatedAt),
    metadata: record.metadata === undefined ? undefined : { ...record.metadata },
    resumeMetadata: record.resumeMetadata === undefined ? undefined : { ...record.resumeMetadata },
  };
}

class InMemoryScopedAcpSessionStore implements AcpSessionStore {
  private readonly records = new Map<string, AcpSessionRecord>();

  async create(record: AcpSessionRecord): Promise<void> {
    this.records.set(record.id, cloneSession(record));
  }

  async get(id: string, requestedScope: AcpSessionScope): Promise<AcpSessionRecord | null> {
    const record = this.records.get(id);
    if (!record) return null;
    if (record.tenantId !== requestedScope.tenantId) return null;
    if (record.ownerKeyId !== requestedScope.ownerKeyId) return null;
    return cloneSession(record);
  }

  async update(record: AcpSessionRecord, requestedScope: AcpSessionScope): Promise<AcpSessionRecord | null> {
    const current = this.records.get(record.id);
    if (!current) return null;
    if (current.tenantId !== requestedScope.tenantId) return null;
    if (current.ownerKeyId !== requestedScope.ownerKeyId) return null;
    this.records.set(record.id, cloneSession(record));
    return cloneSession(record);
  }

  async list(input: { tenantId: string; ownerKeyId: string }): Promise<AcpSessionRecord[]> {
    return [...this.records.values()]
      .filter(r => r.tenantId === input.tenantId && r.ownerKeyId === input.ownerKeyId)
      .map(cloneSession);
  }
}

class InMemoryPauseInterventionStore implements AcpPauseInterventionStore {
  readonly pauses: AcpPauseSessionInput[] = [];
  readonly interventions: AcpStartInterventionInput[] = [];
  readonly resumes: AcpResumeSessionInput[] = [];
  readonly completions: AcpCompleteInterventionInput[] = [];
  private active: AcpPauseInterventionRecord | null = null;
  private readonly records: AcpPauseInterventionRecord[] = [];

  async pause(input: AcpPauseSessionInput): Promise<AcpPauseInterventionRecord> {
    this.pauses.push(input);
    const idempotent = this.records.find(
      record =>
        input.idempotencyKey !== undefined &&
        record.sessionId === input.sessionId &&
        record.tenantId === input.tenantId &&
        record.ownerKeyId === input.ownerKeyId &&
        record.idempotencyKey === input.idempotencyKey
    );
    if (idempotent !== undefined) {
      return clonePause(idempotent);
    }
    const now = new Date('2026-01-01T00:00:00.000Z');
    this.active = {
      tenantId: input.tenantId,
      ownerKeyId: input.ownerKeyId,
      sessionId: input.sessionId,
      pauseId: input.pauseId,
      status: 'paused',
      reason: input.reason,
      requestedBy: input.requestedBy,
      requestedAt: input.requestedAt ?? now,
      updatedAt: input.requestedAt ?? now,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    };
    this.records.push(this.active);
    return clonePause(this.active);
  }

  async getActive(sessionId: string, requestedScope: AcpSessionScope): Promise<AcpPauseInterventionRecord | null> {
    if (!this.active) return null;
    if (this.active.sessionId !== sessionId) return null;
    if (this.active.tenantId !== requestedScope.tenantId) return null;
    if (this.active.ownerKeyId !== requestedScope.ownerKeyId) return null;
    if (this.active.status === 'resumed') return null;
    return clonePause(this.active);
  }

  async startIntervention(input: AcpStartInterventionInput): Promise<AcpPauseInterventionRecord | null> {
    this.interventions.push(input);
    if (!this.active || this.active.sessionId !== input.sessionId) return null;
    const idempotent = this.records.find(
      record =>
        record.sessionId === input.sessionId &&
        record.tenantId === input.tenantId &&
        record.ownerKeyId === input.ownerKeyId &&
        record.interventionId === input.interventionId
    );
    if (idempotent !== undefined) {
      return clonePause(idempotent);
    }
    this.active = {
      ...this.active,
      status: 'intervening',
      interventionId: input.interventionId,
      interventionBy: input.interventionBy,
      interventionStartedAt: input.startedAt ?? new Date('2026-01-01T00:01:00.000Z'),
      updatedAt: input.startedAt ?? new Date('2026-01-01T00:01:00.000Z'),
    };
    this.replaceActive();
    return clonePause(this.active);
  }

  async completeIntervention(input: AcpCompleteInterventionInput): Promise<AcpPauseInterventionRecord | null> {
    this.completions.push(input);
    const idempotent = this.records.find(
      record =>
        record.sessionId === input.sessionId &&
        record.tenantId === input.tenantId &&
        record.ownerKeyId === input.ownerKeyId &&
        record.interventionId === input.interventionId &&
        record.interventionCompletedAt !== undefined
    );
    if (idempotent !== undefined) {
      return clonePause(idempotent);
    }
    if (!this.active || this.active.sessionId !== input.sessionId) return null;
    this.active = {
      ...this.active,
      status: 'paused',
      interventionCompletedBy: input.completedBy,
      interventionCompletedAt: input.completedAt ?? new Date('2026-01-01T00:01:30.000Z'),
      guidance: input.guidance,
      updatedAt: input.completedAt ?? new Date('2026-01-01T00:01:30.000Z'),
    };
    this.replaceActive();
    return clonePause(this.active);
  }

  async getLatest(sessionId: string, requestedScope: AcpSessionScope): Promise<AcpPauseInterventionRecord | null> {
    if (!this.active) return null;
    if (this.active.sessionId !== sessionId) return null;
    if (this.active.tenantId !== requestedScope.tenantId) return null;
    if (this.active.ownerKeyId !== requestedScope.ownerKeyId) return null;
    return clonePause(this.active);
  }

  async resume(input: AcpResumeSessionInput): Promise<AcpPauseInterventionRecord | null> {
    this.resumes.push(input);
    const idempotent = this.records.find(
      record =>
        record.sessionId === input.sessionId &&
        record.tenantId === input.tenantId &&
        record.ownerKeyId === input.ownerKeyId &&
        record.resumeId === input.resumeId
    );
    if (idempotent !== undefined) {
      return clonePause(idempotent);
    }
    if (!this.active || this.active.sessionId !== input.sessionId) return null;
    this.active = {
      ...this.active,
      status: 'resumed',
      resumeId: input.resumeId,
      resumedBy: input.resumedBy,
      resumedAt: input.resumedAt ?? new Date('2026-01-01T00:02:00.000Z'),
      resumeMetadata: input.resumeMetadata,
      updatedAt: input.resumedAt ?? new Date('2026-01-01T00:02:00.000Z'),
    };
    this.replaceActive();
    return clonePause(this.active);
  }

  private replaceActive(): void {
    if (this.active === null) return;
    const index = this.records.findIndex(record => record.pauseId === this.active?.pauseId);
    if (index === -1) {
      this.records.push(this.active);
    } else {
      this.records[index] = this.active;
    }
  }
}

function createService(): { service: AcpSessionService; pauseStore: InMemoryPauseInterventionStore } {
  const sessionStore = new InMemoryScopedAcpSessionStore();
  const pauseStore = new InMemoryPauseInterventionStore();
  const ids = ['session-1', 'conversation-1', 'transcript-1'];
  let idIndex = 0;
  let now = 1_700_000_000_000;
  const service = new AcpSessionService(sessionStore, {
    idProvider: () => ids[idIndex++] ?? `generated-${idIndex}`,
    clock: () => {
      now += 100;
      return now;
    },
    pauseInterventionStore: pauseStore,
  });
  return { service, pauseStore };
}

async function createRunningSession(service: AcpSessionService): Promise<AcpSessionRecord> {
  const created = await service.createSession(scope);
  await service.transition(created.id, scope, { type: 'agent_ready' });
  return service.transition(created.id, scope, { type: 'run_started' });
}

describe('AcpSessionService pause/intervention policy', () => {
  it('persists a pause and transitions a running session to paused', async () => {
    const { service, pauseStore } = createService();
    const running = await createRunningSession(service);

    const result = await service.pauseSession(running.id, scope, {
      pauseId: 'pause-1',
      reason: 'operator requested review',
      requestedBy: 'operator-1',
      idempotencyKey: 'pause-key-1',
    });

    expect(result.session.status).toBe('paused');
    expect(result.pause.status).toBe('paused');
    expect(pauseStore.pauses).toHaveLength(1);
    expect(pauseStore.pauses[0]).toMatchObject({
      tenantId: 'tenant-a',
      ownerKeyId: 'owner-a',
      sessionId: running.id,
      pauseId: 'pause-1',
      idempotencyKey: 'pause-key-1',
    });
  });

  it('does not persist a pause when the session is not running', async () => {
    const { service, pauseStore } = createService();
    const created = await service.createSession(scope);

    await expect(
      service.pauseSession(created.id, scope, {
        pauseId: 'pause-1',
        reason: 'operator requested review',
        requestedBy: 'operator-1',
      })
    ).rejects.toBeInstanceOf(AcpInvalidStateTransitionError);
    expect(pauseStore.pauses).toHaveLength(0);
  });

  it('starts intervention from a paused session and keeps the runtime backend out of policy', async () => {
    const { service, pauseStore } = createService();
    const running = await createRunningSession(service);
    await service.pauseSession(running.id, scope, {
      pauseId: 'pause-1',
      reason: 'operator requested review',
      requestedBy: 'operator-1',
    });

    const result = await service.startIntervention(running.id, scope, {
      interventionId: 'intervention-1',
      interventionBy: 'operator-2',
    });

    expect(result.session.status).toBe('intervening');
    expect(result.pause.status).toBe('intervening');
    expect(pauseStore.interventions).toEqual([
      {
        tenantId: 'tenant-a',
        ownerKeyId: 'owner-a',
        sessionId: running.id,
        interventionId: 'intervention-1',
        interventionBy: 'operator-2',
      },
    ]);
  });



  it('returns durable rows for idempotent retries after session state already advanced', async () => {
    const { service, pauseStore } = createService();
    const running = await createRunningSession(service);

    const firstPause = await service.pauseSession(running.id, scope, {
      pauseId: 'pause-1',
      reason: 'operator requested review',
      requestedBy: 'operator-1',
      idempotencyKey: 'pause-key-1',
    });
    const secondPause = await service.pauseSession(running.id, scope, {
      pauseId: 'pause-1-retry',
      reason: 'operator requested review',
      requestedBy: 'operator-1',
      idempotencyKey: 'pause-key-1',
    });
    const firstIntervention = await service.startIntervention(running.id, scope, {
      interventionId: 'intervention-1',
      interventionBy: 'operator-2',
    });
    const secondIntervention = await service.startIntervention(running.id, scope, {
      interventionId: 'intervention-1',
      interventionBy: 'operator-2',
    });
    const firstResume = await service.resumeSession(running.id, scope, {
      resumeId: 'resume-1',
      resumedBy: 'operator-3',
    });
    const secondResume = await service.resumeSession(running.id, scope, {
      resumeId: 'resume-1',
      resumedBy: 'operator-3',
    });

    expect(firstPause.session.status).toBe('paused');
    expect(secondPause.session.status).toBe('paused');
    expect(secondPause.pause.pauseId).toBe('pause-1');
    expect(firstIntervention.session.status).toBe('intervening');
    expect(secondIntervention.session.status).toBe('intervening');
    expect(firstResume.session.status).toBe('running');
    expect(secondResume.session.status).toBe('running');
    expect(pauseStore.pauses).toHaveLength(2);
  });



  it('does not move a running session backward when retrying an old pause after resume', async () => {
    const { service } = createService();
    const running = await createRunningSession(service);
    await service.pauseSession(running.id, scope, {
      pauseId: 'pause-1',
      reason: 'operator requested review',
      requestedBy: 'operator-1',
      idempotencyKey: 'pause-key-1',
    });
    await service.resumeSession(running.id, scope, {
      resumeId: 'resume-1',
      resumedBy: 'operator-3',
    });

    const retry = await service.pauseSession(running.id, scope, {
      pauseId: 'pause-1-retry',
      reason: 'operator requested review',
      requestedBy: 'operator-1',
      idempotencyKey: 'pause-key-1',
    });

    expect(retry.pause.status).toBe('resumed');
    expect(retry.session.status).toBe('running');
  });



  it('reconciles old pause retries from the latest lifecycle when a newer pause is active', async () => {
    const { service } = createService();
    const running = await createRunningSession(service);
    await service.pauseSession(running.id, scope, {
      pauseId: 'pause-1',
      reason: 'first pause',
      requestedBy: 'operator-1',
      idempotencyKey: 'pause-key-1',
    });
    await service.resumeSession(running.id, scope, {
      resumeId: 'resume-1',
      resumedBy: 'operator-3',
    });
    await service.pauseSession(running.id, scope, {
      pauseId: 'pause-2',
      reason: 'second pause',
      requestedBy: 'operator-1',
      idempotencyKey: 'pause-key-2',
    });

    const retry = await service.pauseSession(running.id, scope, {
      pauseId: 'pause-1-retry',
      reason: 'first pause',
      requestedBy: 'operator-1',
      idempotencyKey: 'pause-key-1',
    });

    expect(retry.pause.pauseId).toBe('pause-1');
    expect(retry.pause.status).toBe('resumed');
    expect(retry.session.status).toBe('paused');
  });

  it('allows intervention start and completion retries after the session has resumed', async () => {
    const { service } = createService();
    const running = await createRunningSession(service);
    await service.pauseSession(running.id, scope, {
      pauseId: 'pause-1',
      reason: 'operator requested review',
      requestedBy: 'operator-1',
    });
    await service.startIntervention(running.id, scope, {
      interventionId: 'intervention-1',
      interventionBy: 'operator-2',
    });
    await service.completeIntervention(running.id, scope, {
      interventionId: 'intervention-1',
      completedBy: 'operator-2',
    });
    await service.resumeSession(running.id, scope, {
      resumeId: 'resume-1',
      resumedBy: 'operator-3',
    });

    const startRetry = await service.startIntervention(running.id, scope, {
      interventionId: 'intervention-1',
      interventionBy: 'operator-2',
    });
    const completeRetry = await service.completeIntervention(running.id, scope, {
      interventionId: 'intervention-1',
      completedBy: 'operator-2',
    });

    expect(startRetry.pause.interventionId).toBe('intervention-1');
    expect(startRetry.session.status).toBe('running');
    expect(completeRetry.pause.interventionCompletedBy).toBe('operator-2');
    expect(completeRetry.session.status).toBe('running');
  });

  it('completes intervention through SessionService and requires explicit resume', async () => {
    const { service, pauseStore } = createService();
    const running = await createRunningSession(service);
    await service.pauseSession(running.id, scope, {
      pauseId: 'pause-1',
      reason: 'operator requested review',
      requestedBy: 'operator-1',
    });
    await service.startIntervention(running.id, scope, {
      interventionId: 'intervention-1',
      interventionBy: 'operator-2',
    });

    const completed = await service.completeIntervention(running.id, scope, {
      interventionId: 'intervention-1',
      completedBy: 'operator-2',
      guidance: 'Wait for approval.',
    });

    expect(completed.session.status).toBe('paused');
    expect(completed.pause.status).toBe('paused');
    expect(completed.pause.guidance).toBe('Wait for approval.');
    expect(pauseStore.completions).toHaveLength(1);
  });

  it('reconciles session status from durable pause/intervention state after partial persistence failure', async () => {
    const { service, pauseStore } = createService();
    const running = await createRunningSession(service);
    await pauseStore.pause({
      ...scope,
      sessionId: running.id,
      pauseId: 'pause-1',
      reason: 'operator requested review',
      requestedBy: 'operator-1',
    });

    const reconciledPause = await service.getSession(running.id, scope);
    expect(reconciledPause.status).toBe('paused');

    await pauseStore.resume({
      ...scope,
      sessionId: running.id,
      resumeId: 'resume-1',
      resumedBy: 'operator-3',
    });
    const reconciledResume = await service.getSession(running.id, scope);
    expect(reconciledResume.status).toBe('running');
  });

  it('persists resume metadata and transitions paused or intervening sessions back to running', async () => {
    const { service, pauseStore } = createService();
    const running = await createRunningSession(service);
    await service.pauseSession(running.id, scope, {
      pauseId: 'pause-1',
      reason: 'operator requested review',
      requestedBy: 'operator-1',
    });
    await service.startIntervention(running.id, scope, {
      interventionId: 'intervention-1',
      interventionBy: 'operator-2',
    });

    const result = await service.resumeSession(running.id, scope, {
      resumeId: 'resume-1',
      resumedBy: 'operator-3',
      resumeMetadata: { releaseQueuedActions: true },
    });

    expect(result.session.status).toBe('running');
    expect(result.pause.status).toBe('resumed');
    expect(pauseStore.resumes).toHaveLength(1);
    expect(pauseStore.resumes[0].resumeMetadata).toEqual({ releaseQueuedActions: true });
  });
});
