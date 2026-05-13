/**
 * runners/stubs/shared.ts — Shared utilities for stub runners.
 *
 * Issue #3263: Common error types for placeholder runner implementations.
 */

/**
 * Error thrown by stub runner methods that are not yet implemented.
 *
 * Stubs compile and register successfully but throw on any lifecycle operation,
 * allowing the interface contract to be validated without a real agent binary.
 */
export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented. This runner is a stub for future agent integration.`);
    this.name = 'NotImplementedError';
  }
}
