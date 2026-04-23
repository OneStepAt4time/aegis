/**
 * verify.ts — Webhook signature verification SDK.
 *
 * Re-exports the HMAC-SHA256 signing and verification functions from
 * `webhook-signature.ts` as the public SDK surface.
 *
 * Usage:
 * ```ts
 * import { verifySignature } from '@onestepat4time/aegis/webhook';
 *
 * const result = verifySignature(rawBody, sigHeader, secret);
 * if (!result.valid) {
 *   console.error('Rejected:', result.reason);
 *   return;
 * }
 * ```
 *
 * @module webhook
 */

export {
  verifySignature,
  signPayload,
} from '../webhook-signature.js';

export type {
  VerifyResult,
  VerifyFailure,
  VerifyOptions,
  SignedPayload,
} from '../webhook-signature.js';
