/**
 * webhook-signature-1955.test.ts — Unit tests for webhook signature verification SDK.
 *
 * Covers: valid signature, expired timestamp, tampered payload,
 * wrong secret, missing/invalid header, legacy format, replay protection.
 */

import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { signPayload, verifySignature } from '../webhook-signature.js';

const SECRET = 'whsec_test_secret_12345';
const PAYLOAD = JSON.stringify({ event: 'session.created', session: { id: 'abc-123' } });

describe('webhook-signature', () => {
  // ─── signPayload ──────────────────────────────────────────────

  describe('signPayload', () => {
    it('produces a t=<ts>,v1=<hex> header', () => {
      const result = signPayload(PAYLOAD, SECRET, 1700000000);
      expect(result.timestamp).toBe(1700000000);
      expect(result.signatureHeader).toMatch(/^t=1700000000,v1=[a-f0-9]{64}$/);
    });

    it('uses current time when no timestamp provided', () => {
      const before = Math.floor(Date.now() / 1000);
      const result = signPayload(PAYLOAD, SECRET);
      const after = Math.floor(Date.now() / 1000);
      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });

    it('produces deterministic HMAC for same inputs', () => {
      const a = signPayload(PAYLOAD, SECRET, 1700000000);
      const b = signPayload(PAYLOAD, SECRET, 1700000000);
      expect(a.signatureHeader).toBe(b.signatureHeader);
    });

    it('produces different HMAC for different payloads', () => {
      const a = signPayload(PAYLOAD, SECRET, 1700000000);
      const b = signPayload('{"different":true}', SECRET, 1700000000);
      expect(a.signatureHeader).not.toBe(b.signatureHeader);
    });
  });

  // ─── verifySignature — happy path ────────────────────────────

  describe('verifySignature — valid signatures', () => {
    it('accepts a valid current-format signature', () => {
      const ts = Math.floor(Date.now() / 1000);
      const { signatureHeader } = signPayload(PAYLOAD, SECRET, ts);
      const result = verifySignature(PAYLOAD, signatureHeader, SECRET);
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.timestamp).toBe(ts);
    });

    it('accepts a valid legacy sha256=<hex> signature', () => {
      const hmac = crypto.createHmac('sha256', SECRET).update(PAYLOAD, 'utf8').digest('hex');
      const header = `sha256=${hmac}`;
      const result = verifySignature(PAYLOAD, header, SECRET);
      expect(result.valid).toBe(true);
    });

    it('accepts a signature at the edge of tolerance', () => {
      const now = 1700000000;
      const ts = now - 299; // within default 300s tolerance
      const { signatureHeader } = signPayload(PAYLOAD, SECRET, ts);
      const result = verifySignature(PAYLOAD, signatureHeader, SECRET, { currentTime: now });
      expect(result.valid).toBe(true);
    });
  });

  // ─── verifySignature — replay / expired ──────────────────────

  describe('verifySignature — expired timestamp', () => {
    it('rejects a signature older than tolerance', () => {
      const now = 1700000000;
      const ts = now - 301; // 1s past default 300s tolerance
      const { signatureHeader } = signPayload(PAYLOAD, SECRET, ts);
      const result = verifySignature(PAYLOAD, signatureHeader, SECRET, { currentTime: now });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('expired');
    });

    it('respects custom tolerance', () => {
      const now = 1700000000;
      const ts = now - 60;
      const { signatureHeader } = signPayload(PAYLOAD, SECRET, ts);
      // With 30s tolerance, 60s old should fail
      const result = verifySignature(PAYLOAD, signatureHeader, SECRET, {
        toleranceSeconds: 30,
        currentTime: now,
      });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('expired');
    });

    it('rejects a future-dated timestamp', () => {
      const now = 1700000000;
      const ts = now + 60; // 60s in the future
      const { signatureHeader } = signPayload(PAYLOAD, SECRET, ts);
      const result = verifySignature(PAYLOAD, signatureHeader, SECRET, { currentTime: now });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('future');
    });
  });

  // ─── verifySignature — tampered / wrong secret ───────────────

  describe('verifySignature — tampered payload', () => {
    it('rejects when payload is modified', () => {
      const ts = Math.floor(Date.now() / 1000);
      const { signatureHeader } = signPayload(PAYLOAD, SECRET, ts);
      const tampered = JSON.stringify({ event: 'session.deleted', session: { id: 'abc-123' } });
      const result = verifySignature(tampered, signatureHeader, SECRET);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('mismatch');
    });

    it('rejects when secret is wrong', () => {
      const ts = Math.floor(Date.now() / 1000);
      const { signatureHeader } = signPayload(PAYLOAD, SECRET, ts);
      const result = verifySignature(PAYLOAD, signatureHeader, 'wrong_secret');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('mismatch');
    });

    it('rejects legacy signature with wrong secret', () => {
      const hmac = crypto.createHmac('sha256', SECRET).update(PAYLOAD, 'utf8').digest('hex');
      const header = `sha256=${hmac}`;
      const result = verifySignature(PAYLOAD, header, 'wrong_secret');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('mismatch');
    });
  });

  // ─── verifySignature — malformed header ──────────────────────

  describe('verifySignature — invalid header', () => {
    it('rejects empty header', () => {
      const result = verifySignature(PAYLOAD, '', SECRET);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('Missing');
    });

    it('rejects garbage header', () => {
      const result = verifySignature(PAYLOAD, 'not-a-real-signature', SECRET);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('format');
    });

    it('rejects header with timestamp but no signature', () => {
      const result = verifySignature(PAYLOAD, 't=1700000000', SECRET);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('format');
    });

    it('rejects header with non-numeric timestamp', () => {
      const result = verifySignature(PAYLOAD, 't=abc,v1=abc123', SECRET);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('format');
    });

    it('rejects header with no v1 signature', () => {
      const result = verifySignature(PAYLOAD, 't=1700000000,v2=abc123', SECRET);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('No v1');
    });
  });

  // ─── Timing-safe comparison ──────────────────────────────────

  describe('timing-safe comparison', () => {
    it('rejects a signature with different length (no crash)', () => {
      const ts = Math.floor(Date.now() / 1000);
      const { signatureHeader } = signPayload(PAYLOAD, SECRET, ts);
      // Truncate the hex part — different length
      const tamperedHeader = signatureHeader.slice(0, -5);
      const result = verifySignature(PAYLOAD, tamperedHeader, SECRET);
      expect(result.valid).toBe(false);
    });
  });
});
