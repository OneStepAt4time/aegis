/**
 * Bidirectional mapping between ACP protocol stopReason values
 * and Aegis AcpSessionStatus values.
 *
 * ACP stopReason values (from the protocol spec):
 *   end_turn, max_tokens, max_turn_requests, refusal, cancelled
 *
 * @see https://github.com/AcpProtocol/acp/blob/main/specification/json-rpc.md
 */

/** ACP protocol stopReason values. */
export type AcpStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled';

import type { AcpSessionStatus } from './types.js';

/**
 * Map an ACP stopReason to the corresponding Aegis session status.
 *
 * | stopReason        | Aegis Status | Rationale                              |
 * |-------------------|-------------|----------------------------------------|
 * | end_turn          | idle        | Normal completion                      |
 * | max_tokens        | idle        | Ran out of tokens but still completed   |
 * | max_turn_requests | idle        | Turn limit hit, session still usable   |
 * | refusal           | failed      | Agent refused — non-recoverable        |
 * | cancelled         | closed      | User-initiated cancel or interrupt     |
 *
 * Unknown values default to 'idle' (non-fatal, session is still usable).
 */
export function mapStopReasonToStatus(
  stopReason: string
): AcpSessionStatus {
  switch (stopReason) {
    case 'end_turn':
    case 'max_tokens':
    case 'max_turn_requests':
      return 'idle';
    case 'refusal':
      return 'failed';
    case 'cancelled':
      return 'closed';
    default:
      return 'idle';
  }
}

/**
 * All known ACP stopReason values.
 * Useful for validation and golden tests.
 */
export const KNOWN_STOP_REASONS: readonly AcpStopReason[] = [
  'end_turn',
  'max_tokens',
  'max_turn_requests',
  'refusal',
  'cancelled',
] as const;

/** Check if a value is a known AcpStopReason. */
export function isKnownStopReason(value: string): value is AcpStopReason {
  return (KNOWN_STOP_REASONS as readonly string[]).includes(value);
}
