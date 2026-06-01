import { AcpValidationError } from '../errors.js';
import type { AcpEventPayload, AcpEventRecord } from '../event-store.js';
import type { AcpActionRecord } from '../action-queue.js';
import type { AcpSessionRecord } from '../types.js';
import type { AcpPauseInterventionRecord } from '../pause-intervention.js';
import { isRecord } from './types.js';

/**
 * Issue #4032: Defensive deep-clone helpers. Persistence relies on these
 * to keep store state isolated from caller-mutated inputs and from prior
 * payloads already written to disk.
 */

export function clonePayload(value: unknown): AcpEventPayload {
  validateJsonValue(value, 'payload', new WeakSet<object>());
  return structuredClone(value);
}

export function validateJsonValue(
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

export function cloneOptionalDate(value: Date | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value.getTime());
}

export function cloneSession(record: AcpSessionRecord): AcpSessionRecord {
  return {
    ...record,
    backendMetadata: record.backendMetadata === undefined ? undefined : { ...record.backendMetadata },
  };
}

export function cloneEvent(record: AcpEventRecord): AcpEventRecord {
  return {
    ...record,
    occurredAt: new Date(record.occurredAt.getTime()),
    ingestedAt: new Date(record.ingestedAt.getTime()),
    payload: clonePayload(record.payload),
  };
}

export function cloneAction(record: AcpActionRecord): AcpActionRecord {
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

export function clonePauseIntervention(record: AcpPauseInterventionRecord): AcpPauseInterventionRecord {
  return {
    ...record,
    requestedAt: new Date(record.requestedAt.getTime()),
    updatedAt: new Date(record.updatedAt.getTime()),
    interventionStartedAt: cloneOptionalDate(record.interventionStartedAt),
    interventionCompletedAt: cloneOptionalDate(record.interventionCompletedAt),
    resumedAt: cloneOptionalDate(record.resumedAt),
    metadata: record.metadata === undefined ? undefined : { ...record.metadata },
    resumeMetadata: record.resumeMetadata === undefined ? undefined : { ...record.resumeMetadata },
  };
}
