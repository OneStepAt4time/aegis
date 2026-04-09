/**
 * retry.ts — shared retry helper with bounded exponential backoff + jitter.
 *
 * When no `shouldRetry` callback is provided, the default policy uses
 * `error-categories.shouldRetry(categorize(err))`, which retries only on
 * transient errors (network, tmux, rate-limit) and rejects immediately on
 * validation, auth, permission, and not-found errors.
 */

import { shouldRetry as defaultShouldRetry } from './error-categories.js';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = Math.min(baseDelayMs * (2 ** (attempt - 1)), maxDelayMs);
  const jitterMultiplier = 0.5 + (Math.random() * 0.5);
  return Math.round(exponential * jitterMultiplier);
}

export async function retryWithJitter<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 3_000;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt >= maxAttempts;
      const canRetry = options.shouldRetry ? options.shouldRetry(error, attempt) : defaultShouldRetry(error);
      if (isLastAttempt || !canRetry) {
        throw error;
      }

      const delayMs = computeDelayMs(attempt, baseDelayMs, maxDelayMs);
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastError;
}
