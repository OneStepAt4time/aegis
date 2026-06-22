/**
 * stall-detector-typed-emit.ts — Issue #4802 F-9 helpers.
 *
 * Extracted from `src/stall-detector.ts` to keep that file under the
 * 500-line quality gate. These helpers implement the typed StallEventPayload
 * emit + bounded ErrorClass mapping introduced by F-9.
 */

import type { SessionInfo } from './session-types.js';
import type { SessionEvent } from './channels/index.js';
import {
  buildStallEventPayload,
  type ErrorClass,
  type StallEventPayload,
} from './stall-events.js';

/**
 * Map stall-detector internal stallType strings to the bounded `ErrorClass`
 * enum from `src/stall-events.ts`. Pure function — no side effects.
 *
 *   'thinking'           → 'thinking_stall'
 *   'jsonl'              → 'jsonl_stall'
 *   'permission'         → 'permission_timeout'
 *   'permission_timeout' → 'permission_timeout'
 *   'unknown'            → 'unknown_stall'
 *   'extended'           → 'unknown_stall' (no specific enum value yet)
 *   'extended_working'   → 'extended_working'
 *   default              → 'unknown_stall'
 */
export function errorClassForStallType(stallType: string): ErrorClass {
  switch (stallType) {
    case 'thinking':           return 'thinking_stall';
    case 'jsonl':              return 'jsonl_stall';
    case 'permission':
    case 'permission_timeout': return 'permission_timeout';
    case 'unknown':            return 'unknown_stall';
    case 'extended':           return 'unknown_stall';
    case 'extended_working':   return 'extended_working';
    default:                   return 'unknown_stall';
  }
}

/**
 * Build a typed `StallEventPayload` from current session + detector state.
 * Pure function — no side effects.
 *
 * Reads the running recovery attempt counter + recovery cap from the
 * detector's internal Map/config so the dashboard always sees fresh state.
 */
export interface BuildPayloadDeps {
  recoveryAttempts: Map<string, number>;
  recoveryMaxAttempts: number;
}

export function buildStallPayload(
  deps: BuildPayloadDeps,
  session: SessionInfo,
  errorClass: ErrorClass,
  stallDurationMs: number,
  options?: { statusCode?: number },
): StallEventPayload {
  return buildStallEventPayload({
    errorClass,
    statusCode: options?.statusCode,
    stallDurationMs,
    recoveryAttemptCount: deps.recoveryAttempts.get(session.id) ?? 0,
    recoveryMaxAttempts: deps.recoveryMaxAttempts,
    recoveryDisabled: session.recoveryDisabled === true,
  });
}

/**
 * Issue #4802 (F-9): Map a CC stopReason string like '529_overloaded' or
 * '503_service_unavailable' to its leading HTTP status code.
 *
 * Returns undefined when the prefix doesn't parse or isn't a 5xx code —
 * callers pass undefined to `buildStallEventPayload`, which validates
 * scope (statusCode is only valid for `errorClass: 'transient_5xx'`).
 */
export function extractStatusCode(stopReason: string): number | undefined {
  const match = /^(\d{3})/.exec(stopReason);
  if (!match) return undefined;
  const code = Number.parseInt(match[1], 10);
  if (code < 500 || code > 599) return undefined;
  return code;
}

/**
 * Issue #4802 (F-9): Combined emit — fires all three downstream paths
 * (free-form SSE, typed SSE, channel fanout) for one stall event.
 * Centralizes the boilerplate so each emit site is a single call.
 */
export interface CombinedEmitDeps {
  emitStall: (sessionId: string, stallType: string, detail: string) => void;
  emitStallTyped: (sessionId: string, payload: StallEventPayload) => void;
  statusChange: (payload: { event: SessionEvent; [k: string]: unknown }) => void;
  makePayload: (event: SessionEvent, session: SessionInfo, detail: string) => { event: SessionEvent; [k: string]: unknown };
}

export function emitStallEvent(
  deps: CombinedEmitDeps,
  payloadDeps: BuildPayloadDeps,
  session: SessionInfo,
  stallType: string,
  errorClass: ErrorClass,
  durationMs: number,
  detail: string,
  statusEvent: SessionEvent = 'status.stall',
): void {
  deps.emitStall(session.id, stallType, detail);
  deps.emitStallTyped(session.id, buildStallPayload(payloadDeps, session, errorClass, durationMs));
  deps.statusChange(deps.makePayload(statusEvent, session, detail));
}
