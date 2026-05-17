/**
 * cli-model-effort-flags-3545.test.ts — Tests for Issue #3545.
 *
 * Tests --model and --effort flag validation for ag create and ag run.
 * Covers: valid values, invalid effort, edge cases (bare flags, numeric effort).
 */

import { describe, it, expect } from 'vitest';
import { validateEffort } from '../validation.js';

describe('validateEffort (#3545)', () => {
  it('accepts "low"', () => {
    expect(validateEffort('low')).toBe('low');
  });

  it('accepts "medium"', () => {
    expect(validateEffort('medium')).toBe('medium');
  });

  it('accepts "high"', () => {
    expect(validateEffort('high')).toBe('high');
  });

  it('accepts case-insensitive "HIGH"', () => {
    expect(validateEffort('HIGH')).toBe('high');
  });

  it('accepts numeric "0.5"', () => {
    expect(validateEffort('0.5')).toBe('0.5');
  });

  it('accepts numeric "1.0"', () => {
    expect(validateEffort('1.0')).toBe('1');
  });

  it('accepts numeric "0.0"', () => {
    expect(validateEffort('0.0')).toBe('0');
  });

  it('rejects "extreme"', () => {
    expect(validateEffort('extreme')).toBeNull();
  });

  it('rejects "1.5" (out of range)', () => {
    expect(validateEffort('1.5')).toBeNull();
  });

  it('rejects "-0.1" (negative)', () => {
    expect(validateEffort('-0.1')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateEffort('')).toBeNull();
  });

  it('rejects random text', () => {
    expect(validateEffort('turbo')).toBeNull();
  });
});
