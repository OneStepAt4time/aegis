/**
 * redact-stall-detail.ts — Issue #4802 (F-6) server-side redaction helper.
 *
 * Wraps redactSecretsFromText (which catches GitHub PATs, Anthropic keys,
 * AWS keys, PEM blocks) and applies the 2000-char length cap AFTER redaction
 * so secrets near the boundary are still caught. The length cap remains as
 * defense-in-depth — redaction is the rule.
 */
import { redactSecretsFromText } from '../services/acp/event-mapper.js';

/** Redact secrets then cap length. Used by monitor.makePayload and friends. */
export function redactStallDetail(detail: string): string {
  return redactSecretsFromText(detail).slice(0, 2000);
}
