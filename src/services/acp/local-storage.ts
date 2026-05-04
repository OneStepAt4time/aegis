import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ServiceHealth } from '../../container.js';
import {
  AcpDurableIdentityError,
  AcpValidationError,
  validateAcpControlActionInput,
} from './session-service.js';
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
} from './action-queue.js';
import type {
  AcpAppendEventInput,
  AcpEventPayload,
  AcpEventRecord,
  AcpEventStore,
  AcpListEventsInput,
} from './event-store.js';
import type {
  AcpControlActionInput,
  AcpSessionRecord,
  AcpSessionScope,
  AcpSessionStore,
} from './types.js';

export interface AcpLocalStorageProfile {
  sessionStore: AcpSessionStore;
  eventStore: AcpEventStore;
  actionQueue: AcpActionQueue;
  start(): Promise<void>;
  stop(signal?: AbortSignal): Promise<void>;
  health(): Promise<ServiceHealth>;
}

export interface FileAcpLocalStorageProfileConfig {
  filePath: string;
}

interface LocalState {
  sessions: AcpSessionRecord[];
  events: AcpEventRecord[];
  actions: AcpActionRecord[];
  actionOrder: Map<string, number>;
  nextActionOrder: number;
}

type MutationHook = () => Promise<void>;

const noopMutationHook: MutationHook = async () => {};
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 1_000;

export function createMemoryAcpLocalStorageProfile(): AcpLocalStorageProfile {
  return new MemoryAcpLocalStorageProfile();
}

export function createFileAcpLocalStorageProfile(
  config: FileAcpLocalStorageProfileConfig
): AcpLocalStorageProfile {
  return new FileAcpLocalStorageProfile(config);
}

export class MemoryAcpLocalStorageProfile implements AcpLocalStorageProfile {
  private readonly state: LocalState;
  readonly sessionStore: AcpSessionStore;
  readonly eventStore: AcpEventStore;
  readonly actionQueue: AcpActionQueue;

  constructor(state: LocalState = createEmptyState(), onMutation = noopMutationHook) {
    this.state = state;
    this.sessionStore = new MemoryAcpSessionStore(this.state, onMutation);
    this.eventStore = new MemoryAcpEventStore(this.state, onMutation);
    this.actionQueue = new MemoryAcpActionQueue(this.state, onMutation);
  }

  async start(): Promise<void> {}

  async stop(_signal?: AbortSignal): Promise<void> {}

  async health(): Promise<ServiceHealth> {
    return { healthy: true, details: 'memory ACP local storage profile ok' };
  }
}

export class FileAcpLocalStorageProfile implements AcpLocalStorageProfile {
  private state = createEmptyState();
  private started = false;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly memorySessionStore: MemoryAcpSessionStore;
  private readonly memoryEventStore: MemoryAcpEventStore;
  private readonly memoryActionQueue: MemoryAcpActionQueue;

  readonly sessionStore: AcpSessionStore;
  readonly eventStore: AcpEventStore;
  readonly actionQueue: AcpActionQueue;

  constructor(private readonly config: FileAcpLocalStorageProfileConfig) {
    const persist = async (): Promise<void> => this.persist();
    this.memorySessionStore = new MemoryAcpSessionStore(this.state, persist);
    this.memoryEventStore = new MemoryAcpEventStore(this.state, persist);
    this.memoryActionQueue = new MemoryAcpActionQueue(this.state, persist);
    this.sessionStore = this.memorySessionStore;
    this.eventStore = this.memoryEventStore;
    this.actionQueue = this.memoryActionQueue;
  }

  async start(): Promise<void> {
    if (this.started) return;
    await mkdir(path.dirname(this.config.filePath), { recursive: true });
    this.state = await loadState(this.config.filePath);
    this.memorySessionStore.replaceState(this.state);
    this.memoryEventStore.replaceState(this.state);
    this.memoryActionQueue.replaceState(this.state);
    this.started = true;
    await this.persist();
  }

  async stop(_signal?: AbortSignal): Promise<void> {
    if (!this.started) return;
    await this.writeChain;
    this.started = false;
  }

  async health(): Promise<ServiceHealth> {
    if (!this.started) {
      return { healthy: false, details: 'file ACP local storage profile not started' };
    }
    return { healthy: true, details: 'file ACP local storage profile ok' };
  }

  private async persist(): Promise<void> {
    if (!this.started) {
      throw new Error('FileAcpLocalStorageProfile: start() must be called before use');
    }
    const content = `${JSON.stringify(serializeState(this.state), null, 2)}\n`;
    this.writeChain = this.writeChain.then(() => writeFile(this.config.filePath, content, 'utf8'));
    await this.writeChain;
  }
}

export class MemoryAcpSessionStore implements AcpSessionStore {
  constructor(
    private state: LocalState = createEmptyState(),
    private readonly onMutation: MutationHook = noopMutationHook
  ) {}

  async create(record: AcpSessionRecord): Promise<void> {
    const existing = this.state.sessions.find(
      session =>
        session.id === record.id &&
        session.tenantId === record.tenantId &&
        session.ownerKeyId === record.ownerKeyId
    );
    if (existing !== undefined) {
      throw new AcpDurableIdentityError(`ACP session already exists: ${record.id}`);
    }
    this.state.sessions.push(cloneSession(record));
    await this.onMutation();
  }

  async get(id: string, scope: AcpSessionScope): Promise<AcpSessionRecord | null> {
    validateScope(scope);
    const record = this.state.sessions.find(
      session =>
        session.id === id &&
        session.tenantId === scope.tenantId &&
        session.ownerKeyId === scope.ownerKeyId
    );
    return record === undefined ? null : cloneSession(record);
  }

  async update(record: AcpSessionRecord, scope: AcpSessionScope): Promise<AcpSessionRecord | null> {
    validateScope(scope);
    if (record.tenantId !== scope.tenantId || record.ownerKeyId !== scope.ownerKeyId) {
      throw new Error('MemoryAcpSessionStore: record scope does not match requested scope');
    }
    const index = this.state.sessions.findIndex(
      session =>
        session.id === record.id &&
        session.tenantId === scope.tenantId &&
        session.ownerKeyId === scope.ownerKeyId
    );
    const previous = this.state.sessions[index];
    if (previous === undefined) return null;
    const persisted: AcpSessionRecord = {
      ...previous,
      acpAgentSessionId: record.acpAgentSessionId,
      claudeSessionId: record.claudeSessionId,
      currentBackendRunId: record.currentBackendRunId,
      status: record.status,
      updatedAt: record.updatedAt,
      closedAt: record.closedAt,
      failedAt: record.failedAt,
      backendMetadata: record.backendMetadata === undefined ? undefined : { ...record.backendMetadata },
    };
    this.state.sessions[index] = cloneSession(persisted);
    await this.onMutation();
    return cloneSession(persisted);
  }

  replaceState(state: LocalState): void {
    this.state = state;
  }
}

export class MemoryAcpEventStore implements AcpEventStore {
  constructor(
    private state: LocalState = createEmptyState(),
    private readonly onMutation: MutationHook = noopMutationHook
  ) {}

  async append(input: AcpAppendEventInput): Promise<AcpEventRecord> {
    const validated = validateAppendInput(input);
    const scopeConflict = this.state.events.find(
      event =>
        event.sessionId === validated.sessionId &&
        (event.tenantId !== validated.tenantId || event.ownerKeyId !== validated.ownerKeyId)
    );
    if (scopeConflict !== undefined) {
      throw new Error('MemoryAcpEventStore: session scope does not match existing event stream');
    }
    const eventSeq = nextEventSeq(this.state, validated.sessionId);
    const record: AcpEventRecord = {
      ...validated,
      eventSeq,
      eventId: `${validated.tenantId}:${validated.ownerKeyId}:${validated.sessionId}:${eventSeq}`,
      occurredAt: new Date(validated.occurredAt.getTime()),
      ingestedAt: new Date(),
      payload: clonePayload(validated.payload),
    };
    this.state.events.push(cloneEvent(record));
    await this.onMutation();
    return cloneEvent(record);
  }

  async list(input: AcpListEventsInput): Promise<AcpEventRecord[]> {
    validateListInput(input);
    const afterEventSeq = resolveAfterEventSeq(input.afterEventSeq);
    const limit = resolveLimit(input.limit);
    return this.state.events
      .filter(
        event =>
          event.sessionId === input.sessionId &&
          event.tenantId === input.tenantId &&
          event.ownerKeyId === input.ownerKeyId &&
          event.eventSeq > afterEventSeq
      )
      .sort((left, right) => left.eventSeq - right.eventSeq)
      .slice(0, limit)
      .map(cloneEvent);
  }

  replaceState(state: LocalState): void {
    this.state = state;
  }
}

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

function createEmptyState(): LocalState {
  return { sessions: [], events: [], actions: [], actionOrder: new Map(), nextActionOrder: 0 };
}

async function loadState(filePath: string): Promise<LocalState> {
  try {
    return deserializeState(JSON.parse(await readFile(filePath, 'utf8')));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return createEmptyState();
    throw error;
  }
}

interface SerializedEvent extends Omit<AcpEventRecord, 'occurredAt' | 'ingestedAt'> {
  occurredAt: string;
  ingestedAt: string;
}

interface SerializedAction
  extends Omit<
    AcpActionRecord,
    'createdAt' | 'availableAt' | 'leasedUntil' | 'completedAt' | 'failedAt' | 'cancelledAt'
  > {
  createdAt: string;
  availableAt: string;
  leasedUntil?: string;
  completedAt?: string;
  failedAt?: string;
  cancelledAt?: string;
}

interface SerializedState {
  version: 1;
  sessions: AcpSessionRecord[];
  events: SerializedEvent[];
  actions: SerializedAction[];
}

function serializeState(state: LocalState): SerializedState {
  return {
    version: 1,
    sessions: state.sessions.map(cloneSession),
    events: state.events.map(event => ({
      ...cloneEvent(event),
      occurredAt: event.occurredAt.toISOString(),
      ingestedAt: event.ingestedAt.toISOString(),
    })),
    actions: state.actions.map(action => ({
      ...cloneAction(action),
      createdAt: action.createdAt.toISOString(),
      availableAt: action.availableAt.toISOString(),
      leasedUntil: action.leasedUntil?.toISOString(),
      completedAt: action.completedAt?.toISOString(),
      failedAt: action.failedAt?.toISOString(),
      cancelledAt: action.cancelledAt?.toISOString(),
    })),
  };
}

function deserializeState(value: unknown): LocalState {
  if (!isSerializedState(value)) {
    throw new Error('FileAcpLocalStorageProfile: invalid storage file');
  }
  const actions = value.actions.map(action => ({
    ...action,
    createdAt: parseDate(action.createdAt, 'action.createdAt'),
    availableAt: parseDate(action.availableAt, 'action.availableAt'),
    leasedUntil: parseOptionalDate(action.leasedUntil, 'action.leasedUntil'),
    completedAt: parseOptionalDate(action.completedAt, 'action.completedAt'),
    failedAt: parseOptionalDate(action.failedAt, 'action.failedAt'),
    cancelledAt: parseOptionalDate(action.cancelledAt, 'action.cancelledAt'),
  }));
  const actionOrder = new Map<string, number>();
  actions.forEach((action, index) => actionOrder.set(action.actionId, index));
  return {
    sessions: value.sessions.map(cloneSession),
    events: value.events.map(event => ({
      ...event,
      occurredAt: parseDate(event.occurredAt, 'event.occurredAt'),
      ingestedAt: parseDate(event.ingestedAt, 'event.ingestedAt'),
      payload: clonePayload(event.payload),
    })),
    actions,
    actionOrder,
    nextActionOrder: actions.length,
  };
}

function isSerializedState(value: unknown): value is SerializedState {
  if (!isRecord(value) || value.version !== 1) return false;
  return Array.isArray(value.sessions) && Array.isArray(value.events) && Array.isArray(value.actions);
}

function validateAppendInput(input: AcpAppendEventInput): AcpAppendEventInput & { occurredAt: Date } {
  return {
    sessionId: requireNonEmptyString(input.sessionId, 'sessionId'),
    tenantId: requireNonEmptyString(input.tenantId, 'tenantId'),
    ownerKeyId: requireNonEmptyString(input.ownerKeyId, 'ownerKeyId'),
    backendRunId: requireOptionalNonEmptyString(input.backendRunId, 'backendRunId'),
    eventType: requireNonEmptyString(input.eventType, 'eventType'),
    occurredAt: resolveOccurredAt(input.occurredAt),
    payload: clonePayload(input.payload),
    payloadRef: requireOptionalNonEmptyString(input.payloadRef, 'payloadRef'),
  };
}

function validateListInput(input: AcpListEventsInput): void {
  requireNonEmptyString(input.sessionId, 'sessionId');
  requireNonEmptyString(input.tenantId, 'tenantId');
  requireNonEmptyString(input.ownerKeyId, 'ownerKeyId');
}

function nextEventSeq(state: LocalState, sessionId: string): number {
  return Math.max(0, ...state.events.filter(event => event.sessionId === sessionId).map(event => event.eventSeq)) + 1;
}

function compareLeaseOrder(state: LocalState, left: AcpActionRecord, right: AcpActionRecord): number {
  const availableDelta = left.availableAt.getTime() - right.availableAt.getTime();
  if (availableDelta !== 0) return availableDelta;
  const createdDelta = left.createdAt.getTime() - right.createdAt.getTime();
  if (createdDelta !== 0) return createdDelta;
  return (state.actionOrder.get(left.actionId) ?? 0) - (state.actionOrder.get(right.actionId) ?? 0);
}

function resolveOccurredAt(value: Date | undefined): Date {
  if (value === undefined) return new Date();
  assertValidDate(value, 'event occurredAt');
  return new Date(value.getTime());
}

function resolveAfterEventSeq(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AcpValidationError('ACP afterEventSeq must be a non-negative safe integer');
  }
  return value;
}

function resolveLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIST_LIMIT;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_LIST_LIMIT) {
    throw new AcpValidationError(`ACP event replay limit must be between 1 and ${MAX_LIST_LIMIT}`);
  }
  return value;
}

function validateActionIdAndScope(actionId: string, scope: AcpSessionScope): void {
  requireNonEmptyString(actionId, 'action id');
  validateScope(scope);
}

function validateScope(scope: AcpSessionScope): void {
  requireNonEmptyString(scope.tenantId, 'tenant id');
  requireNonEmptyString(scope.ownerKeyId, 'owner key id');
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AcpValidationError(`ACP ${label} must be a non-empty string`);
  }
  return value;
}

function requireOptionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireNonEmptyString(value, label);
}

function assertValidDate(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AcpValidationError(`ACP ${label} must be a valid Date`);
  }
}

function cloneSession(record: AcpSessionRecord): AcpSessionRecord {
  return {
    ...record,
    backendMetadata: record.backendMetadata === undefined ? undefined : { ...record.backendMetadata },
  };
}

function cloneEvent(record: AcpEventRecord): AcpEventRecord {
  return {
    ...record,
    occurredAt: new Date(record.occurredAt.getTime()),
    ingestedAt: new Date(record.ingestedAt.getTime()),
    payload: clonePayload(record.payload),
  };
}

function cloneAction(record: AcpActionRecord): AcpActionRecord {
  return {
    ...record,
    createdAt: new Date(record.createdAt.getTime()),
    availableAt: new Date(record.availableAt.getTime()),
    leasedUntil: cloneOptionalDate(record.leasedUntil),
    completedAt: cloneOptionalDate(record.completedAt),
    failedAt: cloneOptionalDate(record.failedAt),
    cancelledAt: cloneOptionalDate(record.cancelledAt),
    metadata: record.metadata === undefined ? undefined : { ...record.metadata },
    resultMetadata: record.resultMetadata === undefined ? undefined : { ...record.resultMetadata },
    errorMetadata: record.errorMetadata === undefined ? undefined : { ...record.errorMetadata },
  };
}

function clonePayload(value: unknown): AcpEventPayload {
  validateJsonValue(value, 'payload', new WeakSet<object>());
  return structuredClone(value);
}

function validateJsonValue(
  value: unknown,
  label: string,
  seen: WeakSet<object>
): asserts value is AcpEventPayload {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new AcpValidationError(`ACP ${label} number must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new AcpValidationError(`ACP ${label} cannot be circular`);
    seen.add(value);
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new AcpValidationError(`ACP ${label} cannot contain sparse arrays`);
      validateJsonValue(value[index], label, seen);
    }
    seen.delete(value);
    return;
  }
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new AcpValidationError(`ACP ${label} object must be a plain JSON object`);
    }
    if (seen.has(value)) throw new AcpValidationError(`ACP ${label} cannot be circular`);
    seen.add(value);
    Object.values(value).forEach(property => validateJsonValue(property, label, seen));
    seen.delete(value);
    return;
  }
  throw new AcpValidationError(`ACP ${label} must be serializable JSON`);
}

function parseDate(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`FileAcpLocalStorageProfile: ${label} must be a valid date string`);
  }
  return date;
}

function parseOptionalDate(value: string | undefined, label: string): Date | undefined {
  return value === undefined ? undefined : parseDate(value, label);
}

function cloneOptionalDate(value: Date | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value.getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

