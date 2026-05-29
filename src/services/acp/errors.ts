/**
 * services/acp/errors.ts — Shared ACP error classes.
 *
 * Extracted from session-service.ts to break circular dependency with
 * pause-intervention.ts (which imports these errors).
 */

export class AcpDurableIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcpDurableIdentityError';
  }
}

export class AcpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcpValidationError';
  }
}
