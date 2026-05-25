/**
 * budgets-evaluator-4195.test.ts — BudgetEvaluator tests.
 *
 * Tests window calculation, threshold firing, deduplication,
 * window rollover, and disable/enable behavior.
 * Issue #4195: Cost Alerts — /v1/budgets API backend.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { BudgetStore } from '../budgets/store.js';
import { BudgetEvaluator } from '../budgets/evaluator.js';
import { BudgetNotifier } from '../budgets/notifications.js';
import type { Budget } from '../budgets/types.js';
import type { MeteringService } from '../metering.js';

function tempDir(): string {
  return join(tmpdir(), `aegis-eval-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    name: 'Test',
    keyId: null,
    limitUsd: 100,
    thresholds: [50, 80, 100],
    window: { kind: 'rolling', hours: 24 },
    channels: [{ type: 'log' }],
    enabled: true,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    lastEvaluatedAt: null,
    ...overrides,
  };
}

function makeMeteringService(totalCostUsd: number): MeteringService {
  return {
    getUsageSummary: () => ({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalCostUsd,
      recordCount: 1,
      sessions: 1,
    }),
  } as unknown as MeteringService;
}

describe('BudgetEvaluator.calcWindow()', () => {
  let store: BudgetStore;
  let notifier: BudgetNotifier;
  let stateDir: string;

  beforeEach(() => {
    stateDir = tempDir();
    store = new BudgetStore(stateDir);
    notifier = new BudgetNotifier({});
  });

  afterEach(async () => {
    try { await rm(stateDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('rolling window: windowStart = now - hours', () => {
    const metering = makeMeteringService(0);
    const evaluator = new BudgetEvaluator(store, metering, notifier);
    const budget = makeBudget({ window: { kind: 'rolling', hours: 24 } });
    const now = new Date('2026-05-25T12:00:00.000Z');

    const { windowStart, windowEnd } = evaluator.calcWindow(budget, now);
    expect(windowStart).toBe('2026-05-24T12:00:00.000Z');
    expect(windowEnd).toBe('2026-05-25T12:00:00.000Z');
  });

  it('calendar window (24h): daily reset at midnight UTC', () => {
    const metering = makeMeteringService(0);
    const evaluator = new BudgetEvaluator(store, metering, notifier);
    const budget = makeBudget({ window: { kind: 'calendar', hours: 24 } });
    const now = new Date('2026-05-25T14:30:00.000Z');

    const { windowStart } = evaluator.calcWindow(budget, now);
    expect(windowStart).toBe('2026-05-25T00:00:00.000Z');
  });

  it('calendar window (168h): weekly reset on Monday', () => {
    const metering = makeMeteringService(0);
    const evaluator = new BudgetEvaluator(store, metering, notifier);
    const budget = makeBudget({ window: { kind: 'calendar', hours: 168 } });
    // 2026-05-25 is a Monday
    const now = new Date('2026-05-25T14:00:00.000Z');

    const { windowStart } = evaluator.calcWindow(budget, now);
    expect(windowStart).toBe('2026-05-25T00:00:00.000Z');
  });

  it('calendar window (168h): mid-week aligns to Monday', () => {
    const metering = makeMeteringService(0);
    const evaluator = new BudgetEvaluator(store, metering, notifier);
    const budget = makeBudget({ window: { kind: 'calendar', hours: 168 } });
    // 2026-05-27 is a Wednesday — should reset to Monday 2026-05-25
    const now = new Date('2026-05-27T10:00:00.000Z');

    const { windowStart } = evaluator.calcWindow(budget, now);
    expect(windowStart).toBe('2026-05-25T00:00:00.000Z');
  });

  it('calendar window (720h): monthly reset on 1st', () => {
    const metering = makeMeteringService(0);
    const evaluator = new BudgetEvaluator(store, metering, notifier);
    const budget = makeBudget({ window: { kind: 'calendar', hours: 720 } });
    const now = new Date('2026-05-15T08:00:00.000Z');

    const { windowStart } = evaluator.calcWindow(budget, now);
    expect(windowStart).toBe('2026-05-01T00:00:00.000Z');
  });
});

describe('BudgetEvaluator.evaluate() — threshold firing', () => {
  let stateDir: string;
  let store: BudgetStore;
  let notifier: BudgetNotifier;

  beforeEach(() => {
    stateDir = tempDir();
    store = new BudgetStore(stateDir);
    notifier = new BudgetNotifier({});
  });

  afterEach(async () => {
    try { await rm(stateDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('fires no thresholds when spend is below all', async () => {
    const metering = makeMeteringService(10); // 10% of 100
    const evaluator = new BudgetEvaluator(store, metering, notifier);
    const budget = makeBudget({ id: 'b1' });

    const result = await evaluator.evaluate(budget);
    expect(result.percentUsed).toBe(10);
    expect(result.triggeredThresholds).toHaveLength(0);
    expect(result.alertsSent).toBe(0);
  });

  it('fires a threshold when spend crosses it', async () => {
    const metering = makeMeteringService(55); // 55% of 100
    const evaluator = new BudgetEvaluator(store, metering, notifier);
    const budget = makeBudget({ id: 'b2' });

    const result = await evaluator.evaluate(budget);
    expect(result.triggeredThresholds).toContain(50);
    expect(result.alertsSent).toBe(1); // 1 channel × 1 threshold
  });

  it('fires multiple thresholds in one evaluation', async () => {
    const metering = makeMeteringService(90); // 90%
    const evaluator = new BudgetEvaluator(store, metering, notifier);
    const budget = makeBudget({ id: 'b3' });

    const result = await evaluator.evaluate(budget);
    expect(result.triggeredThresholds).toContain(50);
    expect(result.triggeredThresholds).toContain(80);
    expect(result.triggeredThresholds).not.toContain(100);
  });

  it('fires 100% threshold on breach', async () => {
    const metering = makeMeteringService(100);
    const evaluator = new BudgetEvaluator(store, metering, notifier);
    const budget = makeBudget({ id: 'b4' });

    const result = await evaluator.evaluate(budget);
    expect(result.triggeredThresholds).toContain(100);
  });
});

describe('BudgetEvaluator.evaluate() — deduplication', () => {
  let stateDir: string;
  let store: BudgetStore;
  let notifier: BudgetNotifier;

  beforeEach(() => {
    stateDir = tempDir();
    store = new BudgetStore(stateDir);
    notifier = new BudgetNotifier({});
  });

  afterEach(async () => {
    try { await rm(stateDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('does not fire same threshold twice in same window', async () => {
    const metering = makeMeteringService(55); // 55%
    const evaluator = new BudgetEvaluator(store, metering, notifier);
    const budget = makeBudget({ id: 'b-dedup' });

    // First evaluation — fires 50%
    const first = await evaluator.evaluate(budget);
    expect(first.triggeredThresholds).toContain(50);

    // Second evaluation with same spend — should NOT re-fire 50%
    const second = await evaluator.evaluate(budget);
    expect(second.triggeredThresholds).toHaveLength(0);
    expect(second.alertsSent).toBe(0);
  });

  it('resets fired thresholds on window rollover', async () => {
    const budget = makeBudget({ id: 'b-rollover', window: { kind: 'rolling', hours: 1 } });

    // First evaluation with fixed time T1
    const t1 = new Date('2026-05-25T10:00:00.000Z');
    const metering1 = makeMeteringService(55);
    const evaluator1 = new BudgetEvaluator(store, metering1, notifier);
    vi.spyOn(evaluator1, 'calcWindow').mockReturnValue({
      windowStart: '2026-05-25T09:00:00.000Z',
      windowEnd: t1.toISOString(),
    });
    const r1 = await evaluator1.evaluate(budget);
    expect(r1.triggeredThresholds).toContain(50);

    // Second evaluation in new window (different windowStart)
    const metering2 = makeMeteringService(55);
    const evaluator2 = new BudgetEvaluator(store, metering2, notifier);
    vi.spyOn(evaluator2, 'calcWindow').mockReturnValue({
      windowStart: '2026-05-25T10:30:00.000Z', // new window
      windowEnd: '2026-05-25T11:30:00.000Z',
    });
    const r2 = await evaluator2.evaluate(budget);
    expect(r2.triggeredThresholds).toContain(50); // fires again in new window
  });
});

describe('BudgetEvaluator.evaluateAll()', () => {
  let stateDir: string;
  let store: BudgetStore;
  let notifier: BudgetNotifier;

  beforeEach(() => {
    stateDir = tempDir();
    store = new BudgetStore(stateDir);
    notifier = new BudgetNotifier({});
  });

  afterEach(async () => {
    try { await rm(stateDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('evaluates only enabled budgets', async () => {
    await store.createBudget({
      name: 'Active', keyId: null, limitUsd: 100,
      thresholds: [50], window: { kind: 'rolling', hours: 24 },
      channels: [{ type: 'log' }], enabled: true,
    });
    await store.createBudget({
      name: 'Disabled', keyId: null, limitUsd: 100,
      thresholds: [50], window: { kind: 'rolling', hours: 24 },
      channels: [{ type: 'log' }], enabled: false,
    });

    const evaluateSpy = vi.fn().mockResolvedValue({
      budgetId: 'x', windowStart: '', windowEnd: '', currentSpendUsd: 0,
      limitUsd: 100, percentUsed: 0, triggeredThresholds: [], alertsSent: 0,
    });
    const metering = makeMeteringService(0);
    const evaluator = new BudgetEvaluator(store, metering, notifier);
    vi.spyOn(evaluator, 'evaluate').mockImplementation(evaluateSpy);

    await evaluator.evaluateAll();
    expect(evaluateSpy).toHaveBeenCalledOnce();
  });

  it('continues evaluating remaining budgets when one fails', async () => {
    const b1 = await store.createBudget({
      name: 'B1', keyId: null, limitUsd: 100,
      thresholds: [50], window: { kind: 'rolling', hours: 24 },
      channels: [{ type: 'log' }], enabled: true,
    });
    await store.createBudget({
      name: 'B2', keyId: null, limitUsd: 100,
      thresholds: [50], window: { kind: 'rolling', hours: 24 },
      channels: [{ type: 'log' }], enabled: true,
    });

    const metering = makeMeteringService(0);
    const evaluator = new BudgetEvaluator(store, metering, notifier);
    let callCount = 0;
    vi.spyOn(evaluator, 'evaluate').mockImplementation(async (budget: Budget) => {
      callCount++;
      if (budget.id === b1.id) throw new Error('simulated failure');
      return {
        budgetId: budget.id, windowStart: '', windowEnd: '', currentSpendUsd: 0,
        limitUsd: 100, percentUsed: 0, triggeredThresholds: [], alertsSent: 0,
      };
    });

    await expect(evaluator.evaluateAll()).resolves.not.toThrow();
    expect(callCount).toBe(2);
  });
});

describe('BudgetEvaluator — keyId scoping', () => {
  let stateDir: string;
  let store: BudgetStore;
  let notifier: BudgetNotifier;

  beforeEach(() => {
    stateDir = tempDir();
    store = new BudgetStore(stateDir);
    notifier = new BudgetNotifier({});
  });

  afterEach(async () => {
    try { await rm(stateDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('passes keyId to metering when budget is scoped', async () => {
    const getUsageSummary = vi.fn().mockReturnValue({
      totalCostUsd: 60, totalInputTokens: 0, totalOutputTokens: 0,
      totalCacheCreationTokens: 0, totalCacheReadTokens: 0, recordCount: 1, sessions: 1,
    });
    const metering = { getUsageSummary } as unknown as MeteringService;
    const evaluator = new BudgetEvaluator(store, metering, notifier);
    const budget = makeBudget({ id: 'b-scoped', keyId: 'key-xyz' });

    await evaluator.evaluate(budget);

    expect(getUsageSummary).toHaveBeenCalledWith(
      expect.objectContaining({ keyId: 'key-xyz' }),
    );
  });

  it('does not pass keyId to metering for global budget', async () => {
    const getUsageSummary = vi.fn().mockReturnValue({
      totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0,
      totalCacheCreationTokens: 0, totalCacheReadTokens: 0, recordCount: 0, sessions: 0,
    });
    const metering = { getUsageSummary } as unknown as MeteringService;
    const evaluator = new BudgetEvaluator(store, metering, notifier);
    const budget = makeBudget({ id: 'b-global', keyId: null });

    await evaluator.evaluate(budget);

    const callArg = getUsageSummary.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('keyId');
  });
});
