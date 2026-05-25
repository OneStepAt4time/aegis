/**
 * budgets-routes-4195.test.ts — /v1/budgets route handler tests.
 *
 * Tests CRUD happy paths, validation errors, 404s, auth, and
 * the manual evaluate endpoint.
 * Issue #4195: Cost Alerts — /v1/budgets API backend.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { BudgetStore } from '../budgets/store.js';
import { BudgetEvaluator } from '../budgets/evaluator.js';
import { BudgetNotifier } from '../budgets/notifications.js';
import { registerBudgetRoutes } from '../budgets/routes.js';
import type { AuthManager } from '../services/auth/index.js';
import type { MeteringService } from '../metering.js';

function tempDir(): string {
  return join(tmpdir(), `aegis-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function makeMockAuth(role: 'admin' | 'viewer' | null = 'admin'): AuthManager {
  return {
    authEnabled: false,
    getRole: () => role ?? 'viewer',
    getPermissions: () => [],
    hasPermission: () => true,
    validateToken: () => ({ valid: true, keyId: 'test-key' }),
  } as unknown as AuthManager;
}

function makeMeteringService(totalCostUsd = 0): MeteringService {
  return {
    getUsageSummary: () => ({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalCostUsd,
      recordCount: 0,
      sessions: 0,
    }),
  } as unknown as MeteringService;
}

const validCreateBody = {
  name: 'Weekly Spend',
  keyId: null,
  limitUsd: 50,
  thresholds: [50, 80, 100],
  window: { kind: 'rolling', hours: 168 },
  channels: [{ type: 'log' }],
  enabled: true,
};

describe('/v1/budgets — CRUD happy path', () => {
  let stateDir: string;
  let store: BudgetStore;
  let evaluator: BudgetEvaluator;

  beforeEach(() => {
    stateDir = tempDir();
    store = new BudgetStore(stateDir);
    const notifier = new BudgetNotifier({});
    evaluator = new BudgetEvaluator(store, makeMeteringService(), notifier);
  });

  afterEach(async () => {
    try { await rm(stateDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('POST /v1/budgets creates a budget', async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({ method: 'POST', url: '/v1/budgets', body: validCreateBody });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.budget.id).toBeTruthy();
    expect(body.budget.name).toBe('Weekly Spend');
    expect(body.budget.thresholds).toEqual([50, 80, 100]);
    await app.close();
  });

  it('GET /v1/budgets returns list with total', async () => {
    await store.createBudget({ name: 'B1', keyId: null, limitUsd: 10, thresholds: [50], window: { kind: 'rolling', hours: 24 }, channels: [{ type: 'log' }], enabled: true });
    await store.createBudget({ name: 'B2', keyId: null, limitUsd: 20, thresholds: [80], window: { kind: 'rolling', hours: 24 }, channels: [{ type: 'log' }], enabled: false });

    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({ method: 'GET', url: '/v1/budgets' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.budgets).toHaveLength(2);
    await app.close();
  });

  it('GET /v1/budgets?enabled=true filters by enabled', async () => {
    await store.createBudget({ name: 'Active', keyId: null, limitUsd: 10, thresholds: [50], window: { kind: 'rolling', hours: 24 }, channels: [{ type: 'log' }], enabled: true });
    await store.createBudget({ name: 'Inactive', keyId: null, limitUsd: 10, thresholds: [50], window: { kind: 'rolling', hours: 24 }, channels: [{ type: 'log' }], enabled: false });

    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({ method: 'GET', url: '/v1/budgets?enabled=true' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.budgets[0].name).toBe('Active');
    await app.close();
  });

  it('GET /v1/budgets/:id returns a single budget', async () => {
    const created = await store.createBudget({ name: 'Single', keyId: null, limitUsd: 50, thresholds: [50], window: { kind: 'rolling', hours: 24 }, channels: [{ type: 'log' }], enabled: true });

    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({ method: 'GET', url: `/v1/budgets/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().budget.id).toBe(created.id);
    await app.close();
  });

  it('PATCH /v1/budgets/:id updates the budget', async () => {
    const created = await store.createBudget({ name: 'Orig', keyId: null, limitUsd: 50, thresholds: [50], window: { kind: 'rolling', hours: 24 }, channels: [{ type: 'log' }], enabled: true });

    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/budgets/${created.id}`,
      body: { limitUsd: 200, name: 'Updated' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.budget.limitUsd).toBe(200);
    expect(body.budget.name).toBe('Updated');
    await app.close();
  });

  it('DELETE /v1/budgets/:id returns 204 and removes budget', async () => {
    const created = await store.createBudget({ name: 'ToDelete', keyId: null, limitUsd: 10, thresholds: [50], window: { kind: 'rolling', hours: 24 }, channels: [{ type: 'log' }], enabled: true });

    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({ method: 'DELETE', url: `/v1/budgets/${created.id}` });
    expect(res.statusCode).toBe(204);

    const found = await store.getBudget(created.id);
    expect(found).toBeUndefined();
    await app.close();
  });
});

describe('/v1/budgets — 404 responses', () => {
  let stateDir: string;
  let store: BudgetStore;
  let evaluator: BudgetEvaluator;

  beforeEach(() => {
    stateDir = tempDir();
    store = new BudgetStore(stateDir);
    const notifier = new BudgetNotifier({});
    evaluator = new BudgetEvaluator(store, makeMeteringService(), notifier);
  });

  afterEach(async () => {
    try { await rm(stateDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('GET /v1/budgets/:id returns 404 for missing budget', async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({ method: 'GET', url: '/v1/budgets/nonexistent' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
    await app.close();
  });

  it('PATCH /v1/budgets/:id returns 404 for missing budget', async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({ method: 'PATCH', url: '/v1/budgets/nonexistent', body: { limitUsd: 50 } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('DELETE /v1/budgets/:id returns 404 for missing budget', async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({ method: 'DELETE', url: '/v1/budgets/nonexistent' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('POST /v1/budgets/:id/evaluate returns 404 for missing budget', async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({ method: 'POST', url: '/v1/budgets/nonexistent/evaluate' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('/v1/budgets — validation errors', () => {
  let stateDir: string;
  let store: BudgetStore;
  let evaluator: BudgetEvaluator;

  beforeEach(() => {
    stateDir = tempDir();
    store = new BudgetStore(stateDir);
    const notifier = new BudgetNotifier({});
    evaluator = new BudgetEvaluator(store, makeMeteringService(), notifier);
  });

  afterEach(async () => {
    try { await rm(stateDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('POST /v1/budgets returns 400 for missing name', async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const body = { ...validCreateBody, name: undefined };
    const res = await app.inject({ method: 'POST', url: '/v1/budgets', body });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('POST /v1/budgets returns 400 for invalid limitUsd', async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({ method: 'POST', url: '/v1/budgets', body: { ...validCreateBody, limitUsd: 0 } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('POST /v1/budgets returns 400 for duplicate thresholds', async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({ method: 'POST', url: '/v1/budgets', body: { ...validCreateBody, thresholds: [50, 50, 80] } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('POST /v1/budgets returns 400 for empty channels', async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({ method: 'POST', url: '/v1/budgets', body: { ...validCreateBody, channels: [] } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('POST /v1/budgets returns 400 for invalid window hours', async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({ method: 'POST', url: '/v1/budgets', body: { ...validCreateBody, window: { kind: 'rolling', hours: 0 } } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('/v1/budgets — auth enforcement', () => {
  let stateDir: string;
  let store: BudgetStore;
  let evaluator: BudgetEvaluator;

  beforeEach(() => {
    stateDir = tempDir();
    store = new BudgetStore(stateDir);
    const notifier = new BudgetNotifier({});
    evaluator = new BudgetEvaluator(store, makeMeteringService(), notifier);
  });

  afterEach(async () => {
    try { await rm(stateDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('POST /v1/budgets returns 403 for non-admin role', async () => {
    const app = Fastify();
    const viewerAuth = {
      authEnabled: true,
      getRole: () => 'viewer',
      getPermissions: () => [],
      hasPermission: () => false,
      validateToken: () => ({ valid: true, keyId: 'viewer-key' }),
    } as unknown as AuthManager;

    // Inject auth context
    app.addHook('preHandler', async (req) => {
      (req as unknown as Record<string, unknown>).authRole = 'viewer';
      (req as unknown as Record<string, unknown>).authKeyId = 'viewer-key';
    });

    registerBudgetRoutes(app, { auth: viewerAuth, budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({ method: 'POST', url: '/v1/budgets', body: validCreateBody });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('/v1/budgets/:id/evaluate — manual evaluation', () => {
  let stateDir: string;
  let store: BudgetStore;

  beforeEach(() => {
    stateDir = tempDir();
    store = new BudgetStore(stateDir);
  });

  afterEach(async () => {
    try { await rm(stateDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('returns evaluation result for existing budget', async () => {
    const metering = makeMeteringService(60); // 60% of $100
    const notifier = new BudgetNotifier({});
    const evaluator = new BudgetEvaluator(store, metering, notifier);

    const created = await store.createBudget({
      name: 'Eval Test', keyId: null, limitUsd: 100,
      thresholds: [50, 80], window: { kind: 'rolling', hours: 24 },
      channels: [{ type: 'log' }], enabled: true,
    });

    const app = Fastify();
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({ method: 'POST', url: `/v1/budgets/${created.id}/evaluate` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.budgetId).toBe(created.id);
    expect(body.currentSpendUsd).toBe(60);
    expect(body.limitUsd).toBe(100);
    expect(body.percentUsed).toBe(60);
    expect(body.triggeredThresholds).toContain(50);
    expect(body.windowStart).toBeTruthy();
    expect(body.windowEnd).toBeTruthy();
    await app.close();
  });

  it('thresholds are sorted ascending after creation', async () => {
    const app = Fastify();
    const notifier = new BudgetNotifier({});
    const evaluator = new BudgetEvaluator(store, makeMeteringService(), notifier);
    registerBudgetRoutes(app, { auth: makeMockAuth(), budgetStore: store, budgetEvaluator: evaluator });

    const res = await app.inject({
      method: 'POST', url: '/v1/budgets',
      body: { ...validCreateBody, thresholds: [100, 50, 80] }, // unsorted
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().budget.thresholds).toEqual([50, 80, 100]); // sorted
    await app.close();
  });
});
