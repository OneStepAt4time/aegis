import { Buffer } from 'node:buffer';

import { AcpValidationError } from './session-service.js';
import type {
  AcpBackendMetadata,
  AcpBackendMetadataValue,
  AcpControlActionInput,
  AcpControlActionType,
  AcpSessionScope,
} from './types.js';

export type AcpActionStatus = 'queued' | 'leased' | 'completed' | 'failed' | 'cancelled';

export type AcpActionMetadataValue = AcpBackendMetadataValue;
export type AcpActionMetadata = AcpBackendMetadata;

export interface AcpActionRecord extends AcpSessionScope {
  actionId: string;
  sessionId: string;
  actionType: AcpControlActionType;
  idempotencyKey?: string;
  status: AcpActionStatus;
  createdAt: Date;
  availableAt: Date;
  leasedUntil?: Date;
  attemptCount: number;
  approvalId?: string;
  controlRequestId?: string;
  metadata?: AcpActionMetadata;
  resultMetadata?: AcpActionMetadata;
  errorMetadata?: AcpActionMetadata;
  completedAt?: Date;
  failedAt?: Date;
  cancelledAt?: Date;
}

export interface AcpEnqueueActionOptions {
  availableAt?: Date;
}

export interface AcpLeaseActionOptions {
  now?: Date;
  leaseUntil: Date;
}

export interface AcpCompleteActionOptions {
  now?: Date;
  resultMetadata?: AcpActionMetadata;
}

export interface AcpFailActionOptions {
  now?: Date;
  errorMetadata?: AcpActionMetadata;
}

export interface AcpCancelActionOptions {
  now?: Date;
  errorMetadata?: AcpActionMetadata;
}

export interface AcpActionQueue {
  enqueue(
    input: AcpControlActionInput,
    options?: AcpEnqueueActionOptions
  ): Promise<AcpActionRecord>;
  leaseNext(scope: AcpSessionScope, options: AcpLeaseActionOptions): Promise<AcpActionRecord | null>;
  complete(
    actionId: string,
    scope: AcpSessionScope,
    options?: AcpCompleteActionOptions
  ): Promise<AcpActionRecord | null>;
  fail(
    actionId: string,
    scope: AcpSessionScope,
    options?: AcpFailActionOptions
  ): Promise<AcpActionRecord | null>;
  cancel(
    actionId: string,
    scope: AcpSessionScope,
    options?: AcpCancelActionOptions
  ): Promise<AcpActionRecord | null>;
}

const MAX_ACTION_METADATA_KEYS = 20;
const MAX_ACTION_METADATA_KEY_BYTES = 128;
const MAX_ACTION_METADATA_STRING_BYTES = 1024;
const BLOCKED_ACTION_METADATA_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_ACTION_METADATA_KEY_PATTERN =
  /(token|secret|password|api[_-]?key|authorization|cookie|prompt|payload|tool.*arg)/i;

export function normalizeAcpActionMetadata(
  metadata: unknown,
  label = 'action metadata'
): AcpActionMetadata | undefined {
  if (metadata === undefined || metadata === null) return undefined;
  if (!isMetadataRecord(metadata)) {
    throw new AcpValidationError(`ACP ${label} must be an object with primitive values`);
  }

  const entries = Object.entries(metadata);
  if (entries.length > MAX_ACTION_METADATA_KEYS) {
    throw new AcpValidationError(
      `ACP ${label} cannot contain more than ${MAX_ACTION_METADATA_KEYS} keys`
    );
  }

  const normalized: AcpActionMetadata = {};
  for (const [key, value] of entries) {
    validateActionMetadataKey(key, label);
    validateActionMetadataValue(key, value, label);
    normalized[key] = value;
  }
  return normalized;
}

function isMetadataRecord(value: unknown): value is Record<string, AcpActionMetadataValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateActionMetadataKey(key: string, label: string): void {
  if (key.trim() === '') {
    throw new AcpValidationError(`ACP ${label} key must be a non-empty string`);
  }
  if (BLOCKED_ACTION_METADATA_KEYS.has(key)) {
    throw new AcpValidationError(`ACP ${label} key is not allowed: ${key}`);
  }
  if (SENSITIVE_ACTION_METADATA_KEY_PATTERN.test(key)) {
    throw new AcpValidationError(`ACP ${label} key is sensitive: ${key}`);
  }
  if (Buffer.byteLength(key, 'utf8') > MAX_ACTION_METADATA_KEY_BYTES) {
    throw new AcpValidationError(
      `ACP ${label} key exceeds ${MAX_ACTION_METADATA_KEY_BYTES} bytes`
    );
  }
}

function validateActionMetadataValue(
  key: string,
  value: unknown,
  label: string
): asserts value is AcpActionMetadataValue {
  if (
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    throw new AcpValidationError(`ACP ${label} value must be primitive: ${key}`);
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new AcpValidationError(`ACP ${label} number must be finite: ${key}`);
  }

  if (
    typeof value === 'string' &&
    Buffer.byteLength(value, 'utf8') > MAX_ACTION_METADATA_STRING_BYTES
  ) {
    throw new AcpValidationError(
      `ACP ${label} value exceeds ${MAX_ACTION_METADATA_STRING_BYTES} bytes: ${key}`
    );
  }
}
