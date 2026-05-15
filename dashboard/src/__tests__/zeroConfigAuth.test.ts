/**
 * __tests__/zeroConfigAuth.test.ts
 * Tests for zero-config auth detection (F22, #3490).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { probePublicAccess } from '../api/client';

describe('probePublicAccess', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns true when server responds 200 without auth', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sessions: [], total: 0 }),
    });

    const result = await probePublicAccess();
    expect(result).toBe(true);
  });

  it('returns false when server responds 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Unauthorized' }),
    });

    const result = await probePublicAccess();
    expect(result).toBe(false);
  });

  it('returns false on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await probePublicAccess();
    expect(result).toBe(false);
  });

  it('returns false when server responds 403', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: 'Forbidden' }),
    });

    const result = await probePublicAccess();
    expect(result).toBe(false);
  });
});
