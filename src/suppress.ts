/**
 * suppress.ts — Explicit suppression predicate for expected runtime races.
 *
 * Issue #882: Replaces silent empty catches with a documented, testable
 * suppression contract. Suppressible errors (expected races, killed sessions,
 * missing tmux panes, tmux timeouts on non-critical ops) are forwarded as
 * rate-limited diagnostics events. Non-suppressible errors are surfaced at
 * warn level.
 */

import { TmuxTimeoutError } from './tmux.js';

/** Contexts where suppressible races may occur. */
export type SuppressContext =
  | 'monitor.checkSession'
  | 'monitor.checkDeadSessions.killSession'
  | 'monitor.checkStopSignals.parseEntry'
  | 'session.cleanup'
  | 'tmux.capturePane'
  | 'tmux.listWindows'
  | string;

/** Tmux operation contexts where a timeout is non-critical and safe to suppress. */
const TMUX_TIMEOUT_SUPPRESSIBLE_CONTEXTS: readonly string[] = [
  'tmux.capturePane',
  'tmux.listWindows',
  'monitor.checkSession',
];

/** Rate-limit state: max N suppressed debug events per context per minute. */
const suppressRateLimit = new Map<string, { count: number; resetAt: number }>();
/** Exported for tests — clears all rate-limit counters. */
export function _resetSuppressRateLimit(): void {
  suppressRateLimit.clear();
}

const SUPPRESS_MAX_PER_MINUTE = 10;

/**
 * Returns true if the error is an expected transient race that
 * should be swallowed without surfacing a warning.
 *
 * Categories of suppressible errors:
 * - Session killed while in-flight (SESSION_NOT_FOUND-class messages)
 * - File not found (ENOENT) — session JSONL removed after kill
 * - Tmux pane/window gone — dead-session race
 * - SyntaxError from truncated JSONL reads during rotation
 * - TmuxTimeoutError during non-critical read-only operations (capture-pane, list-windows)
 */
export function isSuppressible(error: unknown, context: SuppressContext): boolean {
  if (error instanceof SyntaxError) return true;

  // Timeouts during non-critical tmux read operations are transient and safe to suppress.
  if (error instanceof TmuxTimeoutError && TMUX_TIMEOUT_SUPPRESSIBLE_CONTEXTS.includes(context)) {
    return true;
  }

  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return true;

    const msg = error.message.toLowerCase();
    if (msg.includes('session not found')) return true;
    if (msg.includes('no session with id')) return true;
    if (msg.includes('no such window')) return true;
    if (msg.includes('no such pane')) return true;
    if (msg.includes('no such session')) return true;
    if (msg.includes("can't find window")) return true;
    if (msg.includes('window already dead')) return true;
  }
  return false;
}

/**
 * Handle a caught error using the explicit suppression policy.
 *
 * - Suppressible errors: console.debug with rate limiting (max 10/min per context).
 * - Non-suppressible errors: console.warn — always visible.
 *
 * Does NOT rethrow. Call isSuppressible() directly if you need rethrow control.
 */
export function suppressedCatch(error: unknown, context: SuppressContext): void {
  if (isSuppressible(error, context)) {
    const now = Date.now();
    const state = suppressRateLimit.get(context);
    if (!state || now >= state.resetAt) {
      suppressRateLimit.set(context, { count: 1, resetAt: now + 60_000 });
      console.debug(`[suppress] ${context}: ${_errorMessage(error)}`);
    } else if (state.count < SUPPRESS_MAX_PER_MINUTE) {
      state.count++;
      console.debug(`[suppress] ${context}: ${_errorMessage(error)}`);
    }
    // rate limit exceeded for this window — drop silently
  } else {
    console.warn(`[unexpected] ${context}: ${_errorMessage(error)}`, error);
  }
}

export function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
