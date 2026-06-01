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
