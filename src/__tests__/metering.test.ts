/**
 * metering.test.ts — Unit tests for MeteringService.
 *
 * Issue #1954: Billing/metering hooks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MeteringService, DEFAULT_RATE_TIERS, type RateTier, type UsageRecord } from '../metering.js';
import { SessionEventBus } from '../events.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function flushAsync(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('MeteringService', () => {
  let eventBus: SessionEventBus;
  let metering: MeteringService;
  let dataFile: string;
  let tmpDir: string;
  const ownerMap = new Map<string, string>();

  beforeEach(async () => {
    eventBus = new SessionEventBus();
    tmpDir = join(tmpdir(), `metering-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dataFile = join(tmpDir, 'metering.json');
    await mkdir(tmpDir, { recursive: true });
    ownerMap.clear();
    metering = new MeteringService(
      eventBus,
      (sessionId: string) => ownerMap.get(sessionId),
      dataFile,
    );
  });

  afterEach(async () => {
    metering.stop();
    eventBus.destroy();
    try { await rm(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  // ── Token usage recording ──────────────────────────────────────────

  describe('recordTokenUsage', () => {
    it('records token usage delta for a session', () => {
      ownerMap.set('sess-1', 'key-abc');
      metering.recordTokenUsage('sess-1', {
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 200,
        cacheReadTokens: 100,
      }, 'claude-sonnet-4-20250514');

      expect(metering.recordCount).toBe(1);
      const records = metering.getSessionUsage('sess-1');
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
      metering.recordTokenUsage('sess-1', {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      });
      expect(metering.recordCount).toBe(0);
    });

    it('assigns incrementing IDs', () => {
      ownerMap.set('sess-1', 'key-1');
      metering.recordTokenUsage('sess-1', { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });
      metering.recordTokenUsage('sess-1', { inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 });
      metering.recordTokenUsage('sess-1', { inputTokens: 300, outputTokens: 150, cacheCreationTokens: 0, cacheReadTokens: 0 });

      const records = metering.getSessionUsage('sess-1');
      expect(records[0].id).toBe(1);
      expect(records[1].id).toBe(2);
      expect(records[2].id).toBe(3);
    });

    it('handles sessions without an owner key', () => {
      metering.recordTokenUsage('sess-nokey', {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      });
      const records = metering.getSessionUsage('sess-nokey');
      expect(records[0].keyId).toBeUndefined();
    });
  });

  // ── Cost estimation by model ───────────────────────────────────────

  describe('cost estimation', () => {
    it('uses haiku pricing for haiku models', () => {
      metering.recordTokenUsage('s1', { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'claude-haiku-4-20250514');
      const records = metering.getSessionUsage('s1');
      expect(records[0].costUsd).toBeCloseTo(0.80, 4);
    });

    it('uses sonnet pricing for sonnet models', () => {
      metering.recordTokenUsage('s1', { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'claude-sonnet-4-20250514');
      const records = metering.getSessionUsage('s1');
      expect(records[0].costUsd).toBeCloseTo(3.00, 4);
    });

    it('uses opus pricing for opus models', () => {
      metering.recordTokenUsage('s1', { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'claude-opus-4-20250514');
      const records = metering.getSessionUsage('s1');
      expect(records[0].costUsd).toBeCloseTo(15.00, 4);
    });

    it('defaults to sonnet pricing when model is unknown', () => {
      metering.recordTokenUsage('s1', { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'gpt-4o');
      const records = metering.getSessionUsage('s1');
      expect(records[0].costUsd).toBeCloseTo(3.00, 4);
    });

    it('defaults to sonnet pricing when no model is specified', () => {
      metering.recordTokenUsage('s1', { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 });
      const records = metering.getSessionUsage('s1');
      expect(records[0].costUsd).toBeCloseTo(3.00, 4);
    });

    it('calculates multi-token-type costs correctly', () => {
      metering.recordTokenUsage('s1', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
      }, 'claude-sonnet-4-20250514');
      const records = metering.getSessionUsage('s1');
      // sonnet: input=3, output=15, cacheWrite=3.75, cacheRead=0.30 per M
      expect(records[0].costUsd).toBeCloseTo(3.00 + 15.00 + 3.75 + 0.30, 4);
    });
  });

  // ── Aggregation queries ────────────────────────────────────────────

  describe('getUsageSummary', () => {
    beforeEach(() => {
      ownerMap.set('sess-1', 'key-abc');
      ownerMap.set('sess-2', 'key-xyz');
      metering.recordTokenUsage('sess-1', { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 100, cacheReadTokens: 50 }, 'sonnet');
      metering.recordTokenUsage('sess-2', { inputTokens: 2000, outputTokens: 1000, cacheCreationTokens: 200, cacheReadTokens: 100 }, 'opus');
    });

    it('returns total usage across all sessions', () => {
      const summary = metering.getUsageSummary();
      expect(summary.totalInputTokens).toBe(3000);
      expect(summary.totalOutputTokens).toBe(1500);
      expect(summary.totalCacheCreationTokens).toBe(300);
      expect(summary.totalCacheReadTokens).toBe(150);
      expect(summary.recordCount).toBe(2);
      expect(summary.sessions).toBe(2);
      expect(summary.totalCostUsd).toBeGreaterThan(0);
    });

    it('filters by keyId', () => {
      const summary = metering.getUsageSummary({ keyId: 'key-abc' });
      expect(summary.totalInputTokens).toBe(1000);
      expect(summary.sessions).toBe(1);
    });

    it('filters by sessionId', () => {
      const summary = metering.getUsageSummary({ sessionId: 'sess-2' });
      expect(summary.totalInputTokens).toBe(2000);
      expect(summary.sessions).toBe(1);
    });

    it('filters by time range', () => {
      // Get all records and find the timestamp of the first one
      const records = metering.getSessionUsage('sess-1');
      const ts = records[0].timestamp;
      // Filter to after the first record's timestamp
      const after = ts.replace(/\d$/, '9'); // Tweak last digit
      const summary = metering.getUsageSummary({ from: after });
      // Should include sess-2 which was recorded after sess-1
      expect(summary.recordCount).toBeGreaterThanOrEqual(1);
    });

    it('returns zero usage when no records match filter', () => {
      const summary = metering.getUsageSummary({ keyId: 'nonexistent' });
      expect(summary.totalInputTokens).toBe(0);
      expect(summary.recordCount).toBe(0);
      expect(summary.sessions).toBe(0);
    });
  });

  // ── Per-key breakdown ──────────────────────────────────────────────

  describe('getUsageByKey', () => {
    beforeEach(() => {
      ownerMap.set('sess-1', 'key-abc');
      ownerMap.set('sess-2', 'key-xyz');
      ownerMap.set('sess-3', 'key-abc');
      metering.recordTokenUsage('sess-1', { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'sonnet');
      metering.recordTokenUsage('sess-2', { inputTokens: 2000, outputTokens: 1000, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'sonnet');
      metering.recordTokenUsage('sess-3', { inputTokens: 500, outputTokens: 250, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'sonnet');
    });

    it('groups usage by API key', () => {
      const breakdown = metering.getUsageByKey();
      expect(breakdown).toHaveLength(2);

      const abcEntry = breakdown.find(b => b.keyId === 'key-abc');
      expect(abcEntry).toBeDefined();
      expect(abcEntry!.usage.totalInputTokens).toBe(1500);
      expect(abcEntry!.usage.sessions).toBe(2);

      const xyzEntry = breakdown.find(b => b.keyId === 'key-xyz');
      expect(xyzEntry).toBeDefined();
      expect(xyzEntry!.usage.totalInputTokens).toBe(2000);
      expect(xyzEntry!.usage.sessions).toBe(1);
    });

    it('groups sessions without keys under __no_key__', () => {
      metering.recordTokenUsage('sess-nokey', { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });
      const breakdown = metering.getUsageByKey();
      const noKeyEntry = breakdown.find(b => b.keyId === '__no_key__');
      expect(noKeyEntry).toBeDefined();
      expect(noKeyEntry!.usage.totalInputTokens).toBe(100);
    });
  });

  // ── Per-session usage ──────────────────────────────────────────────

  describe('getSessionUsage', () => {
    it('returns records for a specific session', () => {
      ownerMap.set('sess-1', 'key-1');
      metering.recordTokenUsage('sess-1', { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });
      metering.recordTokenUsage('sess-2', { inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 });

      const records = metering.getSessionUsage('sess-1');
      expect(records).toHaveLength(1);
      expect(records[0].sessionId).toBe('sess-1');
    });
  });

  // ── Custom rate tiers ──────────────────────────────────────────────

  describe('rate tiers', () => {
    it('returns default tiers', () => {
      const tiers = metering.getRateTiers();
      expect(tiers).toEqual(DEFAULT_RATE_TIERS);
    });

    it('accepts custom rate tiers', () => {
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
      const customMetering = new MeteringService(
        eventBus,
        () => undefined,
        join(tmpDir, 'custom-metering.json'),
        customTiers,
      );

      customMetering.recordTokenUsage('s1', { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'custom-v1');
      const records = customMetering.getSessionUsage('s1');
      expect(records[0].costUsd).toBeCloseTo(5.00, 4);
    });

    it('updates rate tiers at runtime', () => {
      metering.setRateTiers([
        {
          name: 'budget',
          inputCostPerM: 1.00,
          outputCostPerM: 5.00,
          cacheWriteCostPerM: 1.25,
          cacheReadCostPerM: 0.10,
          modelPattern: 'budget',
        },
      ]);

      metering.recordTokenUsage('s1', { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'budget-v1');
      const records = metering.getSessionUsage('s1');
      expect(records[0].costUsd).toBeCloseTo(1.00, 4);
    });
  });

  // ── Event subscription ─────────────────────────────────────────────

  describe('event-driven recording', () => {
    it('records session_start and session_end from global events', async () => {
      metering.start();

      ownerMap.set('sess-1', 'key-1');
      // Simulate a session_created global event
      eventBus.emitCreated('sess-1', 'test-session', '/tmp/work');

      await flushAsync();

      // Session_created doesn't produce token records, but creates a record
      expect(metering.recordCount).toBe(1);
      const startRecords = metering.getSessionUsage('sess-1');
      expect(startRecords[0].eventType).toBe('session_start');
    });
  });

  // ── Persistence ────────────────────────────────────────────────────

  describe('persistence', () => {
    it('saves and loads records from disk', async () => {
      ownerMap.set('sess-1', 'key-1');
      metering.recordTokenUsage('sess-1', { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 }, 'sonnet');

      await metering.save();

      // Create a new service instance and load
      const metering2 = new MeteringService(
        eventBus,
        (sessionId: string) => ownerMap.get(sessionId),
        dataFile,
      );
      await metering2.load();

      expect(metering2.recordCount).toBe(1);
      const records = metering2.getSessionUsage('sess-1');
      expect(records[0].inputTokens).toBe(1000);
      expect(records[0].outputTokens).toBe(500);
    });

    it('starts fresh when file does not exist', async () => {
      const fresh = new MeteringService(
        eventBus,
        () => undefined,
        join(tmpDir, 'nonexistent.json'),
      );
      await fresh.load();
      expect(fresh.recordCount).toBe(0);
    });

    it('starts fresh when file is corrupt', async () => {
      await writeFile(dataFile, 'not valid json', 'utf-8');
      const fresh = new MeteringService(
        eventBus,
        () => undefined,
        dataFile,
      );
      await fresh.load();
      expect(fresh.recordCount).toBe(0);
    });
  });

  // ── Usage callback (billing integration) ───────────────────────────

  describe('onUsage callback', () => {
    it('notifies registered callbacks on each record', () => {
      const received: UsageRecord[] = [];
      metering.onUsage((record) => received.push(record));

      metering.recordTokenUsage('s1', { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });
      metering.recordTokenUsage('s2', { inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 });

      expect(received).toHaveLength(2);
      expect(received[0].sessionId).toBe('s1');
      expect(received[1].sessionId).toBe('s2');
    });

    it('unsubscribes when dispose function is called', () => {
      const received: UsageRecord[] = [];
      const unsub = metering.onUsage((record) => received.push(record));

      metering.recordTokenUsage('s1', { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });
      expect(received).toHaveLength(1);

      unsub();

      metering.recordTokenUsage('s2', { inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 });
      expect(received).toHaveLength(1); // No new record
    });

    it('continues recording even if a callback throws', () => {
      metering.onUsage(() => { throw new Error('boom'); });
      const received: UsageRecord[] = [];
      metering.onUsage((record) => received.push(record));

      metering.recordTokenUsage('s1', { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });

      expect(metering.recordCount).toBe(1);
      expect(received).toHaveLength(1);
    });
  });

  // ── Pruning ────────────────────────────────────────────────────────

  describe('pruneOlderThan', () => {
    it('removes records older than the given timestamp', () => {
      ownerMap.set('s1', 'k1');
      metering.recordTokenUsage('s1', { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });

      // Prune with a timestamp in the past — should remove the record (it's newer than the past cutoff)
      const pastTs = '2020-01-01T00:00:00.000Z';
      const removed = metering.pruneOlderThan(pastTs);
      // Our record is from ~now, which is > 2020-01-01, so it survives
      expect(removed).toBe(0);
      expect(metering.recordCount).toBe(1);

      // Prune with a far-future timestamp — our record is older than the cutoff, so it gets removed
      const removed2 = metering.pruneOlderThan('2099-01-01T00:00:00.000Z');
      expect(removed2).toBe(1);
      expect(metering.recordCount).toBe(0);
    });
  });

  // ── Tool call recording ────────────────────────────────────────────

  describe('recordToolCall', () => {
    it('records a tool_call event type', () => {
      ownerMap.set('sess-1', 'key-1');
      metering.recordToolCall('sess-1', 'Bash', undefined);

      const records = metering.getSessionUsage('sess-1');
      expect(records).toHaveLength(1);
      expect(records[0].eventType).toBe('tool_call');
      expect(records[0].inputTokens).toBe(0);
      expect(records[0].costUsd).toBe(0);
    });
  });

  // ── Auto-prune (Issue #2453) ─────────────────────────────────────────

  describe('auto-prune', () => {
    it('prunes records older than maxAgeMs on load', async () => {
      const now = Date.now();
      const oldRecord: UsageRecord = {
        id: 1, sessionId: 's-old', keyId: undefined,
        timestamp: new Date(now - 60_000).toISOString(), eventType: 'message',
        inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0,
        costUsd: 0, model: undefined,
      };
      const recentRecord: UsageRecord = {
        id: 2, sessionId: 's-new', keyId: undefined,
        timestamp: new Date(now).toISOString(), eventType: 'message',
        inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0,
        costUsd: 0, model: undefined,
      };
      await writeFile(dataFile, JSON.stringify({
        schemaVersion: 1,
        records: [oldRecord, recentRecord],
        nextId: 3,
      }), 'utf-8');

      // maxAgeMs=30s: the 60s-old record should be pruned, the recent one kept
      const svc = new MeteringService(
        eventBus, () => undefined, dataFile, undefined, { maxAgeMs: 30_000 },
      );
      await svc.load();
      expect(svc.recordCount).toBe(1);
      const records = svc.getSessionUsage('s-new');
      expect(records).toHaveLength(1);
    });

    it('evicts oldest records when maxRecords is exceeded', () => {
      const svc = new MeteringService(
        eventBus, () => undefined, join(tmpDir, 'cap.json'), undefined, { maxRecords: 3, maxAgeMs: 0 },
      );

      // Add 5 records
      for (let i = 0; i < 5; i++) {
        svc.recordTokenUsage(`s-${i}`, { inputTokens: 100 + i, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 });
      }

      // Should only keep last 3
      expect(svc.recordCount).toBe(3);
      const summary = svc.getUsageSummary();
      // The oldest 2 (inputTokens 100, 101) are evicted; remaining: 102, 103, 104
      expect(summary.totalInputTokens).toBe(102 + 103 + 104);
    });

    it('starts and stops the periodic prune timer', () => {
      vi.useFakeTimers();
      const svc = new MeteringService(
        eventBus, () => undefined, join(tmpDir, 'timer.json'), undefined, { maxAgeMs: 1_000 },
      );

      // Add a record that will age out
      svc.recordTokenUsage('s1', { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });
      expect(svc.recordCount).toBe(1);

      svc.start();

      // Advance past maxAgeMs + 1 hour (timer interval)
      vi.advanceTimersByTime(60 * 60 * 1000 + 2000);

      // Record should have been pruned by the timer
      expect(svc.recordCount).toBe(0);

      svc.stop();
      vi.useRealTimers();
    });

    it('stop() clears the prune timer', () => {
      vi.useFakeTimers();
      const svc = new MeteringService(
        eventBus, () => undefined, join(tmpDir, 'stop-timer.json'), undefined, { maxAgeMs: 1_000 },
      );
      svc.start();
      svc.stop();

      // Add a record, advance — should NOT be pruned since timer was cleared
      svc.recordTokenUsage('s1', { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });
      vi.advanceTimersByTime(60 * 60 * 1000 + 2000);
      expect(svc.recordCount).toBe(1);

      vi.useRealTimers();
    });

    it('does not prune when maxAgeMs is 0', () => {
      const svc = new MeteringService(
        eventBus, () => undefined, join(tmpDir, 'no-age.json'), undefined, { maxAgeMs: 0, maxRecords: 0 },
      );
      // Simulate an old record by direct manipulation (via load)
      // With maxAgeMs=0, nothing should be pruned on time basis
      for (let i = 0; i < 10; i++) {
        svc.recordTokenUsage(`s-${i}`, { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 });
      }
      expect(svc.recordCount).toBe(10);
    });
  });
});
