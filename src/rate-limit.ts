/**
 * rate-limit.ts — Shared rate-limit detection for CLI and programmatic use.
 *
 * Patterns cover common Claude API rate-limit / quota-exhaustion messages.
 * Issue #3631: surfaced in `ag run` with actionable exit guidance.
 */

/** Patterns that indicate a rate-limit or quota-exhaustion error from the Claude API. */
export const RATE_LIMIT_PATTERNS: readonly RegExp[] = [
  /rate.?limit/i,
  /hit your limit/i,
  /quota exceeded/i,
  /too many requests/i,
  /usage limit/i,
  /capacity/i,
  /overloaded/i,
  /reset.*\d+:\d+/i,
  /try again in\s+\d/i,
];

/** Check whether an error message indicates a rate-limit event. */
export function isRateLimitError(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some(p => p.test(text));
}
