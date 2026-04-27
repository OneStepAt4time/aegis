/**
 * quota-manager-1953.test.ts — Tests for Issue #1953: Per-tenant quotas.
 *
 * Tests QuotaManager enforcement, AuthManager quota CRUD,
 * and route-level integration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { QuotaManager } from '../services/auth/QuotaManager.js';
import { AuthManager } from '../services/auth/AuthManager.js';
import type { ApiKey, QuotaConfig } from '../services/auth/types.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

// ── Helpers ────────────────────────────────────────────────────────

function makeKey(id: string, quotas?: QuotaConfig): ApiKey {
  return {
    id,
    name: `test-${id}`,
    hash: 'fake-hash',
    createdAt: Date.now(),
    lastUsedAt: 0,
    rateLimit: 100,
    expiresAt: null,
    role: 'operator',
    permissions: ['create', 'send'],
    quotas,
  };
}

describe('QuotaManager (Issue #1953)', () => {
  let qm: QuotaManager;

  beforeEach(() => {
    qm = new QuotaManager();
  });

  describe('No quotas set', () => {
    it('allows session creation when key has no quotas', () => {
      const key = makeKey('k1');
      const result = qm.checkSessionQuota(key, 0);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows null key (no auth)', () => {
      const result = qm.checkSessionQuota(null, 0);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Concurrent sessions quota', () => {
    it('allows when under the limit', () => {
      const key = makeKey('k1', {
        maxConcurrentSessions: 5,
        maxTokensPerWindow: null,
        maxSpendPerWindow: null,
        quotaWindowMs: 3_600_000,
      });
      const result = qm.checkSessionQuota(key, 4);
      expect(result.allowed).toBe(true);
    });

    it('rejects when at the limit', () => {
      const key = makeKey('k1', {
        maxConcurrentSessions: 3,
        maxTokensPerWindow: null,
        maxSpendPerWindow: null,
        quotaWindowMs: 3_600_000,
      });
      const result = qm.checkSessionQuota(key, 3);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('concurrent_sessions');
      expect(result.message).toContain('3 active sessions');
      expect(result.message).toContain('max 3');
    });

    it('rejects when over the limit', () => {
      const key = makeKey('k1', {
        maxConcurrentSessions: 2,
        maxTokensPerWindow: null,
        maxSpendPerWindow: null,
        quotaWindowMs: 3_600_000,
      });
      const result = qm.checkSessionQuota(key, 5);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('concurrent_sessions');
    });

    it('usage snapshot reflects correct session count', () => {
      const key = makeKey('k1', {
        maxConcurrentSessions: 10,
        maxTokensPerWindow: null,
        maxSpendPerWindow: null,
        quotaWindowMs: 3_600_000,
      });
      const result = qm.checkSessionQuota(key, 7);
      expect(result.usage.activeSessions).toBe(7);
      expect(result.usage.maxSessions).toBe(10);
    });
  });

  describe('Token quota per window', () => {
    it('allows when under token limit', () => {
      const key = makeKey('k1', {
        maxConcurrentSessions: null,
        maxTokensPerWindow: 1000,
        maxSpendPerWindow: null,
        quotaWindowMs: 3_600_000,
      });
      qm.recordUsage('k1', 500, 0);
      const result = qm.checkSessionQuota(key, 0);
      expect(result.allowed).toBe(true);
      expect(result.usage.tokensInWindow).toBe(500);
    });

    it('rejects when token limit reached', () => {
      const key = makeKey('k1', {
        maxConcurrentSessions: null,
        maxTokensPerWindow: 1000,
        maxSpendPerWindow: null,
        quotaWindowMs: 3_600_000,
      });
      qm.recordUsage('k1', 1000, 0);
      const result = qm.checkSessionQuota(key, 0);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('tokens_per_window');
      expect(result.message).toContain('1000 tokens');
    });

    it('rejects send when over token limit', () => {
      const key = makeKey('k1', {
        maxConcurrentSessions: null,
        maxTokensPerWindow: 500,
        maxSpendPerWindow: null,
        quotaWindowMs: 3_600_000,
      });
      qm.recordUsage('k1', 600, 0);
      const result = qm.checkSendQuota(key, 1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('tokens_per_window');
    });
  });

  describe('Spend quota per window', () => {
    it('allows when under spend limit', () => {
      const key = makeKey('k1', {
        maxConcurrentSessions: null,
        maxTokensPerWindow: null,
        maxSpendPerWindow: 10,
        quotaWindowMs: 3_600_000,
      });
      qm.recordUsage('k1', 0, 5.50);
      const result = qm.checkSessionQuota(key, 0);
      expect(result.allowed).toBe(true);
      expect(result.usage.spendInWindow).toBeCloseTo(5.50, 4);
    });

    it('rejects when spend limit reached', () => {
      const key = makeKey('k1', {
        maxConcurrentSessions: null,
        maxTokensPerWindow: null,
        maxSpendPerWindow: 5,
        quotaWindowMs: 3_600_000,
      });
      qm.recordUsage('k1', 0, 5.10);
      const result = qm.checkSessionQuota(key, 0);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('spend_per_window');
      expect(result.message).toContain('$5.1000');
    });
  });

  describe('Rolling window expiry', () => {
    it('expires old entries on sweep', () => {
      const key = makeKey('k1', {
        maxConcurrentSessions: null,
        maxTokensPerWindow: 100,
        maxSpendPerWindow: null,
        quotaWindowMs: 1_000, // 1 second window
      });

      // Record usage, then wait for it to expire
      qm.recordUsage('k1', 100, 0);
      const result1 = qm.checkSessionQuota(key, 0);
      expect(result1.allowed).toBe(false);

      // Manually push timestamps into the past
      const entries = (qm as any).usageLog.get('k1') as Array<{ timestamp: number; tokens: number; costUsd: number }>;
      entries[0].timestamp = Date.now() - 2_000; // 2s ago, past the 1s window

      qm.sweep(1_000);

      const result2 = qm.checkSessionQuota(key, 0);
      expect(result2.allowed).toBe(true);
      expect(result2.usage.tokensInWindow).toBe(0);
    });
  });

  describe('clearKey', () => {
    it('removes all usage data for a key', () => {
      qm.recordUsage('k1', 100, 0.5);
      qm.clearKey('k1');
      // After clearing, a key with quotas should be allowed
      const key = makeKey('k1', {
        maxConcurrentSessions: null,
        maxTokensPerWindow: 50,
        maxSpendPerWindow: null,
        quotaWindowMs: 3_600_000,
      });
      const result = qm.checkSessionQuota(key, 0);
      expect(result.allowed).toBe(true);
      expect(result.usage.tokensInWindow).toBe(0);
    });
  });

  describe('getUsage', () => {
    it('returns complete usage snapshot', () => {
      const key = makeKey('k1', {
        maxConcurrentSessions: 5,
        maxTokensPerWindow: 10_000,
        maxSpendPerWindow: 50,
        quotaWindowMs: 3_600_000,
      });
      qm.recordUsage('k1', 2000, 3.50);
      const usage = qm.getUsage(key, 3);
      expect(usage.activeSessions).toBe(3);
      expect(usage.maxSessions).toBe(5);
      expect(usage.tokensInWindow).toBe(2000);
      expect(usage.maxTokens).toBe(10_000);
      expect(usage.spendInWindow).toBeCloseTo(3.50, 4);
      expect(usage.maxSpend).toBe(50);
      expect(usage.windowMs).toBe(3_600_000);
    });
  });

  describe('Multiple usage entries accumulate', () => {
    it('sums multiple records in the same window', () => {
      const key = makeKey('k1', {
        maxConcurrentSessions: null,
        maxTokensPerWindow: 1000,
        maxSpendPerWindow: 10,
        quotaWindowMs: 3_600_000,
      });
      qm.recordUsage('k1', 300, 1);
      qm.recordUsage('k1', 400, 2);
      qm.recordUsage('k1', 200, 0.5);
      const usage = qm.getUsage(key, 0);
      expect(usage.tokensInWindow).toBe(900);
      expect(usage.spendInWindow).toBeCloseTo(3.50, 4);
    });
  });
});

describe('AuthManager quota CRUD (Issue #1953)', () => {
  let auth: AuthManager;
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `aegis-quotas-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    auth = new AuthManager(tmpFile, 'test-master');
    await auth.load();
  });

  it('creates key without quotas', async () => {
    const { id } = await auth.createKey('no-quotas');
    const key = auth.getKey(id);
    expect(key).not.toBeNull();
    expect(key!.quotas).toBeUndefined();
  });

  it('getKey returns null for unknown id', () => {
    expect(auth.getKey('nonexistent')).toBeNull();
  });

  it('setQuotas persists quotas on a key', async () => {
    const { id } = await auth.createKey('quota-key');
    const quotas: QuotaConfig = {
      maxConcurrentSessions: 5,
      maxTokensPerWindow: 50_000,
      maxSpendPerWindow: 100,
      quotaWindowMs: 3_600_000,
    };
    const updated = await auth.setQuotas(id, quotas);
    expect(updated).not.toBeNull();
    expect(updated!.quotas).toEqual(quotas);

    // Verify persistence
    const key = auth.getKey(id);
    expect(key!.quotas).toEqual(quotas);
  });

  it('setQuotas returns null for unknown key', async () => {
    const result = await auth.setQuotas('nonexistent', {
      maxConcurrentSessions: 1,
      maxTokensPerWindow: null,
      maxSpendPerWindow: null,
      quotaWindowMs: 3_600_000,
    });
    expect(result).toBeNull();
  });

  it('quotas survive reload from disk', async () => {
    const { id } = await auth.createKey('persist-key');
    const quotas: QuotaConfig = {
      maxConcurrentSessions: 3,
      maxTokensPerWindow: 10_000,
      maxSpendPerWindow: 25,
      quotaWindowMs: 1_800_000,
    };
    await auth.setQuotas(id, quotas);

    // Create a new AuthManager and load from the same file
    const auth2 = new AuthManager(tmpFile, 'test-master');
    await auth2.load();
    const key = auth2.getKey(id);
    expect(key!.quotas).toEqual(quotas);
  });

  it('listKeys includes quotas', async () => {
    const { id } = await auth.createKey('listed-key');
    await auth.setQuotas(id, {
      maxConcurrentSessions: 10,
      maxTokensPerWindow: null,
      maxSpendPerWindow: null,
      quotaWindowMs: 3_600_000,
    });
    const keys = auth.listKeys();
    const found = keys.find(k => k.id === id);
    expect(found).toBeDefined();
    expect(found!.quotas?.maxConcurrentSessions).toBe(10);
  });
});
