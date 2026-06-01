import { AcpDurableIdentityError } from '../errors.js';
import type {
  AcpCompleteInterventionInput,
  AcpPauseInterventionRecord,
  AcpPauseInterventionStore,
  AcpPauseSessionInput,
  AcpResumeSessionInput,
  AcpStartInterventionInput,
} from '../pause-intervention.js';
import type { AcpSessionScope } from '../types.js';
import { clonePauseIntervention } from './clone.js';
import { validateScope } from './validation.js';
import { createEmptyState, noopMutationHook } from './types.js';
import type { LocalState, MutationHook } from './types.js';

export class MemoryAcpPauseInterventionStore implements AcpPauseInterventionStore {
  constructor(
    private state: LocalState = createEmptyState(),
    private readonly onMutation: MutationHook = noopMutationHook,
  ) {}

  async pause(input: AcpPauseSessionInput): Promise<AcpPauseInterventionRecord> {
    validateScope(input);
    const existing = this.state.pauseInterventions.find(
      (p) =>
        p.sessionId === input.sessionId &&
        p.tenantId === input.tenantId &&
        p.ownerKeyId === input.ownerKeyId &&
        (p.status === 'paused' || p.status === 'intervening'),
    );
    if (existing !== undefined) {
      throw new AcpDurableIdentityError(
        `ACP pause already active for session: ${input.sessionId}`,
      );
    }
    const record: AcpPauseInterventionRecord = {
      pauseId: input.pauseId,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      ownerKeyId: input.ownerKeyId,
      status: 'paused',
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      requestedBy: input.requestedBy,
      requestedAt: input.requestedAt ?? new Date(),
      metadata: input.metadata === undefined ? undefined : { ...input.metadata },
      updatedAt: new Date(),
    };
    this.state.pauseInterventions.push(clonePauseIntervention(record));
    await this.onMutation();
    return clonePauseIntervention(record);
  }

  async getActive(
    sessionId: string,
    scope: AcpSessionScope,
  ): Promise<AcpPauseInterventionRecord | null> {
    validateScope(scope);
    const record = this.state.pauseInterventions
      .filter(
        (p) =>
          p.sessionId === sessionId &&
          p.tenantId === scope.tenantId &&
          p.ownerKeyId === scope.ownerKeyId &&
          (p.status === 'paused' || p.status === 'intervening'),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    return record === undefined ? null : clonePauseIntervention(record);
  }

  async getLatest(
    sessionId: string,
    scope: AcpSessionScope,
  ): Promise<AcpPauseInterventionRecord | null> {
    validateScope(scope);
    const record = this.state.pauseInterventions
      .filter(
        (p) =>
          p.sessionId === sessionId &&
          p.tenantId === scope.tenantId &&
          p.ownerKeyId === scope.ownerKeyId,
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    return record === undefined ? null : clonePauseIntervention(record);
  }

  async startIntervention(
    input: AcpStartInterventionInput,
  ): Promise<AcpPauseInterventionRecord | null> {
    validateScope(input);
    const record = this.state.pauseInterventions.find(
      (p) =>
        p.sessionId === input.sessionId &&
        p.tenantId === input.tenantId &&
        p.ownerKeyId === input.ownerKeyId &&
        p.status === 'paused',
    );
    if (record === undefined) return null;
    record.status = 'intervening';
    record.interventionId = input.interventionId;
    record.interventionBy = input.interventionBy;
    record.interventionStartedAt = input.startedAt ?? new Date();
    record.updatedAt = new Date();
    await this.onMutation();
    return clonePauseIntervention(record);
  }

  async completeIntervention(
    input: AcpCompleteInterventionInput,
  ): Promise<AcpPauseInterventionRecord | null> {
    validateScope(input);
    const record = this.state.pauseInterventions.find(
      (p) =>
        p.sessionId === input.sessionId &&
        p.tenantId === input.tenantId &&
        p.ownerKeyId === input.ownerKeyId &&
        p.status === 'intervening' &&
        p.interventionId === input.interventionId,
    );
    if (record === undefined) return null;
    record.interventionCompletedBy = input.completedBy;
    record.interventionCompletedAt = input.completedAt ?? new Date();
    record.guidance = input.guidance;
    record.updatedAt = new Date();
    await this.onMutation();
    return clonePauseIntervention(record);
  }

  async resume(input: AcpResumeSessionInput): Promise<AcpPauseInterventionRecord | null> {
    validateScope(input);
    const record = this.state.pauseInterventions.find(
      (p) =>
        p.sessionId === input.sessionId &&
        p.tenantId === input.tenantId &&
        p.ownerKeyId === input.ownerKeyId &&
        (p.status === 'paused' || p.status === 'intervening'),
    );
    if (record === undefined) return null;
    record.status = 'resumed';
    record.resumeId = input.resumeId;
    record.resumedBy = input.resumedBy;
    record.resumedAt = input.resumedAt ?? new Date();
    record.updatedAt = new Date();
    await this.onMutation();
    return clonePauseIntervention(record);
  }

  replaceState(state: LocalState): void {
    this.state = state;
  }
}
