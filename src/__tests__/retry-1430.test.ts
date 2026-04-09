/**
 * retry-1430.test.ts — Tests for Issue #1430 default shouldRetry policy.
 *
 * Verifies that retryWithJitter uses error-categories.shouldRetry as the
 * default when no shouldRetry callback is provided.
 */

import { describe, it, expect, vi } from 'vitest';
import { retryWithJitter } from '../retry.js';

describe('Issue #1430: retryWithJitter default shouldRetry', () => {
  it('stops retrying a 400 validation error with the default policy', async () => {
    const fn = vi.fn(async () => {
      throw new Error('validation failed: missing required field');
    });

    await expect(retryWithJitter(fn, {
      maxAttempts: 5,
      baseDelayMs: 1,
      maxDelayMs: 2,
    })).rejects.toThrow('validation failed: missing required field');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops retrying an auth error with the default policy', async () => {
    const fn = vi.fn(async () => {
      throw new Error('unauthorized: invalid token');
    });

    await expect(retryWithJitter(fn, {
      maxAttempts: 5,
      baseDelayMs: 1,
      maxDelayMs: 2,
    })).rejects.toThrow('unauthorized: invalid token');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops retrying a permission error with the default policy', async () => {
    const fn = vi.fn(async () => {
      throw new Error('permission denied');
    });

    await expect(retryWithJitter(fn, {
      maxAttempts: 5,
      baseDelayMs: 1,
      maxDelayMs: 2,
    })).rejects.toThrow('permission denied');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient network errors with the default policy', async () => {
    let attempts = 0;
    const result = await retryWithJitter(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('ECONNREFUSED');
      return 'recovered';
    }, {
      maxAttempts: 5,
      baseDelayMs: 1,
      maxDelayMs: 2,
    });

    expect(result).toBe('recovered');
    expect(attempts).toBe(3);
  });

  it('retries tmux errors with the default policy', async () => {
    let attempts = 0;
    const result = await retryWithJitter(async () => {
      attempts += 1;
      if (attempts < 2) throw new Error('tmux: no server running');
      return 'tmux-ok';
    }, {
      maxAttempts: 5,
      baseDelayMs: 1,
      maxDelayMs: 2,
    });

    expect(result).toBe('tmux-ok');
    expect(attempts).toBe(2);
  });

  it('custom shouldRetry still overrides the default', async () => {
    const fn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    // Custom policy that never retries, even for retryable errors
    await expect(retryWithJitter(fn, {
      maxAttempts: 5,
      baseDelayMs: 1,
      maxDelayMs: 2,
      shouldRetry: () => false,
    })).rejects.toThrow('ECONNREFUSED');

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
