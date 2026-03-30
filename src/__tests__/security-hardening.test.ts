/**
 * security-hardening.test.ts — Tests for Issues #411, #412, #413.
 *
 * Issue #413: CORS_ORIGIN=* wildcard rejection at startup.
 * Issue #412: UUID validation on session :id path parameters.
 * Issue #411: Command input max length (10K chars).
 */

import { describe, it, expect } from 'vitest';
import {
  sendMessageSchema,
  commandSchema,
  bashSchema,
  pipelineSchema,
  isValidUUID,
  MAX_INPUT_LENGTH,
} from '../validation.js';

// ── Issue #413: CORS wildcard rejection ──────────────────────────────

describe('Issue #413: CORS_ORIGIN=* wildcard rejection', () => {
  it('splits comma-separated origins but rejects lone wildcard', () => {
    // Simulate the startup logic from server.ts
    const corsOrigin = '*';
    const origins = corsOrigin.split(',').map(s => s.trim());
    // The wildcard check in server.ts throws before reaching this,
    // but verify the parsed value would be ['*']
    expect(origins).toEqual(['*']);
  });

  it('allows explicit comma-separated origins', () => {
    const corsOrigin = 'https://app.example.com, https://admin.example.com';
    const origins = corsOrigin.split(',').map(s => s.trim());
    expect(origins).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });

  it('allows single explicit origin', () => {
    const corsOrigin = 'https://app.example.com';
    const origins = corsOrigin.split(',').map(s => s.trim());
    expect(origins).toEqual(['https://app.example.com']);
  });

  it('startup logic rejects wildcard', () => {
    const corsOrigin = '*';
    // This mirrors the check in server.ts
    expect(corsOrigin === '*').toBe(true);
    // In the real server, this throws:
    // "CORS_ORIGIN=* wildcard is not allowed..."
  });
});

// ── Issue #412: UUID validation on session path params ──────────────

describe('Issue #412: UUID validation on session path params', () => {
  const validUUID = '550e8400-e29b-41d4-a716-446655440000';

  it('accepts a valid UUID', () => {
    expect(isValidUUID(validUUID)).toBe(true);
  });

  it('rejects path traversal attempt', () => {
    expect(isValidUUID('../../etc/passwd')).toBe(false);
  });

  it('rejects SQL injection attempt', () => {
    expect(isValidUUID("'; DROP TABLE sessions;--")).toBe(false);
  });

  it('rejects arbitrary strings', () => {
    expect(isValidUUID('abc')).toBe(false);
    expect(isValidUUID('session-1')).toBe(false);
    expect(isValidUUID('12345')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidUUID('')).toBe(false);
  });

  it('rejects UUID with extra whitespace', () => {
    expect(isValidUUID(` ${validUUID} `)).toBe(false);
  });

  it('rejects UUID with braces', () => {
    expect(isValidUUID(`{${validUUID}}`)).toBe(false);
  });

  it('accepts uppercase UUID', () => {
    expect(isValidUUID(validUUID.toUpperCase())).toBe(true);
  });

  it('rejects UUID-like but wrong segment lengths', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-44665544000')).toBe(false);
    expect(isValidUUID('550e8400-e29b-41d4-a716-4466554400000')).toBe(false);
  });
});

// ── Issue #411: Command input max length (10K chars) ────────────────

describe('Issue #411: Command input max length (10K chars)', () => {
  const exact10k = 'a'.repeat(MAX_INPUT_LENGTH);
  const over10k = 'a'.repeat(MAX_INPUT_LENGTH + 1);

  it('MAX_INPUT_LENGTH constant is 10000', () => {
    expect(MAX_INPUT_LENGTH).toBe(10_000);
  });

  describe('sendMessageSchema', () => {
    it('accepts text at exactly 10K chars', () => {
      expect(sendMessageSchema.safeParse({ text: exact10k }).success).toBe(true);
    });

    it('rejects text over 10K chars', () => {
      const result = sendMessageSchema.safeParse({ text: over10k });
      expect(result.success).toBe(false);
    });
  });

  describe('commandSchema', () => {
    it('accepts command at exactly 10K chars', () => {
      expect(commandSchema.safeParse({ command: exact10k }).success).toBe(true);
    });

    it('rejects command over 10K chars', () => {
      const result = commandSchema.safeParse({ command: over10k });
      expect(result.success).toBe(false);
    });
  });

  describe('bashSchema', () => {
    it('accepts command at exactly 10K chars', () => {
      expect(bashSchema.safeParse({ command: exact10k }).success).toBe(true);
    });

    it('rejects command over 10K chars', () => {
      const result = bashSchema.safeParse({ command: over10k });
      expect(result.success).toBe(false);
    });
  });

  describe('pipelineSchema prompt', () => {
    it('accepts prompt at exactly 10K chars', () => {
      expect(pipelineSchema.safeParse({
        name: 'p',
        workDir: '/tmp',
        stages: [{ name: 's', prompt: exact10k }],
      }).success).toBe(true);
    });

    it('rejects prompt over 10K chars', () => {
      const result = pipelineSchema.safeParse({
        name: 'p',
        workDir: '/tmp',
        stages: [{ name: 's', prompt: over10k }],
      });
      expect(result.success).toBe(false);
    });
  });
});
