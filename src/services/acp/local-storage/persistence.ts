import { readFile } from 'node:fs/promises';

import type { AcpActionRecord } from '../action-queue.js';
import type { AcpEventRecord } from '../event-store.js';
import type { AcpPauseInterventionRecord } from '../pause-intervention.js';
import { isNodeError } from './validation.js';
import { isRecord } from './types.js';
import { createEmptyState } from './types.js';
import {
  clonePayload,
  cloneSession,
} from './clone.js';
import type { LocalState } from './types.js';

export async function loadState(filePath: string): Promise<LocalState> {
  try {
    return deserializeState(JSON.parse(await readFile(filePath, 'utf8')));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return createEmptyState();
    if (error instanceof SyntaxError) return createEmptyState();
    throw error;
  }
}

export interface SerializedEvent extends Omit<AcpEventRecord, 'occurredAt' | 'ingestedAt'> {
  occurredAt: string;
  ingestedAt: string;
}

export interface SerializedAction
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

export interface SerializedPauseIntervention
  extends Omit<
    AcpPauseInterventionRecord,
    'requestedAt' | 'updatedAt' | 'interventionStartedAt' | 'interventionCompletedAt' | 'resumedAt'
  > {
  requestedAt: string;
  updatedAt: string;
  interventionStartedAt?: string;
  interventionCompletedAt?: string;
  resumedAt?: string;
}

export interface SerializedState {
  version: 1;
  sessions: import('../types.js').AcpSessionRecord[];
  events: SerializedEvent[];
  actions: SerializedAction[];
  pauseInterventions: SerializedPauseIntervention[];
}

/**
 * Issue #4032: Lightweight serialization for the persist path.
 * Skips structuredClone since we're about to JSON.stringify anyway.
 * The stringifier creates a fresh value tree, so cloning is redundant.
 */
export function serializeStateLightweight(state: LocalState): SerializedState {
  return {
    version: 1,
    sessions: state.sessions.map(s => ({
      ...s,
      backendMetadata: s.backendMetadata === undefined ? undefined : { ...s.backendMetadata },
    })),
    events: state.events.map(event => ({
      ...event,
      occurredAt: event.occurredAt.toISOString(),
      ingestedAt: event.ingestedAt.toISOString(),
      // No structuredClone — JSON.stringify handles the payload as-is.
    })),
    actions: state.actions.map(action => ({
      ...action,
      createdAt: action.createdAt.toISOString(),
      availableAt: action.availableAt.toISOString(),
      leasedUntil: action.leasedUntil?.toISOString(),
      completedAt: action.completedAt?.toISOString(),
      failedAt: action.failedAt?.toISOString(),
      cancelledAt: action.cancelledAt?.toISOString(),
      metadata: action.metadata === undefined ? undefined : { ...action.metadata },
      resultMetadata: action.resultMetadata === undefined ? undefined : { ...action.resultMetadata },
      errorMetadata: action.errorMetadata === undefined ? undefined : { ...action.errorMetadata },
    })),
    pauseInterventions: state.pauseInterventions.map(record => ({
      ...record,
      requestedAt: record.requestedAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      interventionStartedAt: record.interventionStartedAt?.toISOString(),
      interventionCompletedAt: record.interventionCompletedAt?.toISOString(),
      resumedAt: record.resumedAt?.toISOString(),
      metadata: record.metadata === undefined ? undefined : { ...record.metadata },
      resumeMetadata: record.resumeMetadata === undefined ? undefined : { ...record.resumeMetadata },
    })),
  };
}

export function deserializeState(value: unknown): LocalState {
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

  // Issue #4032: Build incremental seq tracking from loaded events.
  const lastEventSeqBySession = new Map<string, number>();
  const events = value.events.map(event => {
    if ((event.eventSeq ?? 0) > 0) {
      const current = lastEventSeqBySession.get(event.sessionId) ?? 0;
      if (event.eventSeq > current) {
        lastEventSeqBySession.set(event.sessionId, event.eventSeq);
      }
    }
    return {
      ...event,
      occurredAt: parseDate(event.occurredAt, 'event.occurredAt'),
      ingestedAt: parseDate(event.ingestedAt, 'event.ingestedAt'),
      payload: clonePayload(event.payload),
    };
  });

  return {
    sessions: value.sessions.map(cloneSession),
    events,
    actions,
    actionOrder,
    nextActionOrder: actions.length,
    pauseInterventions: (value.pauseInterventions ?? []).map((record: SerializedPauseIntervention) => ({
      ...record,
      requestedAt: parseDate(record.requestedAt, 'pauseIntervention.requestedAt'),
      updatedAt: parseDate(record.updatedAt, 'pauseIntervention.updatedAt'),
      interventionStartedAt: parseOptionalDate(record.interventionStartedAt, 'pauseIntervention.interventionStartedAt'),
      interventionCompletedAt: parseOptionalDate(record.interventionCompletedAt, 'pauseIntervention.interventionCompletedAt'),
      resumedAt: parseOptionalDate(record.resumedAt, 'pauseIntervention.resumedAt'),
    })),
    lastEventSeqBySession,
  };
}

export function isSerializedState(value: unknown): value is SerializedState {
  if (!isRecord(value) || value.version !== 1) return false;
  return (
    Array.isArray(value.sessions) &&
    Array.isArray(value.events) &&
    Array.isArray(value.actions) &&
    Array.isArray(value.pauseInterventions ?? [])
  );
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

/**
 * Stable order for the action leaseNext tie-breaker: queue position first,
 * then creation time, then insertion order. Pulled out of
 * `MemoryAcpActionQueue` so persistence can reason about the same
 * invariant when reconstructing state from disk.
 */
export function compareLeaseOrder(state: LocalState, left: AcpActionRecord, right: AcpActionRecord): number {
  const availableDelta = left.availableAt.getTime() - right.availableAt.getTime();
  if (availableDelta !== 0) return availableDelta;
  const createdDelta = left.createdAt.getTime() - right.createdAt.getTime();
  if (createdDelta !== 0) return createdDelta;
  return (state.actionOrder.get(left.actionId) ?? 0) - (state.actionOrder.get(right.actionId) ?? 0);
}
