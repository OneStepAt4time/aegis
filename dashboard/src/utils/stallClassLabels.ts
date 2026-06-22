/**
 * utils/stallClassLabels.ts — Issue #4802: stall pill label + state helpers.
 *
 * Server emits ErrorClass as a bounded enum (src/stall-events.ts). Renderer
 * maps each value to a display label. The bounded enum is the single source
 * of truth — no free-form strings, no concatenation, no prompt-injection
 * surface for the pill.
 *
 * Path 2 defensive: if the typed payload is missing fields (pre-F-9), the
 * renderer falls back to a generic "Stalled" label and hides the sub-label
 * and AC3b button. Safe default.
 */

import type { ErrorClass, StallEventPayload } from '../api/schemas';

/**
 * Display labels for each ErrorClass. The bounded enum is enforced by
 * `ErrorClassSchema` in api/schemas.ts — adding a new label requires adding
 * a new ErrorClass value (schema PR that gets reviewed).
 */
export const STALL_CLASS_LABELS: Record<ErrorClass, string> = {
  transient_5xx: 'Transient 5xx',
  permission_timeout: 'Permission Timeout',
  jsonl_stall: 'JSONL Stall',
  thinking_stall: 'Thinking Stall',
  unknown_stall: 'Unknown Stall',
  extended_working: 'Extended Working',
};

/** Generic fallback when errorClass is not present in the wire payload (pre-F-9). */
export const STALL_GENERIC_LABEL = 'Stalled';

/** Format ErrorClass to display label. Falls back to STALL_GENERIC_LABEL if missing. */
export function formatStallClassLabel(errorClass: ErrorClass | undefined | null): string {
  if (!errorClass) return STALL_GENERIC_LABEL;
  return STALL_CLASS_LABELS[errorClass] ?? STALL_GENERIC_LABEL;
}

/**
 * Compute "exhausted" state — server doesn't yet emit recoveryExhausted, so
 * the renderer derives it from the existing recoveryAttemptCount /
 * recoveryMaxAttempts fields. When both are 0 (Path 2 default), exhaustion
 * is unknown (not enough info to tell), so the AC3b button stays hidden.
 *
 * Post-F-9 (or if server adds recoveryExhausted), this can be replaced with
 * `payload.recoveryExhausted === true`.
 */
export function isRecoveryExhausted(payload: Partial<StallEventPayload>): boolean {
  const attempt = payload.recoveryAttemptCount ?? 0;
  const max = payload.recoveryMaxAttempts ?? 0;
  if (max <= 0) return false; // unknown — keep button hidden
  return attempt >= max;
}

/**
 * Compute sub-label for the stall pill.
 * - When max > 0: "X/Y (auto-recovering…)" (State A) or "X/Y — intervention required" (State B)
 * - When max === 0: return null (sub-label hidden, Path 2 default)
 */
export function formatStallSubLabel(payload: Partial<StallEventPayload>): string | null {
  const attempt = payload.recoveryAttemptCount ?? 0;
  const max = payload.recoveryMaxAttempts ?? 0;
  if (max <= 0) return null; // Path 2 default — no sub-label
  const exhausted = isRecoveryExhausted(payload);
  return exhausted
    ? `${attempt}/${max} — intervention required`
    : `${attempt}/${max} (auto-recovering…)`;
}

/**
 * Compute the kill-switch overlay state. When recoveryDisabled is true,
 * the pill renders an overlay icon indicating the operator has paused
 * auto-recovery for this session.
 */
export function isRecoveryDisabled(payload: Partial<StallEventPayload>): boolean {
  return payload.recoveryDisabled === true;
}

/**
 * Format a tooltip line for the stall pill. Composed of:
 * - errorClass label
 * - statusCode (if present and only for transient_5xx)
 * - lastErrorAt (ISO timestamp)
 * - stallDurationMs (formatted as "stalled Xm")
 * - sub-label (X/Y recovery counter)
 *
 * Tooltip is metadata-only — never includes the raw `detail` field from
 * the legacy free-form `status.stall` event, per F-6 redaction discipline.
 */
export function formatStallTooltip(payload: Partial<StallEventPayload>): string {
  const parts: string[] = [];

  const errorClassLabel = formatStallClassLabel(payload.errorClass);
  parts.push(errorClassLabel);

  if (payload.statusCode !== undefined && payload.errorClass === 'transient_5xx') {
    parts.push(`(${payload.statusCode})`);
  }

  if (payload.lastErrorAt) {
    parts.push(`since ${payload.lastErrorAt}`);
  }

  if (payload.stallDurationMs !== undefined && payload.stallDurationMs > 0) {
    const minutes = Math.round(payload.stallDurationMs / 60000);
    parts.push(`stalled ${minutes}m`);
  }

  const subLabel = formatStallSubLabel(payload);
  if (subLabel) {
    parts.push(subLabel);
  }

  return parts.join(' — ');
}
