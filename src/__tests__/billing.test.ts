/**
 * billing.test.ts — Unit tests for the billing hook system.
 *
 * Issue #1954: Billing/metering hooks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BillingMeteringService,
  DEFAULT_RATE_TIERS,
} from '../services/billing/metering.js';
import type { BillingEvent, RateTier, TokenCounts } from '../services/billing/types.js';

/** Flush setImmediate queue so async billing events are delivered. */
function flushAsync(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('BillingMeteringService', () => {
  let billing: BillingMeteringService;

  beforeEach(() => {
    billing = new BillingMeteringService();
  });

  // ── Token usage recording ──────────────────────────────────────────

  describe('recordTokenUsage', () => {
    it('records token usage delta for a session', () => {
      billing.recordTokenUsage('sess-1', 'key-abc', {
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 200,
        cacheReadTokens: 100,
      }, 'claude-sonnet-4-20250514');

      expect(billing.recordCount).toBe(1);
      const records = billing.getSessionUsage('sess-1');
      expect(records).toHaveLength(1);
      expect(records[0].sessionId).toBe('sess-1');
      expect(records[0].keyId).toBe('key-abc');
      expect(records[0].inputTokens).toBe(1000);
      expect(records[0].outputTokens).toBe(500);
      expect(records[0].eventType).toBe('message');
      expect(records[0].model).toBe('claude-sonnet-4-20250514');
      expect(records[0].costUsd).toBeGreaterThan(0);
    });

    it('skips recording when all token counts are zero', () => {
      const tokens: TokenCounts = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      billing.recordTokenUsage('sess-1', 'key-1', tokens);
      expect(billing.recordCount).toBe(0);
    });

    it('assigns incrementing IDs', () => {
      const tokens: TokenCounts = { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 };
      billing.recordTokenUsage('sess-1', 'key-1', tokens);
      billing.recordTokenUsage('sess-1', 'key-1', tokens);
      billing.recordTokenUsage('sess-1', 'key-1', tokens);

      const records = billing.getSessionUsage('sess-1');
      expect(records[0].id).toBe(1);
      expect(records[1].id).toBe(2);
      expect(records[2].id).toBe(3);
    });

    it('handles sessions without an owner key', () => {
      const tokens: TokenCounts = { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 };
      billing.recordTokenUsage('sess-nokey', undefined, tokens);
      const records = billing.getSessionUsage('sess-nokey');
      expect(records[0].keyId).toBeUndefined();
    });
  });

  // ── Cost estimation by model ───────────────────────────────────────

  describe('cost estimation', () => {
    it('uses haiku pricing for haiku models', () => {
      const tokens: TokenCounts = { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      billing.recordTokenUsage('s1', 'k1', tokens, 'claude-haiku-4-20250514');
      const records = billing.getSessionUsage('s1');
      expect(records[0].costUsd).toBeCloseTo(0.80, 4);
    });

    it('uses sonnet pricing for sonnet models', () => {
      const tokens: TokenCounts = { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      billing.recordTokenUsage('s1', 'k1', tokens, 'claude-sonnet-4-20250514');
      const records = billing.getSessionUsage('s1');
      expect(records[0].costUsd).toBeCloseTo(3.00, 4);
    });

    it('uses opus pricing for opus models', () => {
      const tokens: TokenCounts = { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      billing.recordTokenUsage('s1', 'k1', tokens, 'claude-opus-4-20250514');
      const records = billing.getSessionUsage('s1');
      expect(records[0].costUsd).toBeCloseTo(15.00, 4);
    });

    it('defaults to sonnet pricing when model is unknown', () => {
      const tokens: TokenCounts = { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      billing.recordTokenUsage('s1', 'k1', tokens, 'gpt-4o');
      const records = billing.getSessionUsage('s1');
      expect(records[0].costUsd).toBeCloseTo(3.00, 4);
    });

    it('defaults to sonnet pricing when no model is specified', () => {
      const tokens: TokenCounts = { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      billing.recordTokenUsage('s1', 'k1', tokens);
      const records = billing.getSessionUsage('s1');
      expect(records[0].costUsd).toBeCloseTo(3.00, 4);
    });

    it('calculates multi-token-type costs correctly', () => {
      const tokens: TokenCounts = {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
      };
      billing.recordTokenUsage('s1', 'k1', tokens, 'claude-sonnet-4-20250514');
      const records = billing.getSessionUsage('s1');
      // sonnet: input=3, output=15, cacheWrite=3.75, cacheRead=0.30 per M
      expect(records[0].costUsd).toBeCloseTo(3.00 + 15.00 + 3.75 + 0.30, 4);
    });
  });

  // ── Aggregation queries ────────────────────────────────────────────

  describe('getUsageSummary', () => {
    beforeEach(() => {
      billing.recordTokenUsage('sess-1', 'key-abc', { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 100, cacheReadTokens: 50 }, 'sonnet');
      billing.recordTokenUsage('sess-2', 'key-xyz', { inputTokens: 2000, outputTokens: 1000, cacheCreationTokens: 200, cacheReadTokens: 100 }, 'opus');
    });

    it('returns total usage across all sessions', () => {
      const summary = billing.getUsageSummary();
      expect(summary.totalInputTokens).toBe(3000);
      expect(summary.totalOutputTokens).toBe(1500);
      expect(summary.totalCacheCreationTokens).toBe(300);
      expect(summary.totalCacheReadTokens).toBe(150);
      expect(summary.recordCount).toBe(2);
      expect(summary.sessionCount).toBe(2);
      expect(summary.totalCostUsd).toBeGreaterThan(0);
    });

    it('filters by keyId', () => {
      const summary = billing.getUsageSummary({ keyId: 'key-abc' });
      expect(summary.totalInputTokens).toBe(1000);
      expect(summary.sessionCount).toBe(1);
    });

    it('filters by sessionId', () => {
      const summary = billing.getUsageSummary({ sessionId: 'sess-2' });
      expect(summary.totalInputTokens).toBe(2000);
      expect(summary.sessionCount).toBe(1);
    });

    it('returns zero usage when no records match filter', () => {
      const summary = billing.getUsageSummary({ keyId: 'nonexistent' });
      expect(summary.totalInputTokens).toBe(0);
      expect(summary.recordCount).toBe(0);
      expect(summary.sessionCount).toBe(0);
    });
  });

  // ── Per-key cost breakdown ─────────────────────────────────────────

  describe('getCostByKey', () => {
    beforeEach(() => {
      billing.recordTokenUsage('sess-1', 'key-abc', { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'sonnet');
      billing.recordTokenUsage('sess-2', 'key-xyz', { inputTokens: 2000, outputTokens: 1000, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'sonnet');
      billing.recordTokenUsage('sess-3', 'key-abc', { inputTokens: 500, outputTokens: 250, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'sonnet');
    });

    it('groups usage by API key', () => {
      const breakdown = billing.getCostByKey();
      expect(breakdown).toHaveLength(2);

      const abcEntry = breakdown.find(b => b.keyId === 'key-abc');
      expect(abcEntry).toBeDefined();
      expect(abcEntry!.totalInputTokens).toBe(1500);
      expect(abcEntry!.sessionCount).toBe(2);

      const xyzEntry = breakdown.find(b => b.keyId === 'key-xyz');
      expect(xyzEntry).toBeDefined();
      expect(xyzEntry!.totalInputTokens).toBe(2000);
      expect(xyzEntry!.sessionCount).toBe(1);
    });

    it('groups sessions without keys under __no_key__', () => {
      billing.recordTokenUsage('sess-nokey', undefined, { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });
      const breakdown = billing.getCostByKey();
      const noKeyEntry = breakdown.find(b => b.keyId === '__no_key__');
      expect(noKeyEntry).toBeDefined();
      expect(noKeyEntry!.totalInputTokens).toBe(100);
    });
  });

  // ── Session lifecycle events ───────────────────────────────────────

  describe('session lifecycle recording', () => {
    it('records session_start events', () => {
      billing.recordSessionStart('sess-1', 'key-1');
      const records = billing.getSessionUsage('sess-1');
      expect(records).toHaveLength(1);
      expect(records[0].eventType).toBe('session_start');
      expect(records[0].costUsd).toBe(0);
    });

    it('records session_end events', () => {
      billing.recordSessionEnd('sess-1', 'key-1');
      const records = billing.getSessionUsage('sess-1');
      expect(records).toHaveLength(1);
      expect(records[0].eventType).toBe('session_end');
      expect(records[0].costUsd).toBe(0);
    });

    it('records tool_call events', () => {
      billing.recordToolCall('sess-1', 'key-1', 'Bash', undefined);
      const records = billing.getSessionUsage('sess-1');
      expect(records).toHaveLength(1);
      expect(records[0].eventType).toBe('tool_call');
      expect(records[0].inputTokens).toBe(0);
      expect(records[0].costUsd).toBe(0);
    });
  });

  // ── Billing event hook (EventEmitter) ──────────────────────────────

  describe('onBillingEvent hook', () => {
    it('emits BillingEvent for every token recording', async () => {
      const received: BillingEvent[] = [];
      billing.onBillingEvent((event) => received.push(event));

      billing.recordTokenUsage('s1', 'k1', { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });
      billing.recordTokenUsage('s2', 'k2', { inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 });

      await flushAsync();

      expect(received).toHaveLength(2);
      expect(received[0].sessionId).toBe('s1');
      expect(received[0].tokens.inputTokens).toBe(100);
      expect(received[1].sessionId).toBe('s2');
      expect(received[1].tokens.inputTokens).toBe(200);
    });

    it('delivers BillingEvent with correct shape', async () => {
      const received: BillingEvent[] = [];
      billing.onBillingEvent((event) => received.push(event));

      billing.recordTokenUsage('s1', 'k1', { inputTokens: 500, outputTokens: 250, cacheCreationTokens: 10, cacheReadTokens: 5 }, 'claude-sonnet-4-20250514');

      await flushAsync();

      expect(received).toHaveLength(1);
      const evt = received[0];
      expect(evt.id).toBe(1);
      expect(evt.sessionId).toBe('s1');
      expect(evt.keyId).toBe('k1');
      expect(evt.eventType).toBe('message');
      expect(evt.tokens).toEqual({ inputTokens: 500, outputTokens: 250, cacheCreationTokens: 10, cacheReadTokens: 5 });
      expect(evt.costUsd).toBeGreaterThan(0);
      expect(evt.model).toBe('claude-sonnet-4-20250514');
    });

    it('unsubscribes when dispose function is called', async () => {
      const received: BillingEvent[] = [];
      const unsub = billing.onBillingEvent((event) => received.push(event));

      billing.recordTokenUsage('s1', 'k1', { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });
      await flushAsync();
      expect(received).toHaveLength(1);

      unsub();

      billing.recordTokenUsage('s2', 'k2', { inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 });
      await flushAsync();
      expect(received).toHaveLength(1); // No new event
    });

    it('continues recording even if a listener throws', async () => {
      billing.onBillingEvent(() => { throw new Error('boom'); });
      const received: BillingEvent[] = [];
      billing.onBillingEvent((event) => received.push(event));

      billing.recordTokenUsage('s1', 'k1', { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });

      await flushAsync();

      expect(billing.recordCount).toBe(1);
      expect(received).toHaveLength(1);
    });

    it('emits events for session lifecycle', async () => {
      const received: BillingEvent[] = [];
      billing.onBillingEvent((event) => received.push(event));

      billing.recordSessionStart('s1', 'k1');
      billing.recordToolCall('s1', 'k1', 'Read', 'sonnet');
      billing.recordSessionEnd('s1', 'k1');

      await flushAsync();

      expect(received).toHaveLength(3);
      expect(received[0].eventType).toBe('session_start');
      expect(received[1].eventType).toBe('tool_call');
      expect(received[2].eventType).toBe('session_end');
    });

    it('supports multiple concurrent listeners', async () => {
      const a: BillingEvent[] = [];
      const b: BillingEvent[] = [];
      billing.onBillingEvent((event) => a.push(event));
      billing.onBillingEvent((event) => b.push(event));

      billing.recordTokenUsage('s1', 'k1', { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });
      await flushAsync();

      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
    });
  });

  // ── Custom rate tiers ──────────────────────────────────────────────

  describe('rate tiers', () => {
    it('returns default tiers', () => {
      const tiers = billing.getRateTiers();
      expect(tiers).toEqual(DEFAULT_RATE_TIERS);
    });

    it('accepts custom rate tiers via constructor', () => {
      const customTiers: RateTier[] = [
        {
          name: 'custom-model',
          inputCostPerM: 5.00,
          outputCostPerM: 25.00,
          cacheWriteCostPerM: 6.25,
          cacheReadCostPerM: 0.50,
          modelPattern: 'custom',
        },
      ];
      const customBilling = new BillingMeteringService(customTiers);

      customBilling.recordTokenUsage('s1', 'k1', { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'custom-v1');
      const records = customBilling.getSessionUsage('s1');
      expect(records[0].costUsd).toBeCloseTo(5.00, 4);
    });

    it('updates rate tiers at runtime', () => {
      billing.setRateTiers([
        {
          name: 'budget',
          inputCostPerM: 1.00,
          outputCostPerM: 5.00,
          cacheWriteCostPerM: 1.25,
          cacheReadCostPerM: 0.10,
          modelPattern: 'budget',
        },
      ]);

      billing.recordTokenUsage('s1', 'k1', { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'budget-v1');
      const records = billing.getSessionUsage('s1');
      expect(records[0].costUsd).toBeCloseTo(1.00, 4);
    });
  });

  // ── Pruning ────────────────────────────────────────────────────────

  describe('pruneOlderThan', () => {
    it('removes records older than the given timestamp', () => {
      billing.recordTokenUsage('s1', 'k1', { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });

      // Our record is from ~now, which is > 2020-01-01, so it survives
      const removed = billing.pruneOlderThan('2020-01-01T00:00:00.000Z');
      expect(removed).toBe(0);
      expect(billing.recordCount).toBe(1);

      // Far-future cutoff removes our record
      const removed2 = billing.pruneOlderThan('2099-01-01T00:00:00.000Z');
      expect(removed2).toBe(1);
      expect(billing.recordCount).toBe(0);
    });
  });
});
