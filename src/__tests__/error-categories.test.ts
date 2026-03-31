/**
 * error-categories.test.ts — Tests for ErrorCode enum, categorize(), and shouldRetry().
 *
 * Issue #701.
 */

import { describe, it, expect } from 'vitest';
import { ErrorCode, categorize, shouldRetry } from '../error-categories.js';
import { TmuxTimeoutError } from '../tmux.js';

// ── categorize() ──────────────────────────────────────────────────

describe('categorize', () => {
  it('categorizes TmuxTimeoutError', () => {
    const err = new TmuxTimeoutError(['send-keys', 'hello'], 5000);
    const result = categorize(err);
    expect(result.code).toBe(ErrorCode.TMUX_TIMEOUT);
    expect(result.retryable).toBe(true);
    expect(result.message).toContain('timed out');
  });

  it('categorizes session-not-found errors', () => {
    const cases = [
      new Error('Session not found: abc-123'),
      new Error('No session with id xyz'),
    ];
    for (const err of cases) {
      const result = categorize(err);
      expect(result.code).toBe(ErrorCode.SESSION_NOT_FOUND);
      expect(result.retryable).toBe(false);
    }
  });

  it('categorizes permission-rejected errors', () => {
    const cases = [
      new Error('Permission denied: write to /etc/passwd'),
      new Error('Permission rejected by user'),
    ];
    for (const err of cases) {
      const result = categorize(err);
      expect(result.code).toBe(ErrorCode.PERMISSION_REJECTED);
      expect(result.retryable).toBe(false);
    }
  });

  it('categorizes auth errors', () => {
    const cases = [
      new Error('Unauthorized: missing token'),
      new Error('Invalid token'),
      new Error('Authentication failed'),
    ];
    for (const err of cases) {
      const result = categorize(err);
      expect(result.code).toBe(ErrorCode.AUTH_ERROR);
      expect(result.retryable).toBe(false);
    }
  });

  it('categorizes rate-limit errors', () => {
    const cases = [
      new Error('Rate limit exceeded'),
      new Error('Too many requests'),
    ];
    for (const err of cases) {
      const result = categorize(err);
      expect(result.code).toBe(ErrorCode.RATE_LIMITED);
      expect(result.retryable).toBe(true);
    }
  });

  it('categorizes validation errors', () => {
    const cases = [
      new Error('Validation failed: text is required'),
      new Error('Invalid session ID format'),
      new Error('text is required'),
    ];
    for (const err of cases) {
      const result = categorize(err);
      expect(result.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(result.retryable).toBe(false);
    }
  });

  it('categorizes network errors', () => {
    const cases = [
      new Error('ECONNREFUSED 127.0.0.1:9100'),
      new Error('ECONNRESET'),
      new Error('ETIMEDOUT after 30000ms'),
      new Error('fetch failed'),
    ];
    for (const err of cases) {
      const result = categorize(err);
      expect(result.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(result.retryable).toBe(true);
    }
  });

  it('categorizes generic tmux errors', () => {
    const err = new Error('tmux create-window failed');
    const result = categorize(err);
    expect(result.code).toBe(ErrorCode.TMUX_ERROR);
    expect(result.retryable).toBe(true);
  });

  it('falls back to INTERNAL_ERROR for unknown Errors', () => {
    const err = new Error('something unexpected');
    const result = categorize(err);
    expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(result.retryable).toBe(false);
    expect(result.message).toBe('something unexpected');
  });

  it('handles string errors', () => {
    const result = categorize('plain string error');
    expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(result.message).toBe('plain string error');
  });

  it('handles non-string, non-Error values', () => {
    expect(categorize(42).message).toBe('42');
    expect(categorize(null).message).toBe('null');
    expect(categorize(undefined).message).toBe('undefined');
  });
});

// ── shouldRetry() ─────────────────────────────────────────────────

describe('shouldRetry', () => {
  it('returns true for retryable errors', () => {
    expect(shouldRetry(new TmuxTimeoutError(['list-sessions'], 5000))).toBe(true);
    expect(shouldRetry(new Error('Rate limit exceeded'))).toBe(true);
    expect(shouldRetry(new Error('ECONNREFUSED'))).toBe(true);
    expect(shouldRetry(new Error('tmux send-keys failed'))).toBe(true);
  });

  it('returns false for non-retryable errors', () => {
    expect(shouldRetry(new Error('Session not found'))).toBe(false);
    expect(shouldRetry(new Error('Permission denied'))).toBe(false);
    expect(shouldRetry(new Error('Unauthorized'))).toBe(false);
    expect(shouldRetry(new Error('Validation failed'))).toBe(false);
    expect(shouldRetry(new Error('something unexpected'))).toBe(false);
    expect(shouldRetry('string error')).toBe(false);
  });
});

// ── ErrorCode enum ────────────────────────────────────────────────

describe('ErrorCode enum', () => {
  it('has expected members', () => {
    expect(ErrorCode.SESSION_NOT_FOUND).toBe('SESSION_NOT_FOUND');
    expect(ErrorCode.SESSION_CREATE_FAILED).toBe('SESSION_CREATE_FAILED');
    expect(ErrorCode.PERMISSION_REJECTED).toBe('PERMISSION_REJECTED');
    expect(ErrorCode.TMUX_TIMEOUT).toBe('TMUX_TIMEOUT');
    expect(ErrorCode.TMUX_ERROR).toBe('TMUX_ERROR');
    expect(ErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ErrorCode.AUTH_ERROR).toBe('AUTH_ERROR');
    expect(ErrorCode.RATE_LIMITED).toBe('RATE_LIMITED');
    expect(ErrorCode.NETWORK_ERROR).toBe('NETWORK_ERROR');
    expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });
});
