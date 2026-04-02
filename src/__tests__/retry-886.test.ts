/**
 * retry-886.test.ts — Tests for Issue #886 shared retryWithJitter utility.
 */

import { describe, it, expect, vi } from 'vitest';
import { retryWithJitter } from '../retry.js';

describe('Issue #886: retryWithJitter', () => {
  it('retries transient errors and eventually succeeds', async () => {
    let attempts = 0;
    const result = await retryWithJitter(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('ECONNREFUSED');
      return 'ok';
    }, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 2,
      shouldRetry: (error) => String((error as Error).message).includes('ECONN'),
    });

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('fails immediately on non-retryable errors', async () => {
    const fn = vi.fn(async () => {
      throw new Error('validation failed');
    });

    await expect(retryWithJitter(fn, {
      maxAttempts: 3,
      shouldRetry: (error) => String((error as Error).message).includes('ECONN'),
    })).rejects.toThrow('validation failed');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fails after exhausting retries', async () => {
    const fn = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });

    await expect(retryWithJitter(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 2,
      shouldRetry: () => true,
    })).rejects.toThrow('ECONNRESET');

    expect(fn).toHaveBeenCalledTimes(3);
  });
});
