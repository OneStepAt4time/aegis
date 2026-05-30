/**
 * acp-errors.ts — Shared error classes for the ACP subsystem.
 *
 * Extracted from session-service.ts to break the circular dependency:
 *   session-service.ts ↔ pause-intervention.ts
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
