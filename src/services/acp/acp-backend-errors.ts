/**
 * acp-backend-errors.ts — Error classes for the ACP backend lifecycle manager.
 *
 * Extracted from backend.ts for shared use across modules.
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
