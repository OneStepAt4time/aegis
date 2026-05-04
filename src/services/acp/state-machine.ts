import type { AcpSessionStatus, AcpSessionTransitionEvent } from './types.js';

const ACTIVE_STATUSES: readonly AcpSessionStatus[] = [
  'initializing',
  'idle',
  'running',
  'paused',
  'intervening',
];

export class AcpInvalidStateTransitionError extends Error {
  constructor(
    readonly currentStatus: AcpSessionStatus,
    readonly eventType: AcpSessionTransitionEvent['type']
  ) {
    super(`Invalid ACP session transition from ${currentStatus} via ${eventType}`);
    this.name = 'AcpInvalidStateTransitionError';
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled ACP session transition event: ${JSON.stringify(value)}`);
}

function canTransitionFrom(
  currentStatus: AcpSessionStatus,
  eventType: AcpSessionTransitionEvent['type'],
  allowedStatuses: readonly AcpSessionStatus[],
  nextStatus: AcpSessionStatus
): AcpSessionStatus {
  if (!allowedStatuses.includes(currentStatus)) {
    throw new AcpInvalidStateTransitionError(currentStatus, eventType);
  }
  return nextStatus;
}

export function transitionAcpSessionStatus(
  currentStatus: AcpSessionStatus,
  event: AcpSessionTransitionEvent
): AcpSessionStatus {
  switch (event.type) {
    case 'agent_ready':
      return canTransitionFrom(currentStatus, event.type, ['initializing'], 'idle');
    case 'run_started':
      return canTransitionFrom(
        currentStatus,
        event.type,
        ['initializing', 'idle', 'intervening'],
        'running'
      );
    case 'run_completed':
      return canTransitionFrom(currentStatus, event.type, ['running', 'intervening'], 'idle');
    case 'pause_requested':
      return canTransitionFrom(currentStatus, event.type, ['running'], 'paused');
    case 'resume_requested':
      return canTransitionFrom(currentStatus, event.type, ['paused', 'intervening'], 'running');
    case 'intervention_started':
      return canTransitionFrom(currentStatus, event.type, ['paused'], 'intervening');
    case 'intervention_completed':
      return canTransitionFrom(currentStatus, event.type, ['intervening'], 'paused');
    case 'close_requested':
      return canTransitionFrom(currentStatus, event.type, ACTIVE_STATUSES, 'closing');
    case 'close_completed':
      return canTransitionFrom(currentStatus, event.type, ['closing'], 'closed');
    case 'runtime_failed':
      return canTransitionFrom(currentStatus, event.type, [...ACTIVE_STATUSES, 'closing'], 'failed');
    default:
      return assertNever(event);
  }
}
