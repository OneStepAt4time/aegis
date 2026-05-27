/**
 * session-hook-circuit-breaker.ts — Hook failure circuit breaker for sessions.
 *
 * Issue #2518: Tracks StopFailure events per session and trips a circuit breaker
 * when failures exceed a threshold within a sliding time window.
 * Once tripped, the breaker stays tripped until reset by a successful hook event.
 *
 * Extracted from session.ts (#4246) for testability and cohesion.
 */

import type { SessionInfo } from './session-types.js';

/**
 * Record a StopFailure hook event for circuit breaker tracking.
 * Appends the current timestamp to the session's failure log.
 */
export function recordHookFailure(session: SessionInfo): void {
  if (!session.hookFailureTimestamps) session.hookFailureTimestamps = [];
  session.hookFailureTimestamps.push(Date.now());
}

/**
 * Record a Stop (success) event — resets circuit breaker state.
 * Clears all failure timestamps and un-trips the breaker.
 */
export function recordHookSuccess(session: SessionInfo): void {
  session.hookFailureTimestamps = [];
  session.circuitBreakerTripped = false;
}

/**
 * Check whether the circuit breaker should trip.
 * Prunes stale timestamps outside the sliding window, then trips if the
 * failure count meets or exceeds maxFailures. Once tripped, always returns true.
 *
 * @returns true if the circuit breaker is tripped (or trips now).
 */
export function checkHookCircuitBreaker(
  session: SessionInfo,
  maxFailures: number,
  windowMs: number,
): boolean {
  if (session.circuitBreakerTripped) return true;

  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = (session.hookFailureTimestamps ?? []).filter(ts => ts >= cutoff);
  session.hookFailureTimestamps = recent;

  if (recent.length >= maxFailures) {
    session.circuitBreakerTripped = true;
    return true;
  }
  return false;
}
