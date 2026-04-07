/**
 * auth-timing-safe.test.ts — Verify timing-safe comparison for token validation.
 *
 * Issue #402: token === masterToken was vulnerable to timing attacks.
 * The fix uses crypto.timingSafeEqual for constant-time comparison.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthManager } from '../auth.js';

// Capture what timingSafeEqual was called with
let timingSafeEqualCalls: Array<{ a: string; b: string }> = [];

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    timingSafeEqual: vi.fn((a: Buffer, b: Buffer) => {
      timingSafeEqualCalls.push({ a: a.toString(), b: b.toString() });
      // Delegate to real implementation
      return actual.timingSafeEqual(a, b);
    }),
  };
});

describe('AuthManager timing-safe token comparison (#402)', () => {
  let auth: AuthManager;
  const masterToken = 'test_master_token_value_12345';

  beforeEach(() => {
    timingSafeEqualCalls = [];
    auth = new AuthManager('/tmp/test-keys-timing.json', masterToken);
    auth['store'] = { keys: [] };
  });

  it('uses timingSafeEqual for master token comparison', () => {
    auth.validate(masterToken);

    const matchCall = timingSafeEqualCalls.find(
      (c) => c.a === masterToken && c.b === masterToken,
    );
    expect(matchCall).toBeDefined();
  });

  it('does not use === short-circuit (wrong token fails safely)', () => {
    // A token that differs only in the last character
    const wrongToken = masterToken.slice(0, -1) + 'X';
    // Ensure lengths match so timingSafeEqual is actually called
    const result = auth.validate(wrongToken);

    expect(result.valid).toBe(false);

    // timingSafeEqual should have been called (not skipped by === check)
    const matchCall = timingSafeEqualCalls.find(
      (c) => c.a === wrongToken && c.b === masterToken,
    );
    expect(matchCall).toBeDefined();
  });

  it('uses the same timing-safe comparison path for prefix-style and positional mismatches', () => {
    const wrongFirst = `X${masterToken.slice(1)}`;
    const wrongMiddle = `${masterToken.slice(0, 10)}X${masterToken.slice(11)}`;
    const wrongLast = `${masterToken.slice(0, -1)}X`;

    const cases = [wrongFirst, wrongMiddle, wrongLast];
    for (const candidate of cases) {
      timingSafeEqualCalls = [];
      const result = auth.validate(candidate);

      expect(result.valid).toBe(false);
      expect(timingSafeEqualCalls).toHaveLength(1);
      expect(timingSafeEqualCalls[0]).toEqual({ a: candidate, b: masterToken });
    }
  });

  it('rejects tokens of different length without calling timingSafeEqual', () => {
    const result = auth.validate('short');
    expect(result.valid).toBe(false);

    // timingSafeEqual should NOT be called for length mismatch
    const matchCall = timingSafeEqualCalls.find(
      (c) => c.b === masterToken,
    );
    expect(matchCall).toBeUndefined();
  });
});
