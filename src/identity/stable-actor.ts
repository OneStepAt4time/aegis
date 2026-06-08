/**
 * Aegis actor identity resolver (issue #4615).
 *
 * The OpenClaw relay layer sometimes mangles or rotates the
 * `account_id` field on cross-agent relay messages (observed in
 * #aegis-devs, 2026-06-08 20:17 GMT+2 by ag-hermes and ag-scribe).
 * Aegis should not depend on that field for identity.
 *
 * `resolveStableActor` derives a deterministic actor id from the
 * stable parts of an inbound actor (channel + userId) and detects
 * when the relay-layer `relayAccountId` drifts between calls for
 * the same logical actor. The stable id is what downstream code
 * should consume; `isDriftSuspected` is a soft signal for audit
 * and warnings, never a reason to reject a message.
 *
 * This is aegis-side defensive hardening. The OpenClaw relay
 * layer's garble is upstream and out of scope for this module.
 */
import { createHash } from 'node:crypto';

export interface ResolveStableActorInput {
  channel: string;
  userId: number | string;
  firstName?: string;
  relayAccountId?: string;
}

export interface ResolveStableActorResult {
  stableActorId: string;
  isDriftSuspected: boolean;
}

// In-memory baseline relayAccountId per stable actor. Lost on
// process restart by design — drift is a session-level signal,
// not an audit log. A process restart invalidates the baseline
// and the next observed relayAccountId becomes the new baseline.
const baselineRelayAccountIdByActor = new Map<string, string>();

/** Truncation length for the SHA-256 hex digest (16 hex = 64 bits). */
const STABLE_ACTOR_ID_HEX_CHARS = 16;

export function resolveStableActor(input: ResolveStableActorInput): ResolveStableActorResult {
  const stableActorId = hashStableActorId(input.channel, input.userId);
  const isDriftSuspected = detectDrift(stableActorId, input.relayAccountId);
  return { stableActorId, isDriftSuspected };
}

function hashStableActorId(channel: string, userId: number | string): string {
  return createHash('sha256')
    .update(`${channel}:${userId}`)
    .digest('hex')
    .slice(0, STABLE_ACTOR_ID_HEX_CHARS);
}

function detectDrift(stableActorId: string, relayAccountId: string | undefined): boolean {
  // Absent relayAccountId is never drift — we have no baseline to
  // differ from. This is the only path that can ever return
  // `false` while the baseline is undefined for this actor.
  if (relayAccountId === undefined) {
    return false;
  }
  const baseline = baselineRelayAccountIdByActor.get(stableActorId);
  if (baseline === undefined) {
    // First observation for this actor — establish the baseline.
    baselineRelayAccountIdByActor.set(stableActorId, relayAccountId);
    return false;
  }
  return baseline !== relayAccountId;
}

/**
 * Test-only: clear the in-memory baseline cache. Exported solely
 * so the test suite can isolate scenarios. Not part of the public
 * API surface; the underscore prefix signals "internal/test".
 */
export function _resetStableActorCacheForTesting(): void {
  baselineRelayAccountIdByActor.clear();
}
