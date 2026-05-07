import { describe, it, expect } from 'vitest';
import { timingSafeStringEqual } from '../crypto-utils.js';

describe('timingSafeStringEqual', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeStringEqual('secret', 'secret')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(timingSafeStringEqual('secret1', 'secret2')).toBe(false);
  });

  it('returns false when strings differ in length', () => {
    expect(timingSafeStringEqual('short', 'longer-string')).toBe(false);
  });

  it('returns false when a is undefined', () => {
    expect(timingSafeStringEqual(undefined, 'secret')).toBe(false);
  });

  it('returns false when b is undefined', () => {
    expect(timingSafeStringEqual('secret', undefined)).toBe(false);
  });

  it('returns false when both are undefined', () => {
    expect(timingSafeStringEqual(undefined, undefined)).toBe(false);
  });

  it('returns false when a is empty string', () => {
    expect(timingSafeStringEqual('', 'secret')).toBe(false);
  });

  it('returns false when b is empty string', () => {
    expect(timingSafeStringEqual('secret', '')).toBe(false);
  });

  it('handles equal long hex strings (64-char hook secrets)', () => {
    const secret = 'a'.repeat(64);
    expect(timingSafeStringEqual(secret, secret)).toBe(true);
  });

  it('handles nearly-equal long strings differing only at the last character', () => {
    const a = 'a'.repeat(63) + 'x';
    const b = 'a'.repeat(63) + 'y';
    expect(timingSafeStringEqual(a, b)).toBe(false);
  });

  it('does not throw when inputs have different lengths (no RANGE_ERROR)', () => {
    // The vulnerable implementation threw RANGE_ERROR caught by try/catch.
    // The correct implementation must not throw at all.
    expect(() => timingSafeStringEqual('short', 'a-much-longer-string')).not.toThrow();
  });

  it('handles unicode characters', () => {
    expect(timingSafeStringEqual('café', 'café')).toBe(true);
    expect(timingSafeStringEqual('café', 'cafe')).toBe(false);
  });
});
