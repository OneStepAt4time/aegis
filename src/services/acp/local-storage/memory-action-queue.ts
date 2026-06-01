import { AcpDurableIdentityError, AcpValidationError } from '../errors.js';
import { validateAcpControlActionInput } from '../session-service.js';
import {
  normalizeAcpActionMetadata,
  type AcpActionMetadata,
  type AcpActionQueue,
  type AcpActionRecord,
  type AcpCancelActionOptions,
  type AcpCompleteActionOptions,
  type AcpEnqueueActionOptions,
  type AcpFailActionOptions,
  type AcpLeaseActionOptions,
} from '../action-queue.js';
import type { AcpControlActionInput } from '../types.js';
import type { AcpSessionScope } from '../types.js';
import { cloneAction } from './clone.js';
import {
  assertValidDate,
  validateActionIdAndScope,
  validateScope,
} from './validation.js';
import { compareLeaseOrder } from './persistence.js';
import { createEmptyState, noopMutationHook } from './types.js';
import type { LocalState, MutationHook } from './types.js';

export class MemoryAcpActionQueue implements AcpActionQueue {
  constructor(
    private state: LocalState = createEmptyState(),
    private readonly onMutation: MutationHook = noopMutationHook
  ) {}

  async enqueue(
    input: AcpControlActionInput,
    options: AcpEnqueueActionOptions = {}
  ): Promise<AcpActionRecord> {
    validateAcpControlActionInput(input);
    const metadata = normalizeAcpActionMetadata(input.metadata) ?? {};
    const availableAt = options.availableAt ?? new Date();
    assertValidDate(availableAt, 'action availableAt');

    if (input.idempotencyKey !== undefined) {
      const existing = this.findByIdempotencyKey(input, input.idempotencyKey);
      if (existing !== null) return existing;
    }
    if (this.state.actions.some(action => action.actionId === input.actionId)) {
      throw new AcpDurableIdentityError(`ACP action id already exists: ${input.actionId}`);
    }

    const record: AcpActionRecord = {
      actionId: input.actionId,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      ownerKeyId: input.ownerKeyId,
      actionType: input.type,
      idempotencyKey: input.idempotencyKey,
      status: 'queued',
      createdAt: new Date(),
      availableAt: new Date(availableAt.getTime()),
      attemptCount: 0,
      approvalId: input.approvalId,
      controlRequestId: input.controlRequestId,
      metadata,
    };
    this.state.actions.push(cloneAction(record));
    this.state.actionOrder.set(record.actionId, this.state.nextActionOrder);
    this.state.nextActionOrder += 1;
    await this.onMutation();
    return cloneAction(record);
  }

  async leaseNext(
    scope: AcpSessionScope,
    options: AcpLeaseActionOptions
  ): Promise<AcpActionRecord | null> {
    validateScope(scope);
    const now = options.now ?? new Date();
    assertValidDate(now, 'action lease now');
    assertValidDate(options.leaseUntil, 'action leaseUntil');
    if (options.leaseUntil.getTime() <= now.getTime()) {
      throw new AcpValidationError('ACP action leaseUntil must be after now');
    }
    const candidate = this.state.actions
      .filter(
        action =>
          action.tenantId === scope.tenantId &&
          action.ownerKeyId === scope.ownerKeyId &&
          action.status === 'queued' &&
          action.availableAt.getTime() <= now.getTime()
      )
      .sort((left, right) => compareLeaseOrder(this.state, left, right))[0];
    if (candidate === undefined) return null;
    candidate.status = 'leased';
    candidate.leasedUntil = new Date(options.leaseUntil.getTime());
    candidate.attemptCount += 1;
    await this.onMutation();
    return cloneAction(candidate);
  }

  async complete(
    actionId: string,
    scope: AcpSessionScope,
    options: AcpCompleteActionOptions = {}
  ): Promise<AcpActionRecord | null> {
    const resultMetadata = normalizeAcpActionMetadata(
      options.resultMetadata,
      'action result metadata'
    );
    return this.finishLeased(actionId, scope, options.now, 'completed', resultMetadata);
  }

  async fail(
    actionId: string,
    scope: AcpSessionScope,
    options: AcpFailActionOptions = {}
  ): Promise<AcpActionRecord | null> {
    const errorMetadata = normalizeAcpActionMetadata(options.errorMetadata, 'action error metadata');
    return this.finishLeased(actionId, scope, options.now, 'failed', errorMetadata);
  }

  async cancel(
    actionId: string,
    scope: AcpSessionScope,
    options: AcpCancelActionOptions = {}
  ): Promise<AcpActionRecord | null> {
    validateActionIdAndScope(actionId, scope);
    const now = options.now ?? new Date();
    assertValidDate(now, 'action cancellation time');
    const action = this.findAction(actionId, scope);
    if (action === null || (action.status !== 'queued' && action.status !== 'leased')) return null;
    action.status = 'cancelled';
    action.errorMetadata = normalizeAcpActionMetadata(options.errorMetadata, 'action error metadata');
    action.cancelledAt = new Date(now.getTime());
    action.leasedUntil = undefined;
    await this.onMutation();
    return cloneAction(action);
  }

  replaceState(state: LocalState): void {
    this.state = state;
  }

  async sweepOrphanedActions(now: Date = new Date()): Promise<AcpActionRecord[]> {
    const recovered: AcpActionRecord[] = [];
    for (const action of this.state.actions) {
      if (
        action.status === 'leased' &&
        action.leasedUntil !== undefined &&
        action.leasedUntil.getTime() <= now.getTime()
      ) {
        action.status = 'failed';
        action.failedAt = new Date(now.getTime());
        action.leasedUntil = undefined;
        action.errorMetadata = {
          sweeper: true,
          reason: 'lease_expired',
          recoveredAt: now.toISOString(),
        };
        recovered.push(cloneAction(action));
      }
    }
    if (recovered.length > 0) {
      await this.onMutation();
    }
    return recovered;
  }

  private findByIdempotencyKey(
    input: AcpControlActionInput,
    idempotencyKey: string
  ): AcpActionRecord | null {
    const action = this.state.actions.find(
      record =>
        record.tenantId === input.tenantId &&
        record.ownerKeyId === input.ownerKeyId &&
        record.sessionId === input.sessionId &&
        record.idempotencyKey === idempotencyKey
    );
    return action === undefined ? null : cloneAction(action);
  }

  private async finishLeased(
    actionId: string,
    scope: AcpSessionScope,
    nowValue: Date | undefined,
    status: 'completed' | 'failed',
    metadata: AcpActionMetadata | undefined
  ): Promise<AcpActionRecord | null> {
    validateActionIdAndScope(actionId, scope);
    const now = nowValue ?? new Date();
    assertValidDate(now, status === 'completed' ? 'action completion time' : 'action failure time');
    const action = this.findAction(actionId, scope);
    if (action === null || action.status !== 'leased') return null;
    action.status = status;
    action.leasedUntil = undefined;
    if (status === 'completed') {
      action.resultMetadata = metadata;
      action.completedAt = new Date(now.getTime());
    } else {
      action.errorMetadata = metadata;
      action.failedAt = new Date(now.getTime());
    }
    await this.onMutation();
    return cloneAction(action);
  }

  private findAction(actionId: string, scope: AcpSessionScope): AcpActionRecord | null {
    return (
      this.state.actions.find(
        action =>
          action.actionId === actionId &&
          action.tenantId === scope.tenantId &&
          action.ownerKeyId === scope.ownerKeyId
      ) ?? null
    );
  }
}
