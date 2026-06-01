/**
 * backend/drivers.ts — ACP Backend driver/participant management.
 *
 * Issue #4534: Extracted from backend.ts for gate:arch compliance.
 */

import type { AcpSessionScope } from '../types.js';
import { AcpBackendLifecycleError } from './errors.js';
import type {
  AcpBackendClaimDriverInput,
  AcpBackendReleaseDriverInput,
  AcpBackendTransferDriverInput,
  AcpBackendDriverResult,
  AcpBackendParticipantsResult,
} from './types.js';

export interface DriverDeps {
  participants: Map<string, AcpBackendParticipantsResult>;
  driverFences: Map<string, number>;
  sessionService: {
    getSession(sessionId: string, scope: AcpSessionScope): Promise<unknown>;
  };
}

/**
 * Claim the driver seat for a session. Only one driver is allowed at a time.
 * @throws {AcpBackendLifecycleError} if a driver is already claimed
 */
export async function claimDriver(
  deps: DriverDeps,
  input: AcpBackendClaimDriverInput
): Promise<AcpBackendDriverResult> {
  const scope = scopeFromInput(input);

  // Capture participant state before yielding to avoid TOCTOU race (#3921)
  let record = deps.participants.get(input.sessionId);
  if (!record) {
    record = { sessionId: input.sessionId, driver: null, observers: [], activeCount: 0 };
    deps.participants.set(input.sessionId, record);
  }
  if (record.driver) {
    throw new AcpBackendLifecycleError(`Driver already claimed for session ${input.sessionId}`);
  }
  // Claim atomically before any await — prevents concurrent claims
  const fence = (deps.driverFences.get(input.sessionId) ?? 0) + 1;
  deps.driverFences.set(input.sessionId, fence);
  record.driver = { subscriberId: input.holderId, role: 'driver' };
  record.activeCount = 1 + record.observers.length;
  await deps.sessionService.getSession(input.sessionId, scope);
  return { sessionId: input.sessionId, holderId: input.holderId, role: 'driver', fence, ttlMs: input.ttlMs };
}

/**
 * Release the driver seat. The caller must be the current driver.
 * @throws {AcpBackendLifecycleError} if not the current driver
 */
export async function releaseDriver(
  deps: DriverDeps,
  input: AcpBackendReleaseDriverInput
): Promise<AcpBackendDriverResult> {
  const scope = scopeFromInput(input);
  // Capture and mutate participant state before yielding to avoid TOCTOU race (#3921)
  const record = deps.participants.get(input.sessionId);
  if (!record || !record.driver || record.driver.subscriberId !== input.holderId) {
    throw new AcpBackendLifecycleError(`Not the driver of session ${input.sessionId}`);
  }
  record.driver = null;
  record.activeCount = record.observers.length;
  await deps.sessionService.getSession(input.sessionId, scope);
  return { sessionId: input.sessionId, holderId: null, role: 'observer' };
}

/**
 * Transfer the driver seat to another subscriber. The current driver's
 * fence is incremented.
 */
export async function transferDriver(
  deps: DriverDeps,
  input: AcpBackendTransferDriverInput
): Promise<AcpBackendDriverResult> {
  const scope = scopeFromInput(input);
  // Capture and mutate participant state before yielding to avoid TOCTOU race (#3921)
  const record = deps.participants.get(input.sessionId);
  if (!record || !record.driver) {
    throw new AcpBackendLifecycleError(`No driver to transfer for session ${input.sessionId}`);
  }
  const fence = (deps.driverFences.get(input.sessionId) ?? 0) + 1;
  deps.driverFences.set(input.sessionId, fence);
  const targetId = input.targetSubscriberId;
  if (!targetId) {
    throw new AcpBackendLifecycleError(`targetSubscriberId is required for driver transfer`);
  }
  record.driver = { subscriberId: targetId, role: 'driver' };
  await deps.sessionService.getSession(input.sessionId, scope);
  return { sessionId: input.sessionId, holderId: targetId, role: 'driver', fence };
}

/** Return current driver, observers, and active count for a session. */
export function getParticipants(
  deps: DriverDeps,
  sessionId: string,
  _scope: AcpSessionScope
): AcpBackendParticipantsResult {
  return (
    deps.participants.get(sessionId) ?? {
      sessionId,
      driver: null,
      observers: [],
      activeCount: 0,
    }
  );
}

function scopeFromInput(input: { tenantId?: string; ownerKeyId?: string }): AcpSessionScope {
  return { tenantId: input.tenantId ?? '', ownerKeyId: input.ownerKeyId ?? '' };
}
