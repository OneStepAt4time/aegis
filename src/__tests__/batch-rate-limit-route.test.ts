/**
 * batch-rate-limit-route.test.ts — Integration tests for Issue #583:
 * Per-key batch rate limiting on POST /v1/sessions/batch.
 *
 * Tests the AuthManager.checkBatchRateLimit() method which powers
 * the route-level rate limiting in server.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthManager } from '../auth.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

describe('Batch rate limiting (Issue #583)', () => {
  let auth: AuthManager;
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `aegis-batch-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    auth = new AuthManager(tmpFile, '');
    await auth.load();
  });

  afterEach(async () => {
    try { await rm(tmpFile); } catch { /* ignore */ }
  });

  describe('checkBatchRateLimit', () => {
    it('allows the first batch request for a key', () => {
      expect(auth.checkBatchRateLimit('key-1')).toBe(false);
    });

    it('rejects a second request within 5s cooldown', () => {
      auth.checkBatchRateLimit('key-1');
      expect(auth.checkBatchRateLimit('key-1')).toBe(true);
    });

    it('allows requests from different keys independently', () => {
      auth.checkBatchRateLimit('key-1');
      expect(auth.checkBatchRateLimit('key-2')).toBe(false);
    });

    it('allows requests after cooldown expires', () => {
      auth.checkBatchRateLimit('key-1');

      // Advance time past the 5s cooldown
      vi.useFakeTimers();
      vi.advanceTimersByTime(5_001);

      expect(auth.checkBatchRateLimit('key-1')).toBe(false);

      vi.useRealTimers();
    });

    it('handles null keyId as anonymous', () => {
      expect(auth.checkBatchRateLimit(null)).toBe(false);
      // Second call with null should be rate-limited (same anonymous bucket)
      expect(auth.checkBatchRateLimit(null)).toBe(true);
    });
  });
});
