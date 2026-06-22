/**
 * stall-events.ts — Issue #4802: typed stall-event contract (Cycle-1.6).
 *
 * The stall detector emits per-session stall events via SessionEventBus.emitStall
 * with a free-form `detail: string`. Dashboards (Daedalus's lane) need to render
 * a pill + tooltip from typed metadata — never from a free-form string.
 *
 * Themis Cycle-1.6 + Daedalus Cycle-1.5/1.7:
 *   - errorClass MUST be a bounded enum (auditable, no prompt-injection surface)
 *   - statusCode is opt-in metadata for transient_5xx only
 *   - recoveryAttemptCount + recoveryMaxAttempts are server-emitted (renderer
 *     never has to know server config)
 *   - recoveryDisabled is operator-facing kill-switch indicator
 *   - Channel fanout (Telegram, webhooks) gets errorClass only — NOT statusCode
 *
 * This module is the contract; the renderer is type-safe against it. Migration
 * path: additive emit of `errorClass_raw: '5xx_529'` for one release, deprecate
 * next, remove third (per Themis Cycle-1.6).
 */

/**
 * Bounded enum of operational stall categories. Renderer maps these directly
 * to the dashboard pill label. Adding a new value is a schema PR that gets
 * review — schema drift cannot grow unchecked.
 */
export type ErrorClass =
  | 'transient_5xx'         // upstream 5xx, retry-eligible (rate_limit, overloaded, etc.)
  | 'permission_timeout'    // permission_prompt/bash_approval stalled past timeout
  | 'jsonl_stall'           // "working" but no new JSONL bytes
  | 'thinking_stall'        // CC extended thinking past threshold
  | 'unknown_stall'         // unknown state past threshold
  | 'extended_working';     // working for 3x stallThresholdMs (CC internal loop)

/** All valid ErrorClass values — runtime guard for inbound/untrusted input. */
export const ERROR_CLASS_VALUES: readonly ErrorClass[] = [
  'transient_5xx',
  'permission_timeout',
  'jsonl_stall',
  'thinking_stall',
  'unknown_stall',
  'extended_working',
] as const;

/** Runtime type guard for inbound errorClass strings. */
export function isErrorClass(value: unknown): value is ErrorClass {
  return typeof value === 'string'
    && (ERROR_CLASS_VALUES as readonly string[]).includes(value);
}

/**
 * Typed metadata-only schema for stall events emitted to the SSE bus.
 *
 * Renderer is type-safe against this schema — no free-form strings in the
 * typed payload. Channel fanout (Telegram, webhooks) drops `statusCode`
 * because it is fingerprint-y (530 vs 529 reveals API variant).
 */
export interface StallEventPayload {
  /** Operational category that drives the dashboard pill label. */
  errorClass: ErrorClass;
  /** HTTP status code, present ONLY when errorClass === 'transient_5xx'. */
  statusCode?: number;
  /** ISO8601 timestamp of last detected error/activity. */
  lastErrorAt: string;
  /** Duration in ms since stall was first detected. */
  stallDurationMs: number;
  /** Current attempt count (0 if recovery not yet attempted). */
  recoveryAttemptCount: number;
  /** Cap on recovery attempts (server-emitted; renderer never reads config). */
  recoveryMaxAttempts: number;
  /** Per-session kill-switch state — true when operator has paused recovery. */
  recoveryDisabled: boolean;
}

/**
 * Builder for StallEventPayload that:
 *  - validates errorClass is in the bounded enum (throws on untrusted input)
 *  - auto-populates timestamps + duration when omitted
 *  - keeps statusCode scoped to transient_5xx only
 *
 * Use this at every stall-detector emit site so the contract is enforced
 * consistently across all internal stall types.
 */
export interface BuildStallEventInput {
  errorClass: ErrorClass;
  statusCode?: number;
  stallDurationMs: number;
  recoveryAttemptCount?: number;
  recoveryMaxAttempts?: number;
  recoveryDisabled?: boolean;
  /** When omitted, defaults to `new Date().toISOString()`. */
  lastErrorAt?: string;
}

export function buildStallEventPayload(input: BuildStallEventInput): StallEventPayload {
  if (!isErrorClass(input.errorClass)) {
    throw new TypeError(
      `buildStallEventPayload: unknown errorClass "${String(input.errorClass)}". `
      + `Allowed: ${ERROR_CLASS_VALUES.join(', ')}`,
    );
  }
  if (input.statusCode !== undefined && input.errorClass !== 'transient_5xx') {
    throw new RangeError(
      `buildStallEventPayload: statusCode (${input.statusCode}) is only valid for `
      + `errorClass 'transient_5xx', got '${input.errorClass}'`,
    );
  }
  return {
    errorClass: input.errorClass,
    statusCode: input.statusCode,
    lastErrorAt: input.lastErrorAt ?? new Date().toISOString(),
    stallDurationMs: input.stallDurationMs,
    recoveryAttemptCount: input.recoveryAttemptCount ?? 0,
    recoveryMaxAttempts: input.recoveryMaxAttempts ?? 0,
    recoveryDisabled: input.recoveryDisabled ?? false,
  };
}

/**
 * Channel-fanout split helper: returns the subset of a StallEventPayload that
 * is safe to ship to channel transports (Telegram, webhooks, etc.) — drops
 * `statusCode` because it is fingerprint-y (530 vs 529 reveals API variant
 * and adds noise to user notifications).
 *
 * Operator surfaces (dashboard, in-app tooltip) use the full payload.
 */
export type ChannelFanoutStallEvent = Omit<StallEventPayload, 'statusCode'>;

export function toChannelFanoutPayload(p: StallEventPayload): ChannelFanoutStallEvent {
  const { statusCode: _statusCode, ...rest } = p;
  return rest;
}
