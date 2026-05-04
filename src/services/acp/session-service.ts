import { randomUUID } from 'node:crypto';

import { transitionAcpSessionStatus } from './state-machine.js';
import type {
  AcpAgentSessionAttachment,
  AcpBackendMetadata,
  AcpBackendMetadataValue,
  AcpControlActionInput,
  AcpCreateSessionInput,
  AcpSessionRecord,
  AcpSessionScope,
  AcpSessionStore,
  AcpSessionTransitionEvent,
} from './types.js';

const MAX_BACKEND_METADATA_KEYS = 20;
const MAX_BACKEND_METADATA_KEY_BYTES = 128;
const MAX_BACKEND_METADATA_STRING_BYTES = 1024;
const BLOCKED_BACKEND_METADATA_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_BACKEND_METADATA_KEY_PATTERN =
  /(token|secret|password|api[_-]?key|authorization|cookie|prompt|payload|tool.*arg)/i;
const CONTROL_ACTION_TYPES = new Set([
  'prompt',
  'approve',
  'reject',
  'pause',
  'resume',
  'cancel',
  'driver_transfer',
  'intervene',
  'close',
]);

export interface AcpSessionServiceOptions {
  idProvider?: () => string;
  clock?: () => number;
}

export class AcpSessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`ACP session not found in the requested tenant and owner scope: ${sessionId}`);
    this.name = 'AcpSessionNotFoundError';
  }
}

export class AcpDurableIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcpDurableIdentityError';
  }
}

export class AcpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcpValidationError';
  }
}

export class AcpSessionService {
  private readonly idProvider: () => string;
  private readonly clock: () => number;

  constructor(
    private readonly store: AcpSessionStore,
    options: AcpSessionServiceOptions = {}
  ) {
    this.idProvider = options.idProvider ?? randomUUID;
    this.clock = options.clock ?? Date.now;
  }

  async createSession(input: AcpCreateSessionInput): Promise<AcpSessionRecord> {
    assertNoJsonRpcRequestId(input);
    assertScope(input);
    assertOptionalNonEmptyString(input.parentSessionId, 'parent session id');
    assertOptionalNonEmptyString(input.rootSessionId, 'root session id');
    assertOptionalNonEmptyString(input.correlationId, 'correlation id');
    assertOptionalNonEmptyString(input.resumeFromSessionId, 'resume-from session id');
    const now = this.clock();
    const id = this.createId('session id');
    const conversationId = this.createId('conversation id');
    const transcriptId = this.createId('transcript id');
    assertDistinctIdentityNamespaces([
      ['session id', id],
      ['tenant id', input.tenantId],
      ['owner key id', input.ownerKeyId],
      ['conversation id', conversationId],
      ['transcript id', transcriptId],
      ['parent session id', input.parentSessionId],
      ['root session id', input.rootSessionId],
      ['correlation id', input.correlationId],
      ['resume-from session id', input.resumeFromSessionId],
    ]);
    const record: AcpSessionRecord = {
      id,
      tenantId: input.tenantId,
      ownerKeyId: input.ownerKeyId,
      conversationId,
      transcriptId,
      status: 'initializing',
      createdAt: now,
      updatedAt: now,
      parentSessionId: input.parentSessionId,
      rootSessionId: input.rootSessionId,
      correlationId: input.correlationId,
      resumeFromSessionId: input.resumeFromSessionId,
      backendMetadata: normalizeBackendMetadata(input.backendMetadata),
    };

    await this.store.create(record);
    return cloneRecord(record);
  }

  async getSession(sessionId: string, scope: AcpSessionScope): Promise<AcpSessionRecord> {
    assertNonEmptyString(sessionId, 'session id');
    assertScope(scope);
    return this.requireSession(sessionId, scope);
  }

  async attachAgentSession(
    sessionId: string,
    scope: AcpSessionScope,
    attachment: AcpAgentSessionAttachment
  ): Promise<AcpSessionRecord> {
    assertNoJsonRpcRequestId(attachment);
    const record = await this.requireSession(sessionId, scope);
    const updated: AcpSessionRecord = {
      ...record,
      updatedAt: this.clock(),
    };

    if (attachment.acpAgentSessionId !== undefined) {
      assertNonEmptyString(attachment.acpAgentSessionId, 'ACP agent session id');
      updated.acpAgentSessionId = attachment.acpAgentSessionId;
    }
    if (attachment.claudeSessionId !== undefined) {
      assertNonEmptyString(attachment.claudeSessionId, 'Claude session id');
      updated.claudeSessionId = attachment.claudeSessionId;
    }
    if (attachment.backendRunId !== undefined) {
      assertNonEmptyString(attachment.backendRunId, 'backend run id');
      updated.currentBackendRunId = attachment.backendRunId;
    }
    if (attachment.backendMetadata !== undefined) {
      updated.backendMetadata = normalizeBackendMetadata(attachment.backendMetadata);
    }

    assertSessionIdentityNamespaces(updated);
    return this.persistUpdate(record, updated, scope);
  }

  async recordBackendRestart(
    sessionId: string,
    scope: AcpSessionScope,
    backendRunId = this.createId('backend run id')
  ): Promise<AcpSessionRecord> {
    assertNonEmptyString(backendRunId, 'backend run id');
    const record = await this.requireSession(sessionId, scope);
    const updated: AcpSessionRecord = {
      ...record,
      currentBackendRunId: backendRunId,
      updatedAt: this.clock(),
    };
    assertSessionIdentityNamespaces(updated);
    return this.persistUpdate(record, updated, scope);
  }

  async transition(
    sessionId: string,
    scope: AcpSessionScope,
    event: AcpSessionTransitionEvent
  ): Promise<AcpSessionRecord> {
    assertNoJsonRpcRequestId(event);
    const record = await this.requireSession(sessionId, scope);
    const nextStatus = transitionAcpSessionStatus(record.status, event);
    const now = this.clock();
    const updated: AcpSessionRecord = {
      ...record,
      status: nextStatus,
      updatedAt: now,
      closedAt: nextStatus === 'closed' ? record.closedAt ?? now : record.closedAt,
      failedAt: nextStatus === 'failed' ? record.failedAt ?? now : record.failedAt,
    };
    return this.persistUpdate(record, updated, scope);
  }

  private createId(label: string): string {
    const id = this.idProvider();
    assertNonEmptyString(id, label);
    return id;
  }

  private async requireSession(
    sessionId: string,
    scope: AcpSessionScope
  ): Promise<AcpSessionRecord> {
    assertNonEmptyString(sessionId, 'session id');
    assertScope(scope);
    const record = await this.store.get(sessionId, scope);
    if (!record) {
      throw new AcpSessionNotFoundError(sessionId);
    }
    assertRecordMatchesScope(record, scope);
    return cloneRecord(record);
  }

  private async persistUpdate(
    previous: AcpSessionRecord,
    updated: AcpSessionRecord,
    scope: AcpSessionScope
  ): Promise<AcpSessionRecord> {
    assertDurableIdentityPreserved(previous, updated);
    assertSessionIdentityNamespaces(updated);
    const persisted = await this.store.update(updated, scope);
    if (!persisted) {
      throw new AcpSessionNotFoundError(previous.id);
    }
    assertDurableIdentityPreserved(previous, persisted);
    assertRecordMatchesScope(persisted, scope);
    assertSessionIdentityNamespaces(persisted);
    return cloneRecord(persisted);
  }
}

export function validateAcpControlActionInput(input: AcpControlActionInput): void {
  assertNoJsonRpcRequestId(input);
  assertScope(input);
  assertNonEmptyString(input.sessionId, 'control action session id');
  assertNonEmptyString(input.actionId, 'control action id');
  assertControlActionType(input.type);
  assertOptionalNonEmptyString(input.idempotencyKey, 'control action idempotency key');
  assertOptionalNonEmptyString(input.approvalId, 'approval id');
  assertOptionalNonEmptyString(input.controlRequestId, 'control request id');
  normalizeBackendMetadata(input.metadata);
  assertDistinctIdentityNamespaces([
    ['tenant id', input.tenantId],
    ['owner key id', input.ownerKeyId],
    ['session id', input.sessionId],
    ['action id', input.actionId],
    ['approval id', input.approvalId],
    ['control request id', input.controlRequestId],
  ]);
}

function assertScope(scope: AcpSessionScope): void {
  assertNonEmptyString(scope.tenantId, 'tenant id');
  assertNonEmptyString(scope.ownerKeyId, 'owner key id');
}

function assertRecordMatchesScope(record: AcpSessionRecord, scope: AcpSessionScope): void {
  if (record.tenantId !== scope.tenantId || record.ownerKeyId !== scope.ownerKeyId) {
    throw new AcpSessionNotFoundError(record.id);
  }
}

function assertNoJsonRpcRequestId(input: object): void {
  if (Object.hasOwn(input, 'jsonRpcRequestId')) {
    throw new AcpDurableIdentityError(
      'JSON-RPC request ids are transport-scoped and cannot be stored as durable ACP identity'
    );
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AcpValidationError(`ACP ${label} must be a non-empty string`);
  }
}

function assertOptionalNonEmptyString(
  value: unknown,
  label: string
): asserts value is string | undefined {
  if (value !== undefined) {
    assertNonEmptyString(value, label);
  }
}

function assertControlActionType(value: unknown): void {
  if (typeof value !== 'string' || !CONTROL_ACTION_TYPES.has(value)) {
    throw new AcpValidationError('ACP control action type is not supported');
  }
}

function assertDurableIdentityPreserved(
  previous: AcpSessionRecord,
  updated: AcpSessionRecord
): void {
  const changedField =
    firstChangedField(previous, updated, [
      'id',
      'tenantId',
      'ownerKeyId',
      'conversationId',
      'transcriptId',
      'createdAt',
      'parentSessionId',
      'rootSessionId',
      'correlationId',
      'resumeFromSessionId',
    ]) ?? null;

  if (changedField) {
    throw new AcpDurableIdentityError(`ACP durable identity field cannot change: ${changedField}`);
  }
}

function assertSessionIdentityNamespaces(record: AcpSessionRecord): void {
  assertDistinctIdentityNamespaces([
    ['session id', record.id],
    ['tenant id', record.tenantId],
    ['owner key id', record.ownerKeyId],
    ['conversation id', record.conversationId],
    ['transcript id', record.transcriptId],
    ['ACP agent session id', record.acpAgentSessionId],
    ['Claude session id', record.claudeSessionId],
    ['backend run id', record.currentBackendRunId],
    ['parent session id', record.parentSessionId],
    ['root session id', record.rootSessionId],
    ['correlation id', record.correlationId],
    ['resume-from session id', record.resumeFromSessionId],
  ]);
}

function assertDistinctIdentityNamespaces(
  ids: readonly (readonly [string, string | undefined])[]
): void {
  const seen = new Map<string, string>();
  for (const [label, id] of ids) {
    if (id === undefined) continue;
    const firstLabel = seen.get(id);
    if (firstLabel) {
      throw new AcpDurableIdentityError(
        `ACP identity namespaces must be distinct: ${firstLabel} and ${label}`
      );
    }
    seen.set(id, label);
  }
}

function firstChangedField(
  previous: AcpSessionRecord,
  updated: AcpSessionRecord,
  fields: readonly (keyof AcpSessionRecord)[]
): keyof AcpSessionRecord | undefined {
  return fields.find(field => previous[field] !== updated[field]);
}

function normalizeBackendMetadata(
  metadata: Record<string, unknown> | undefined
): AcpBackendMetadata | undefined {
  if (metadata === undefined) return undefined;
  const entries = Object.entries(metadata);
  if (entries.length > MAX_BACKEND_METADATA_KEYS) {
    throw new AcpValidationError(
      `ACP backend metadata cannot contain more than ${MAX_BACKEND_METADATA_KEYS} keys`
    );
  }

  const normalized: AcpBackendMetadata = {};
  for (const [key, value] of entries) {
    assertNonEmptyString(key, 'backend metadata key');
    assertBackendMetadataKey(key);
    assertBackendMetadataValue(key, value);
    normalized[key] = value;
  }
  return normalized;
}

function assertBackendMetadataKey(key: string): void {
  if (BLOCKED_BACKEND_METADATA_KEYS.has(key)) {
    throw new AcpValidationError(`ACP backend metadata key is not allowed: ${key}`);
  }

  if (SENSITIVE_BACKEND_METADATA_KEY_PATTERN.test(key)) {
    throw new AcpValidationError(`ACP backend metadata key is sensitive: ${key}`);
  }

  if (Buffer.byteLength(key, 'utf8') > MAX_BACKEND_METADATA_KEY_BYTES) {
    throw new AcpValidationError(
      `ACP backend metadata key exceeds ${MAX_BACKEND_METADATA_KEY_BYTES} bytes`
    );
  }
}

function assertBackendMetadataValue(
  key: string,
  value: unknown
): asserts value is AcpBackendMetadataValue {
  if (
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    throw new AcpValidationError(`ACP backend metadata value must be primitive: ${key}`);
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new AcpValidationError(`ACP backend metadata number must be finite: ${key}`);
  }

  if (
    typeof value === 'string' &&
    Buffer.byteLength(value, 'utf8') > MAX_BACKEND_METADATA_STRING_BYTES
  ) {
    throw new AcpValidationError(
      `ACP backend metadata value exceeds ${MAX_BACKEND_METADATA_STRING_BYTES} bytes: ${key}`
    );
  }
}

function cloneRecord(record: AcpSessionRecord): AcpSessionRecord {
  return {
    ...record,
    backendMetadata:
      record.backendMetadata === undefined ? undefined : { ...record.backendMetadata },
  };
}
