/**
 * webhook-signature.ts — Webhook signature verification helper SDK.
 *
 * Provides HMAC-SHA256 signing and verification for webhook payloads.
 * Consumers import this module to validate incoming Aegis webhooks.
 *
 * Signature format:  t=<unix_seconds>,v1=<hmac_sha256_hex>
 * HMAC input:        <timestamp>.<payload_body>
 */

import crypto from 'node:crypto';

/** Default timestamp tolerance: 5 minutes. */
const DEFAULT_TOLERANCE_SECONDS = 300;

/** Current signature version prefix. */
const SIGNATURE_VERSION = 'v1';

// ─── Signing ────────────────────────────────────────────────────────

export interface SignedPayload {
  /** The signature header value: `t=<unix>,v1=<hex>`. */
  signatureHeader: string;
  /** Unix timestamp (seconds) used for signing. */
  timestamp: number;
}

/**
 * Sign a webhook payload with HMAC-SHA256.
 *
 * @param payload  - Raw JSON string of the webhook body.
 * @param secret   - Shared secret (the endpoint's `secret` field).
 * @param timestamp - Unix timestamp in seconds. Defaults to `Date.now() / 1000`.
 * @returns The signature header value and timestamp.
 */
export function signPayload(
  payload: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): SignedPayload {
  const signedInput = `${timestamp}.${payload}`;
  const hmac = crypto.createHmac('sha256', secret).update(signedInput, 'utf8').digest('hex');
  const signatureHeader = `t=${timestamp},${SIGNATURE_VERSION}=${hmac}`;
  return { signatureHeader, timestamp };
}

// ─── Verification ───────────────────────────────────────────────────

export interface VerifyOptions {
  /** Max age of the signature in seconds. Default: 300 (5 minutes). */
  toleranceSeconds?: number;
  /** Current time override for testing. Unix seconds. */
  currentTime?: number;
}

export interface VerifyResult {
  valid: true;
  timestamp: number;
}

export interface VerifyFailure {
  valid: false;
  reason: string;
}

/**
 * Verify an incoming webhook signature.
 *
 * Supports the current `t=<ts>,v1=<hex>` format.
 * Also accepts the legacy `sha256=<hex>` format (no timestamp / no replay protection).
 *
 * @param payload         - Raw JSON string of the received body.
 * @param signatureHeader - Value of the `X-Aegis-Signature` header.
 * @param secret          - Shared secret.
 * @param options         - Tolerance and time overrides.
 * @returns Verification result with `valid` flag and details.
 */
export function verifySignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  options?: VerifyOptions,
): VerifyResult | VerifyFailure {
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    return { valid: false, reason: 'Missing or invalid signature header' };
  }

  // Legacy format: sha256=<hex> (no timestamp)
  if (signatureHeader.startsWith('sha256=')) {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
    const provided = signatureHeader.slice('sha256='.length);
    if (!timingSafeEqual(expected, provided)) {
      return { valid: false, reason: 'Signature mismatch' };
    }
    return { valid: true, timestamp: 0 };
  }

  // Current format: t=<ts>,v1=<hex>
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return { valid: false, reason: 'Invalid signature header format' };
  }

  const { timestamp, signatures } = parsed;

  // Check for v1 signatures early (before expensive HMAC computation)
  const v1Signatures = signatures.filter(s => s.version === SIGNATURE_VERSION);
  if (v1Signatures.length === 0) {
    return { valid: false, reason: `No ${SIGNATURE_VERSION} signature found` };
  }

  // Timestamp freshness check (replay protection)
  const tolerance = options?.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options?.currentTime ?? Math.floor(Date.now() / 1000);
  const age = now - timestamp;
  if (age < 0) {
    return { valid: false, reason: `Signature timestamp is in the future (${age}s)` };
  }
  if (age > tolerance) {
    return { valid: false, reason: `Signature expired (${age}s old, max ${tolerance}s)` };
  }

  // Recompute expected signature
  const signedInput = `${timestamp}.${payload}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedInput, 'utf8')
    .digest('hex');

  const matched = v1Signatures.some(s => timingSafeEqual(expected, s.hex));
  if (!matched) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  return { valid: true, timestamp };
}

// ─── Internal helpers ───────────────────────────────────────────────

interface ParsedSignature {
  timestamp: number;
  signatures: { version: string; hex: string }[];
}

/**
 * Parse `t=<ts>,v1=<hex>[,vN=<hex>]` into structured parts.
 */
function parseSignatureHeader(header: string): ParsedSignature | null {
  const parts = header.split(',');
  let timestamp: number | undefined;
  const signatures: { version: string; hex: string }[] = [];

  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) return null;
    const key = part.slice(0, eqIndex);
    const value = part.slice(eqIndex + 1);

    if (key === 't') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      timestamp = parsed;
    } else {
      // Versioned signature: v1=<hex>, v2=<hex>, etc.
      if (!/^[a-f0-9]+$/i.test(value)) return null;
      signatures.push({ version: key, hex: value });
    }
  }

  if (timestamp === undefined || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * #2454: Pads shorter input to match longer so the comparison always runs
 * in constant time, preventing length-leak side channels.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const bufA = Buffer.alloc(maxLen);
  const bufB = Buffer.alloc(maxLen);
  bufA.write(a, 'utf8');
  bufB.write(b, 'utf8');
  return crypto.timingSafeEqual(bufA, bufB) && a.length === b.length;
}
