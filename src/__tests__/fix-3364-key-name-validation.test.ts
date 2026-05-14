/**
 * Issue #3364: Null bytes and special characters accepted in API key names.
 * Input validation should reject unsafe key name characters.
 */

import { describe, it, expect } from 'vitest';
import { authKeySchema, updateKeySchema } from '../validation.js';

describe('Issue #3364: API key name validation', () => {
  const validNames = [
    'my-key',
    'production',
    'claude-desktop',
    'a',
    'key.with.dots',
    'KEY_123',
    'under_score',
    'MixedCase-123',
    'x'.repeat(100),
  ];

  const invalidNames = [
    'test\x00null',          // null byte
    '',                       // empty
    'x'.repeat(101),         // too long
    'has spaces',             // spaces
    'has/slash',              // slash
    'has\\backslash',         // backslash
    'name"quote',             // double quote
    "name'apostrophe",        // single quote
    'name<script>',           // angle brackets
    'name\nnewline',          // newline
    'name\ttab',              // tab
    'name;semicolon',         // semicolon
    'name&amp',               // ampersand
    '(paren)',                // parens
    '{curly}',                // curly braces
    'has@at',                 // at sign
    'has:colon',              // colon
    'has|pipe',               // pipe
    'has!bang',               // exclamation
  ];

  describe('authKeySchema (POST /v1/auth/keys)', () => {
    for (const name of validNames) {
      it(`accepts valid name: ${JSON.stringify(name.slice(0, 30))}`, () => {
        const result = authKeySchema.safeParse({ name });
        expect(result.success).toBe(true);
      });
    }

    for (const name of invalidNames) {
      it(`rejects invalid name: ${JSON.stringify(name.slice(0, 30).replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\x00/g, '\\0'))}`, () => {
        const result = authKeySchema.safeParse({ name });
        expect(result.success).toBe(false);
      });
    }

    it('accepts minimal valid body', () => {
      const result = authKeySchema.safeParse({ name: 'test' });
      expect(result.success).toBe(true);
    });
  });

  describe('updateKeySchema (PATCH /v1/auth/keys/:id)', () => {
    for (const name of validNames) {
      it(`accepts valid name update: ${JSON.stringify(name.slice(0, 30))}`, () => {
        const result = updateKeySchema.safeParse({ name });
        expect(result.success).toBe(true);
      });
    }

    for (const name of invalidNames) {
      it(`rejects invalid name update: ${JSON.stringify(name.slice(0, 30).replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\x00/g, '\\0'))}`, () => {
        const result = updateKeySchema.safeParse({ name });
        expect(result.success).toBe(false);
      });
    }

    it('accepts update without name', () => {
      const result = updateKeySchema.safeParse({ role: 'admin' });
      expect(result.success).toBe(true);
    });
  });
});
