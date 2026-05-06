/**
 * In-memory ACP pause/intervention store.
 *
 * Default store for local/dev deployments — no PostgreSQL required.
 * Records are lost on server restart; suitable for single-instance use.
 *
 * For production multi-instance deployments, use PostgresAcpPauseInterventionStore.
 */

import type {
  AcpPauseInterventionRecord,
  AcpPauseInterventionStore,
  AcpPauseSessionInput,
  AcpResumeSessionInput,
  AcpStartInterventionInput,
  AcpCompleteInterventionInput,
} from './pause-intervention.js';
import type { AcpSessionScope } from './types.js';

function scopeKey(sessionId: string, scope: AcpSessionScope): string {
  return `${scope.tenantId}:${scope.ownerKeyId}:${sessionId}`;
}

export class InMemoryPauseInterventionStore implements AcpPauseInterventionStore {
  private readonly records = new Map<string, AcpPauseInterventionRecord[]>();

  async pause(input: AcpPauseSessionInput): Promise<AcpPauseInterventionRecord> {
    const now = new Date();
    const record: AcpPauseInterventionRecord = {
      pauseId: input.pauseId,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      ownerKeyId: input.ownerKeyId,
      status: 'paused',
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      requestedBy: input.requestedBy,
      requestedAt: input.requestedAt ?? now,
      metadata: input.metadata,
      updatedAt: now,
    };
    const key = scopeKey(input.sessionId, input);
    let list = this.records.get(key);
    if (!list) {
      list = [];
      this.records.set(key, list);
    }
    list.push(record);
    return record;
  }

  async getActive(sessionId: string, scope: AcpSessionScope): Promise<AcpPauseInterventionRecord | null> {
    const list = this.records.get(scopeKey(sessionId, scope));
    if (!list) return null;
    // Find the latest non-resumed record
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].status !== 'resumed') return { ...list[i] };
    }
    return null;
  }

  async getLatest(sessionId: string, scope: AcpSessionScope): Promise<AcpPauseInterventionRecord | null> {
    const list = this.records.get(scopeKey(sessionId, scope));
    if (!list || list.length === 0) return null;
    return { ...list[list.length - 1] };
  }

  async startIntervention(input: AcpStartInterventionInput): Promise<AcpPauseInterventionRecord | null> {
    const key = scopeKey(input.sessionId, input);
    const list = this.records.get(key);
    if (!list) return null;
    const active = this.findActive(list);
    if (!active) return null;
    active.status = 'intervening';
    active.interventionId = input.interventionId;
    active.interventionBy = input.interventionBy;
    active.interventionStartedAt = input.startedAt ?? new Date();
    active.updatedAt = new Date();
    return { ...active };
  }

  async completeIntervention(input: AcpCompleteInterventionInput): Promise<AcpPauseInterventionRecord | null> {
    const key = scopeKey(input.sessionId, input);
    const list = this.records.get(key);
    if (!list) return null;
    const active = this.findActive(list);
    if (!active || active.interventionId !== input.interventionId) return null;
    active.interventionCompletedBy = input.completedBy;
    active.interventionCompletedAt = input.completedAt ?? new Date();
    active.guidance = input.guidance;
    active.updatedAt = new Date();
    return { ...active };
  }

  async resume(input: AcpResumeSessionInput): Promise<AcpPauseInterventionRecord | null> {
    const key = scopeKey(input.sessionId, input);
    const list = this.records.get(key);
    if (!list) return null;
    const active = this.findActive(list);
    if (!active) return null;
    active.status = 'resumed';
    active.resumeId = input.resumeId;
    active.resumedBy = input.resumedBy;
    active.resumedAt = input.resumedAt ?? new Date();
    active.resumeMetadata = input.resumeMetadata;
    active.updatedAt = new Date();
    return { ...active };
  }

  private findActive(list: AcpPauseInterventionRecord[]): AcpPauseInterventionRecord | undefined {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].status !== 'resumed') return list[i];
    }
    return undefined;
  }
}
