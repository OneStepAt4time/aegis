import { AcpValidationError } from '../errors.js';
import { clonePayload } from './clone.js';
import type { AcpAppendEventInput, AcpListEventsInput } from '../event-store.js';
import type { AcpSessionScope } from '../types.js';
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
} from './types.js';

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export function validateAppendInput(input: AcpAppendEventInput): AcpAppendEventInput & { occurredAt: Date } {
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

export function validateListInput(input: AcpListEventsInput): void {
  requireNonEmptyString(input.sessionId, 'sessionId');
  requireNonEmptyString(input.tenantId, 'tenantId');
  requireNonEmptyString(input.ownerKeyId, 'ownerKeyId');
}

export function resolveOccurredAt(value: Date | undefined): Date {
  if (value === undefined) return new Date();
  assertValidDate(value, 'event occurredAt');
  return new Date(value.getTime());
}

export function resolveAfterEventSeq(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AcpValidationError('ACP afterEventSeq must be a non-negative safe integer');
  }
  return value;
}

export function resolveSessionListLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIST_LIMIT;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_LIST_LIMIT) {
    throw new AcpValidationError(`ACP session list limit must be between 1 and ${MAX_LIST_LIMIT}`);
  }
  return value;
}

export function resolveLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIST_LIMIT;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_LIST_LIMIT) {
    throw new AcpValidationError(`ACP event replay limit must be between 1 and ${MAX_LIST_LIMIT}`);
  }
  return value;
}

export function validateActionIdAndScope(actionId: string, scope: AcpSessionScope): void {
  requireNonEmptyString(actionId, 'action id');
  validateScope(scope);
}

export function validateScope(scope: AcpSessionScope): void {
  requireNonEmptyString(scope.tenantId, 'tenant id');
  requireNonEmptyString(scope.ownerKeyId, 'owner key id');
}

export function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AcpValidationError(`ACP ${label} must be a non-empty string`);
  }
  return value;
}

export function requireOptionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireNonEmptyString(value, label);
}

export function assertValidDate(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AcpValidationError(`ACP ${label} must be a valid Date`);
  }
}
