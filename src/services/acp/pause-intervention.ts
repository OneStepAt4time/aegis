import { Buffer } from 'node:buffer';

import { AcpDurableIdentityError, AcpValidationError } from './session-service.js';
import type { AcpBackendMetadataValue, AcpSessionScope } from './types.js';

export type AcpPauseInterventionStatus = 'paused' | 'intervening' | 'resumed';
export type AcpPauseInterventionMetadataValue = AcpBackendMetadataValue;
export type AcpPauseInterventionMetadata = Record<string, AcpPauseInterventionMetadataValue>;

export interface AcpPauseInterventionRecord extends AcpSessionScope {
  pauseId: string;
  sessionId: string;
  status: AcpPauseInterventionStatus;
  idempotencyKey?: string;
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  metadata?: AcpPauseInterventionMetadata;
  interventionId?: string;
  interventionBy?: string;
  interventionStartedAt?: Date;
  interventionCompletedBy?: string;
  interventionCompletedAt?: Date;
  guidance?: string;
  resumeId?: string;
  resumedBy?: string;
  resumedAt?: Date;
  resumeMetadata?: AcpPauseInterventionMetadata;
  updatedAt: Date;
}

export interface AcpPauseSessionInput extends AcpSessionScope {
  pauseId: string;
  sessionId: string;
  reason: string;
  requestedBy: string;
  requestedAt?: Date;
  idempotencyKey?: string;
  metadata?: AcpPauseInterventionMetadata;
}

export interface AcpStartInterventionInput extends AcpSessionScope {
  sessionId: string;
  interventionId: string;
  interventionBy: string;
  startedAt?: Date;
}

export interface AcpCompleteInterventionInput extends AcpSessionScope {
  sessionId: string;
  interventionId: string;
  completedBy: string;
  completedAt?: Date;
  guidance?: string;
}

export interface AcpResumeSessionInput extends AcpSessionScope {
  sessionId: string;
  resumeId: string;
  resumedBy: string;
  resumedAt?: Date;
  resumeMetadata?: AcpPauseInterventionMetadata;
}

export interface AcpPauseInterventionStore {
  pause(input: AcpPauseSessionInput): Promise<AcpPauseInterventionRecord>;
  getActive(sessionId: string, scope: AcpSessionScope): Promise<AcpPauseInterventionRecord | null>;
  getLatest(sessionId: string, scope: AcpSessionScope): Promise<AcpPauseInterventionRecord | null>;
  startIntervention(input: AcpStartInterventionInput): Promise<AcpPauseInterventionRecord | null>;
  completeIntervention(input: AcpCompleteInterventionInput): Promise<AcpPauseInterventionRecord | null>;
  resume(input: AcpResumeSessionInput): Promise<AcpPauseInterventionRecord | null>;
}

const MAX_METADATA_KEYS = 20;
const MAX_METADATA_KEY_BYTES = 128;
const MAX_METADATA_STRING_BYTES = 1024;
const MAX_REASON_BYTES = 2048;
const MAX_GUIDANCE_BYTES = 8192;
const BLOCKED_METADATA_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_METADATA_KEY_PATTERN =
  /(token|secret|password|api[_-]?key|authorization|cookie|prompt|payload|tool.*arg)/i;

export function validateAcpPauseSessionInput(input: AcpPauseSessionInput): void {
  assertNoJsonRpcRequestId(input);
  validateScope(input);
  assertNonEmptyString(input.sessionId, 'session id');
  assertNonEmptyString(input.pauseId, 'pause id');
  assertNonEmptyString(input.requestedBy, 'pause requestedBy');
  assertBoundedString(input.reason, 'pause reason', MAX_REASON_BYTES);
  assertOptionalNonEmptyString(input.idempotencyKey, 'pause idempotency key');
  assertOptionalDate(input.requestedAt, 'pause requestedAt');
  normalizeAcpPauseInterventionMetadata(input.metadata);
}

export function validateAcpStartInterventionInput(input: AcpStartInterventionInput): void {
  assertNoJsonRpcRequestId(input);
  validateScope(input);
  assertNonEmptyString(input.sessionId, 'session id');
  assertNonEmptyString(input.interventionId, 'intervention id');
  assertNonEmptyString(input.interventionBy, 'interventionBy');
  assertOptionalDate(input.startedAt, 'intervention startedAt');
}

export function validateAcpCompleteInterventionInput(input: AcpCompleteInterventionInput): void {
  assertNoJsonRpcRequestId(input);
  validateScope(input);
  assertNonEmptyString(input.sessionId, 'session id');
  assertNonEmptyString(input.interventionId, 'intervention id');
  assertNonEmptyString(input.completedBy, 'intervention completedBy');
  assertOptionalDate(input.completedAt, 'intervention completedAt');
  if (input.guidance !== undefined) {
    assertBoundedString(input.guidance, 'intervention guidance', MAX_GUIDANCE_BYTES);
  }
}

export function validateAcpResumeSessionInput(input: AcpResumeSessionInput): void {
  assertNoJsonRpcRequestId(input);
  validateScope(input);
  assertNonEmptyString(input.sessionId, 'session id');
  assertNonEmptyString(input.resumeId, 'resume id');
  assertNonEmptyString(input.resumedBy, 'resume resumedBy');
  assertOptionalDate(input.resumedAt, 'resume resumedAt');
  normalizeAcpPauseInterventionMetadata(input.resumeMetadata, 'resume metadata');
}

export function normalizeAcpPauseInterventionMetadata(
  metadata: unknown,
  label = 'pause/intervention metadata'
): AcpPauseInterventionMetadata | undefined {
  if (metadata === undefined || metadata === null) return undefined;
  if (!isMetadataRecord(metadata)) {
    throw new AcpValidationError(`ACP ${label} must be an object with primitive values`);
  }

  const entries = Object.entries(metadata);
  if (entries.length > MAX_METADATA_KEYS) {
    throw new AcpValidationError(`ACP ${label} cannot contain more than ${MAX_METADATA_KEYS} keys`);
  }

  const normalized: AcpPauseInterventionMetadata = {};
  for (const [key, value] of entries) {
    validateMetadataKey(key, label);
    validateMetadataValue(key, value, label);
    normalized[key] = value;
  }
  return normalized;
}

function validateScope(scope: AcpSessionScope): void {
  assertNonEmptyString(scope.tenantId, 'tenant id');
  assertNonEmptyString(scope.ownerKeyId, 'owner key id');
}

function assertNoJsonRpcRequestId(input: object): void {
  if (Object.hasOwn(input, 'jsonRpcRequestId')) {
    throw new AcpDurableIdentityError(
      'JSON-RPC request ids are transport-scoped and cannot be stored as durable ACP pause/intervention identity'
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
  if (value !== undefined) assertNonEmptyString(value, label);
}

function assertBoundedString(value: unknown, label: string, maxBytes: number): asserts value is string {
  assertNonEmptyString(value, label);
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new AcpValidationError(`ACP ${label} exceeds ${maxBytes} bytes`);
  }
}

function assertOptionalDate(value: unknown, label: string): void {
  if (value !== undefined && (!(value instanceof Date) || Number.isNaN(value.getTime()))) {
    throw new AcpValidationError(`ACP ${label} must be a valid Date`);
  }
}

function isMetadataRecord(value: unknown): value is Record<string, AcpPauseInterventionMetadataValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateMetadataKey(key: string, label: string): void {
  if (key.trim() === '') {
    throw new AcpValidationError(`ACP ${label} key must be a non-empty string`);
  }
  if (BLOCKED_METADATA_KEYS.has(key)) {
    throw new AcpValidationError(`ACP ${label} key is not allowed: ${key}`);
  }
  if (SENSITIVE_METADATA_KEY_PATTERN.test(key)) {
    throw new AcpValidationError(`ACP ${label} key is sensitive: ${key}`);
  }
  if (Buffer.byteLength(key, 'utf8') > MAX_METADATA_KEY_BYTES) {
    throw new AcpValidationError(`ACP ${label} key exceeds ${MAX_METADATA_KEY_BYTES} bytes`);
  }
}

function validateMetadataValue(key: string, value: unknown, label: string): asserts value is AcpPauseInterventionMetadataValue {
  if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new AcpValidationError(`ACP ${label} value must be primitive: ${key}`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new AcpValidationError(`ACP ${label} number must be finite: ${key}`);
  }
  if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > MAX_METADATA_STRING_BYTES) {
    throw new AcpValidationError(`ACP ${label} value exceeds ${MAX_METADATA_STRING_BYTES} bytes: ${key}`);
  }
}
