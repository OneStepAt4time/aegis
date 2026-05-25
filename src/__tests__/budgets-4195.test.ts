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
