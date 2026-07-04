/**
 * Aegis envelope-layer relay-drift defensive resolver (issue #4828, Layer 2).
 *
 * The OpenClaw relay layer has been observed to garble the `displayName` /
 * sender-metadata envelope field on cross-agent relay messages (observed in
 * #aegis-devs, 2026-06-08 22:50 Rome — see MEMORY.md "Sender-metadata relay
 * garble" and the Layer-2 dispatch in the Layer-3 escalation chain).
 *
 * `resolveLayer2Envelope` derives a deterministic `canonicalSenderId` from
 * the *stable* parts of an inbound envelope (channel + userId) and detects
 * when the relay-supplied `displayName` exhibits the observed drift
 * pattern (long "A" prefix padding the canonical handle).
 *
 * Auth-boundary contract (Themis co-review surface):
 *   - `canonicalSenderId` is derived ONLY from `(channel, userId)` —
 *     `displayName` MUST NOT enter the hash. Display name is not
 *     identity and is the unreliable relay-supplied field.
 *   - `isDriftSuspected` is a soft signal: false positives (false
 *     alarms on unusual but legitimate display names) are acceptable
 *     for audit-warning purposes; false negatives are not, because a
 *     missed drift means acting on stale auth metadata.
 *   - This module is additive (no schema, no new deps, no
 *     permissions changes) and is aegis-side defensive hardening.
 *     The upstream OpenClaw relay-layer garble is out of scope.
 *
 * Mirrors the pattern from `src/identity/stable-actor.ts` (#4615):
 * same hash construction, same `isDriftSuspected` discriminator
 * shape, additive — the two layers (Layer 1 account_id and Layer 2
 * displayName) are siblings, both deriving from `(channel, userId)`.
 */
import { createHash } from 'node:crypto';

export interface ResolveLayer2EnvelopeInput {
  channel: string;
  userId: number | string;
  displayName?: string;
}

export interface ResolveLayer2EnvelopeResult {
  canonicalSenderId: string;
  isDriftSuspected: boolean;
}

/** Truncation length for the SHA-256 hex digest (16 hex = 64 bits).
 *  Matches `STABLE_ACTOR_ID_HEX_CHARS` in stable-actor.ts so the two
 *  layers' canonical ids are bit-for-bit equal for the same
 *  `(channel, userId)` — by design; both layers are identity views
 *  of the same canonical input. */
const LAYER2_ID_HEX_CHARS = 16;

/** Observed Layer-2 drift pattern (2026-06-08): long run of capital A's
 *  prepended to the canonical handle, e.g. "AAAAAAAAAAAAthena" instead
 *  of "athena". False positives on legitimate-but-A-heavy display
 *  names are acceptable (they just trigger audit warnings). False
 *  negatives — missing the actual drift pattern — would mean acting
 *  on stale auth metadata, which is the failure mode this resolver
 *  exists to prevent. */
const DRIFT_PREFIX_PATTERN = /A{6,}/;

/**
 * Resolve a canonical sender-id for the envelope layer of an inbound
 * message, detecting observed drift patterns in the relay-supplied
 * `displayName` field.
 *
 * @param input.channel - Stable channel identifier (e.g. `'telegram'`).
 * @param input.userId - Stable user id from the relay-supplied envelope.
 * @param input.displayName - OPTIONAL, UNTRUSTED display name from the
 *   relay-supplied sender-metadata field. Never enters the canonical id.
 * @returns `{ canonicalSenderId, isDriftSuspected }`. Never throws.
 */
export function resolveLayer2Envelope(
  input: ResolveLayer2EnvelopeInput,
): ResolveLayer2EnvelopeResult {
  const { channel, userId, displayName } = input;

  const canonicalSenderId = createHash('sha256')
    .update(`${channel}:${userId}`)
    .digest('hex')
    .slice(0, LAYER2_ID_HEX_CHARS);

  const isDriftSuspected = isDisplayNameDrifted(displayName);

  return { canonicalSenderId, isDriftSuspected };
}

/**
 * Drift heuristic: empty / missing displayName is NOT drift (no baseline
 * signal). Garbled display names matching the observed A{6,} prefix
 * pattern ARE drift. This is intentionally narrow on the front (only
 * catches patterns we've actually observed) and conservative on the
 * edges (empty / missing are not drift).
 */
function isDisplayNameDrifted(displayName: string | undefined): boolean {
  if (!displayName) return false;
  return DRIFT_PREFIX_PATTERN.test(displayName);
}
