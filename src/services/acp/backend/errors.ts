/**
 * backend/errors.ts — ACP Backend error classes.
 *
 * Issue #4534: Extracted from backend.ts for gate:arch compliance.
 */

export class AcpBackendLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcpBackendLifecycleError';
  }
}

export class AcpBackendRuntimeUnavailableError extends AcpBackendLifecycleError {
  constructor(sessionId: string) {
    super(`ACP runtime is not active for session: ${sessionId}`);
    this.name = 'AcpBackendRuntimeUnavailableError';
  }
}

/**
 * Issue #4777: pendingHandshakes capacity error. Thrown synchronously from
 * `createSessionAsync` when the `pendingHandshakes` Map is at the configured
 * `maxPendingHandshakes` cap and a NEW unique sessionId is requested.
 *
 * Rejection (vs eviction) is the chosen response shape: a typed error is
 * observable at the call site, whereas silently evicting the oldest entry's
 * references would surprise the caller. The Map is a backpressure surface —
 * the caller can retry with backoff or surface the error to its user.
 *
 * This error is NOT a lifecycle error (it does not extend
 * AcpBackendLifecycleError) because it represents a precondition violation
 * at the `createSessionAsync` boundary, not a lifecycle event of an existing
 * runtime. Callers that don't care about the cap-rejection case can still
 * catch via `instanceof Error` or via the `name === 'AcpBackendPendingHandshakesCapExceededError'`
 * discriminator.
 */
export class AcpBackendPendingHandshakesCapExceededError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly cap: number,
    public readonly pendingCount: number
  ) {
    super(
      `pendingHandshakes cap exceeded: ${pendingCount} >= ${cap} for session ${sessionId}`
    );
    this.name = 'AcpBackendPendingHandshakesCapExceededError';
  }
}
