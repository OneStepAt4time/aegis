/**
 * budgets-4195.test.ts — Budget CRUD, validation, evaluation, threshold
 * firing, and deduplication tests.
 *
 * Issue #4195: Cost Alerts — /v1/budgets API backend.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ApiKeyRole } from '../services/auth/index.js';

import { BudgetStore } from '../budgets/store.js';
import { BudgetEvaluator } from '../budgets/evaluator.js';
import { BudgetNotifier } from '../budgets/notifications.js';
import { registerBudgetRoutes } from '../budgets/routes.js';
import type { Budget } from '../budgets/types.js';
import type { MeteringService } from '../metering.js';
import type { AuthManager } from '../services/auth/index.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function tempDir(): string {
  return join(tmpdir(), `aegis-budgets-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function makeBudgetData(
  overrides: Partial<Omit<Budget, 'id' | 'createdAt' | 'updatedAt' | 'lastEvaluatedAt'>> = {},
): Omit<Budget, 'id' | 'createdAt' | 'updatedAt' | 'lastEvaluatedAt'> {
  return {
    name: 'Test Budget',
    keyId: null,
    limitUsd: 100,
    thresholds: [50, 80, 100],
    window: { kind: 'rolling', hours: 24 },
    channels: [{ type: 'log' }],
    enabled: true,
    ...overrides,
  };
}

function makeMockAuth(): AuthManager {
  return {
    authEnabled: false,
    validate: vi.fn(),
    getRole: vi.fn(),
  } as unknown as AuthManager;
}

function makeMockMetering(totalCostUsd = 0): MeteringService {
  return {
    getUsageSummary: vi.fn().mockReturnValue({ totalCostUsd }),
  } as unknown as MeteringService;
}

async function buildApp(
  store: BudgetStore,
  evaluator: BudgetEvaluator,
  auth = makeMockAuth(),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Decorate request with auth fields (no-auth mode)
  app.decorateRequest('authKeyId', null as string | null);
  app.decorateRequest('authRole', null as ApiKeyRole | null);
  app.decorateRequest('tenantId', undefined as string | undefined);

  registerBudgetRoutes(app, { auth, budgetStore: store, budgetEvaluator: evaluator });

  await app.ready();
  return app;
}

// ── BudgetEvaluator — window calculation ─────────────────────────────────────

describe('BudgetEvaluator.calcWindow', () => {
  let store: BudgetStore;
  let evaluator: BudgetEvaluator;
  let stateDir: string;

  beforeEach(() => {
    stateDir = tempDir();
    store = new BudgetStore(stateDir);
    const metering = makeMockMetering();
    const notifier = new BudgetNotifier({});
    evaluator = new BudgetEvaluator(store, metering, notifier);
  });

  afterEach(async () => {
    try { await rm(stateDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('rolling window: windowStart = now - hours', () => {
    const now = new Date('2026-05-25T12:00:00.000Z');
    const budget = { ...makeBudgetData({ window: { kind: 'rolling', hours: 24 } }), id: 'b1', createdAt: '', updatedAt: '', lastEvaluatedAt: null } as Budget;
    const { windowStart, windowEnd } = evaluator.calcWindow(budget, now);
    expect(windowEnd).toBe('2026-05-25T12:00:00.000Z');
    expect(windowStart).toBe('2026-05-24T12:00:00.000Z');
  });

  it('calendar window (daily): aligns to midnight UTC', () => {
    const now = new Date('2026-05-25T15:30:00.000Z');
    const budget = { ...makeBudgetData({ window: { kind: 'calendar', hours: 24 } }), id: 'b2', createdAt: '', updatedAt: '', lastEvaluatedAt: null } as Budget;
    const { windowStart } = evaluator.calcWindow(budget, now);
    expect(windowStart).toBe('2026-05-25T00:00:00.000Z');
  });

  it('calendar window (weekly): aligns to Monday midnight UTC', () => {
    // 2026-05-25 is a Monday
    const now = new Date('2026-05-27T10:00:00.000Z'); // Wednesday
    const budget = { ...makeBudgetData({ window: { kind: 'calendar', hours: 168 } }), id: 'b3', createdAt: '', updatedAt: '', lastEvaluatedAt: null } as Budget;
    const { windowStart } = evaluator.calcWindow(budget, now);
    expect(windowStart).toBe('2026-05-25T00:00:00.000Z');
  });

  it('calendar window (monthly): aligns to 1st of month', () => {
    const now = new Date('2026-05-25T10:00:00.000Z');
    const budget = { ...makeBudgetData({ window: { kind: 'calendar', hours: 720 } }), id: 'b4', createdAt: '', updatedAt: '', lastEvaluatedAt: null } as Budget;
    const { windowStart } = evaluator.calcWindow(budget, now);
    expect(windowStart).toBe('2026-05-01T00:00:00.000Z');
  });
});

// ── BudgetEvaluator — threshold firing & deduplication ───────────────────────

describe('BudgetEvaluator.evaluate', () => {
  let stateDir: string;
  let store: BudgetStore;
  let mockMetering: { getUsageSummary: ReturnType<typeof vi.fn> };
  let mockSendAlert: any;
  let notifier: BudgetNotifier;
  let evaluator: BudgetEvaluator;

  beforeEach(() => {
    stateDir = tempDir();
    store = new BudgetStore(stateDir);
    mockMetering = { getUsageSummary: vi.fn().mockReturnValue({ totalCostUsd: 0 }) };
    mockSendAlert = vi.fn().mockResolvedValue(undefined);
    notifier = new BudgetNotifier({});
    vi.spyOn(notifier, 'sendAlert' as keyof BudgetNotifier).mockImplementation(mockSendAlert as any);
    evaluator = new BudgetEvaluator(store, mockMetering as unknown as MeteringService, notifier);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try { await rm(stateDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('no thresholds fire when spend is zero', async () => {
    mockMetering.getUsageSummary.mockReturnValue({ totalCostUsd: 0 });
    const budget = await store.createBudget(makeBudgetData({ thresholds: [50, 80, 100] }));

    const result = await evaluator.evaluate(budget);

    expect(result.triggeredThresholds).toHaveLength(0);
    expect(result.alertsSent).toBe(0);
    expect(mockSendAlert).not.toHaveBeenCalled();
  });

  it('fires threshold when percentUsed meets it', async () => {
    // $60 of $100 limit = 60% → fires 50% threshold
    mockMetering.getUsageSummary.mockReturnValue({ totalCostUsd: 60 });
    const budget = await store.createBudget(makeBudgetData({ limitUsd: 100, thresholds: [50, 80, 100] }));

    const result = await evaluator.evaluate(budget);

    expect(result.percentUsed).toBe(60);
    expect(result.triggeredThresholds).toEqual([50]);
    expect(result.alertsSent).toBe(1);
    expect(mockSendAlert).toHaveBeenCalledOnce();
    const [alertPayload] = mockSendAlert.mock.calls[0];
    expect(alertPayload.threshold).toBe(50);
    expect(alertPayload.currentSpendUsd).toBe(60);
  });

  it('fires multiple thresholds in one evaluation', async () => {
    // $85 of $100 = 85% → fires 50% and 80%
    mockMetering.getUsageSummary.mockReturnValue({ totalCostUsd: 85 });
    const budget = await store.createBudget(makeBudgetData({ limitUsd: 100, thresholds: [50, 80, 100] }));

    const result = await evaluator.evaluate(budget);

    expect(result.triggeredThresholds).toEqual([50, 80]);
    expect(result.alertsSent).toBe(2);
  });

  it('deduplication: same threshold does not fire twice in same window', async () => {
    mockMetering.getUsageSummary.mockReturnValue({ totalCostUsd: 60 });
    const budget = await store.createBudget(makeBudgetData({ limitUsd: 100, thresholds: [50] }));

    // First evaluation — fires threshold
    const first = await evaluator.evaluate(budget);
    expect(first.triggeredThresholds).toEqual([50]);

    // Second evaluation with same spend — must NOT fire again
    const second = await evaluator.evaluate(budget);
    expect(second.triggeredThresholds).toHaveLength(0);
    expect(mockSendAlert).toHaveBeenCalledTimes(1);
  });

  it('thresholds reset on new window (window rollover)', async () => {
    mockMetering.getUsageSummary.mockReturnValue({ totalCostUsd: 60 });
    const budget = await store.createBudget(makeBudgetData({ limitUsd: 100, thresholds: [50], window: { kind: 'rolling', hours: 1 } }));

    // First eval — fires 50%
    await evaluator.evaluate(budget);
    expect(mockSendAlert).toHaveBeenCalledTimes(1);

    // Manually set the stored eval state to a different windowStart to simulate rollover
    await store.setEvalState(budget.id, {
      windowStart: '2020-01-01T00:00:00.000Z',
      firedThresholds: [50],
      lastAlertAt: '2020-01-01T01:00:00.000Z',
    });

    // Second eval — new window, should fire again
    mockSendAlert.mockClear();
    const freshBudget = await store.getBudget(budget.id);
    const second = await evaluator.evaluate(freshBudget!);
    expect(second.triggeredThresholds).toEqual([50]);
    expect(mockSendAlert).toHaveBeenCalledTimes(1);
  });

  it('returns correct percentUsed and spend values', async () => {
    mockMetering.getUsageSummary.mockReturnValue({ totalCostUsd: 25 });
    const budget = await store.createBudget(makeBudgetData({ limitUsd: 100, thresholds: [50] }));

    const result = await evaluator.evaluate(budget);

    expect(result.currentSpendUsd).toBe(25);
    expect(result.limitUsd).toBe(100);
    expect(result.percentUsed).toBe(25);
    expect(result.budgetId).toBe(budget.id);
  });

  it('does not fire thresholds when budget spend exactly meets limit (100%)', async () => {
    mockMetering.getUsageSummary.mockReturnValue({ totalCostUsd: 100 });
    const budget = await store.createBudget(makeBudgetData({ limitUsd: 100, thresholds: [100] }));

    const result = await evaluator.evaluate(budget);
    expect(result.triggeredThresholds).toEqual([100]);
    expect(result.alertsSent).toBe(1);
  });

  it('touches lastEvaluatedAt on budget after evaluation', async () => {
    mockMetering.getUsageSummary.mockReturnValue({ totalCostUsd: 0 });
    const budget = await store.createBudget(makeBudgetData());
    expect(budget.lastEvaluatedAt).toBeNull();

    await evaluator.evaluate(budget);

    const updated = await store.getBudget(budget.id);
    expect(updated?.lastEvaluatedAt).toBeTruthy();
  });

  it('evaluateAll skips disabled budgets', async () => {
    mockMetering.getUsageSummary.mockReturnValue({ totalCostUsd: 100 });
    await store.createBudget(makeBudgetData({ name: 'Disabled', enabled: false, thresholds: [50] }));

    await evaluator.evaluateAll();

    expect(mockSendAlert).not.toHaveBeenCalled();
  });

  it('evaluateAll evaluates all enabled budgets', async () => {
    mockMetering.getUsageSummary.mockReturnValue({ totalCostUsd: 60 });
    await store.createBudget(makeBudgetData({ name: 'A', thresholds: [50] }));
    await store.createBudget(makeBudgetData({ name: 'B', thresholds: [50] }));
    await store.createBudget(makeBudgetData({ name: 'Disabled', enabled: false, thresholds: [50] }));

    await evaluator.evaluateAll();

    // 2 enabled budgets × 1 channel each
    expect(mockSendAlert).toHaveBeenCalledTimes(2);
  });
});

// ── Budget Routes ─────────────────────────────────────────────────────────────

describe('Budget Routes', () => {
  let stateDir: string;
  let store: BudgetStore;
  let evaluator: BudgetEvaluator;
  let app: FastifyInstance;

  beforeEach(async () => {
    stateDir = tempDir();
    store = new BudgetStore(stateDir);
    const metering = makeMockMetering();
    const notifier = new BudgetNotifier({});
    evaluator = new BudgetEvaluator(store, metering, notifier);
    app = await buildApp(store, evaluator);
  });

  afterEach(async () => {
    await app.close();
    try { await rm(stateDir, { recursive: true }); } catch { /* ignore */ }
  });

  // ── POST /v1/budgets ──────────────────────────────────────────────

  it('POST /v1/budgets creates a budget', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/budgets',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'My Budget',
        keyId: null,
        limitUsd: 50,
        thresholds: [80, 100],
        window: { kind: 'rolling', hours: 24 },
        channels: [{ type: 'log' }],
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { budget: Budget };
    expect(body.budget.name).toBe('My Budget');
    expect(body.budget.limitUsd).toBe(50);
    expect(body.budget.thresholds).toEqual([80, 100]);
    expect(body.budget.id).toBeTruthy();
    expect(body.budget.lastEvaluatedAt).toBeNull();
  });

  it('POST /v1/budgets sorts thresholds ascending', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/budgets',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Sorted',
        limitUsd: 100,
        thresholds: [100, 50, 80],
        window: { kind: 'rolling', hours: 24 },
        channels: [{ type: 'log' }],
      }),
    });
    expect(res.statusCode).toBe(201);
    const { budget } = JSON.parse(res.body) as { budget: Budget };
    expect(budget.thresholds).toEqual([50, 80, 100]);
  });

  it('POST /v1/budgets returns 400 on missing name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/budgets',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        limitUsd: 50,
        thresholds: [80],
        window: { kind: 'rolling', hours: 24 },
        channels: [{ type: 'log' }],
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/budgets returns 400 on duplicate thresholds', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/budgets',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Dupe',
        limitUsd: 100,
        thresholds: [80, 80],
        window: { kind: 'rolling', hours: 24 },
        channels: [{ type: 'log' }],
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/budgets returns 400 on empty channels', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/budgets',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'NoChannels',
        limitUsd: 100,
        thresholds: [80],
        window: { kind: 'rolling', hours: 24 },
        channels: [],
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/budgets returns 400 on invalid webhook url', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/budgets',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'BadUrl',
        limitUsd: 100,
        thresholds: [80],
        window: { kind: 'rolling', hours: 24 },
        channels: [{ type: 'webhook', url: 'not-a-url' }],
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /v1/budgets ───────────────────────────────────────────────

  it('GET /v1/budgets returns empty list initially', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/budgets' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { budgets: Budget[]; total: number };
    expect(body.budgets).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('GET /v1/budgets returns all budgets', async () => {
    await store.createBudget(makeBudgetData({ name: 'A' }));
    await store.createBudget(makeBudgetData({ name: 'B' }));

    const res = await app.inject({ method: 'GET', url: '/v1/budgets' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { budgets: Budget[]; total: number };
    expect(body.budgets).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('GET /v1/budgets filters by enabled=true', async () => {
    await store.createBudget(makeBudgetData({ name: 'Active', enabled: true }));
    await store.createBudget(makeBudgetData({ name: 'Inactive', enabled: false }));

    const res = await app.inject({ method: 'GET', url: '/v1/budgets?enabled=true' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { budgets: Budget[] };
    expect(body.budgets).toHaveLength(1);
    expect(body.budgets[0].name).toBe('Active');
  });

  it('GET /v1/budgets filters by keyId=null', async () => {
    await store.createBudget(makeBudgetData({ name: 'Global', keyId: null }));
    await store.createBudget(makeBudgetData({ name: 'Scoped', keyId: 'key-abc' }));

    const res = await app.inject({ method: 'GET', url: '/v1/budgets?keyId=null' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { budgets: Budget[] };
    expect(body.budgets).toHaveLength(1);
    expect(body.budgets[0].name).toBe('Global');
  });

  // ── GET /v1/budgets/:id ───────────────────────────────────────────

  it('GET /v1/budgets/:id returns budget', async () => {
    const created = await store.createBudget(makeBudgetData({ name: 'Specific' }));

    const res = await app.inject({ method: 'GET', url: `/v1/budgets/${created.id}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { budget: Budget };
    expect(body.budget.id).toBe(created.id);
    expect(body.budget.name).toBe('Specific');
  });

  it('GET /v1/budgets/:id returns 404 for unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/budgets/nonexistent-id' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  // ── PATCH /v1/budgets/:id ─────────────────────────────────────────

  it('PATCH /v1/budgets/:id updates fields', async () => {
    const created = await store.createBudget(makeBudgetData({ name: 'Original', limitUsd: 50 }));

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/budgets/${created.id}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated', limitUsd: 200 }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { budget: Budget };
    expect(body.budget.name).toBe('Updated');
    expect(body.budget.limitUsd).toBe(200);
    expect(body.budget.id).toBe(created.id);
  });

  it('PATCH /v1/budgets/:id returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/budgets/nonexistent',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limitUsd: 100 }),
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /v1/budgets/:id returns 400 on invalid body', async () => {
    const created = await store.createBudget(makeBudgetData());

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/budgets/${created.id}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limitUsd: -5 }),
    });
    expect(res.statusCode).toBe(400);
  });

  // ── DELETE /v1/budgets/:id ────────────────────────────────────────

  it('DELETE /v1/budgets/:id removes budget', async () => {
    const created = await store.createBudget(makeBudgetData());

    const res = await app.inject({ method: 'DELETE', url: `/v1/budgets/${created.id}` });
    expect(res.statusCode).toBe(204);

    const check = await store.getBudget(created.id);
    expect(check).toBeUndefined();
  });

  it('DELETE /v1/budgets/:id returns 404 for unknown id', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/budgets/nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /v1/budgets/:id also clears eval state', async () => {
    const budget = await store.createBudget(makeBudgetData());
    await store.setEvalState(budget.id, {
      windowStart: '2026-05-25T00:00:00.000Z',
      firedThresholds: [50],
      lastAlertAt: null,
    });

    await app.inject({ method: 'DELETE', url: `/v1/budgets/${budget.id}` });

    const evalState = await store.getEvalState(budget.id);
    expect(evalState).toBeUndefined();
  });

  // ── POST /v1/budgets/:id/evaluate ────────────────────────────────

  it('POST /v1/budgets/:id/evaluate triggers evaluation and returns result', async () => {
    const mockEvaluate = vi.spyOn(evaluator, 'evaluate').mockResolvedValue({
      budgetId: 'b1',
      windowStart: '2026-05-24T12:00:00.000Z',
      windowEnd: '2026-05-25T12:00:00.000Z',
      currentSpendUsd: 75,
      limitUsd: 100,
      percentUsed: 75,
      triggeredThresholds: [50],
      alertsSent: 1,
    });

    const budget = await store.createBudget(makeBudgetData());

    const res = await app.inject({
      method: 'POST',
      url: `/v1/budgets/${budget.id}/evaluate`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { percentUsed: number; alertsSent: number };
    expect(body.percentUsed).toBe(75);
    expect(body.alertsSent).toBe(1);
    expect(mockEvaluate).toHaveBeenCalledOnce();
  });

  it('POST /v1/budgets/:id/evaluate returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/budgets/nonexistent/evaluate',
    });
    expect(res.statusCode).toBe(404);
  });
});
