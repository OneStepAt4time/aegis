import { describe, expect, it } from 'vitest';
import { sanitizeErrorMessage } from '../utils/sanitizeErrorMessage';

describe('sanitizeErrorMessage', () => {
  it('returns fallback for null/undefined', () => {
    expect(sanitizeErrorMessage(null)).toBe('An unexpected error occurred.');
    expect(sanitizeErrorMessage(undefined)).toBe('An unexpected error occurred.');
  });

  it('returns fallback for non-string non-error values', () => {
    expect(sanitizeErrorMessage(42)).toBe('An unexpected error occurred.');
    expect(sanitizeErrorMessage({})).toBe('An unexpected error occurred.');
  });

  it('extracts message from Error objects', () => {
    expect(sanitizeErrorMessage(new Error('Session not found'))).toBe('Session not found');
  });

  it('sanitizes Zod "Invalid input" repetition', () => {
    const raw = 'Invalid input, Invalid input, Invalid input';
    expect(sanitizeErrorMessage(raw)).toBe('The data returned by the server was invalid. Please try again.');
  });

  it('sanitizes single "Invalid input"', () => {
    expect(sanitizeErrorMessage('Invalid input')).toBe('The data returned by the server was invalid. Please try again.');
  });

  it('strips JSON path references', () => {
    const raw = 'Invalid input at "/body/name": Expected string';
    expect(sanitizeErrorMessage(raw)).not.toContain('/body/name');
  });

  it('replaces enum values with generic text', () => {
    const raw = "Expected 'admin' | 'operator' | 'viewer'";
    const result = sanitizeErrorMessage(raw);
    expect(result).toContain('a valid value');
    expect(result).not.toContain('admin');
  });

  it('replaces internal error codes', () => {
    expect(sanitizeErrorMessage('UNAUTHORIZED: Access denied')).not.toContain('UNAUTHORIZED');
    expect(sanitizeErrorMessage('NOT_FOUND: Session missing')).not.toContain('NOT_FOUND');
  });

  it('replaces short ALL_CAPS error codes', () => {
    expect(sanitizeErrorMessage('RATE_LIMITED')).toBe('Something went wrong. Please try again.');
  });

  it('trims whitespace artifacts from pattern replacements', () => {
    const raw = 'UNAUTHORIZED:  Access denied  ';
    const result = sanitizeErrorMessage(raw);
    expect(result).toBe('Access denied');
  });

  it('provides fallback when sanitization empties the message', () => {
    expect(sanitizeErrorMessage('UNAUTHORIZED:')).toBe('Something went wrong. Please try again.');
  });

  it('caps very long messages at 200 characters', () => {
    const longMsg = 'A'.repeat(300);
    const result = sanitizeErrorMessage(longMsg);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toContain('...');
  });

  it('passes through user-friendly messages unchanged', () => {
    expect(sanitizeErrorMessage('Failed to load audit logs')).toBe('Failed to load audit logs');
    expect(sanitizeErrorMessage('Network error — please check your connection')).toBe('Network error — please check your connection');
  });
});

describe('sanitizeErrorMessage with fallback', () => {
  it('uses provided fallback for null input', () => {
    expect(sanitizeErrorMessage(null, 'Custom error')).toBe('Custom error');
  });

  it('uses provided fallback when sanitization empties the message', () => {
    expect(sanitizeErrorMessage('UNAUTHORIZED:', 'Access was denied')).toBe('Access was denied');
  });

  it('prefers sanitized message over fallback when meaningful', () => {
    const result = sanitizeErrorMessage('Session not found', 'Fallback');
    expect(result).toBe('Session not found');
  });
});
