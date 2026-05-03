/**
 * analytics-cost-2246.test.ts — Tests for GET /v1/analytics/costs endpoint.
 *
 * Issue #2246: Cost breakdown API derived from MetricsCache.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { registerAnalyticsRoutes } from '../routes/analytics.js';
import type { RouteContext } from '../routes/context.js';
import type { MetricsCache } from '../services/metrics-cache.js';
import type { AuthManager } from '../auth.js';
import type { ApiKeyPermission } from '../api-contracts.js';

function buildMockMetricsCache(overrides: Record<string, unknown> = {}): MetricsCache {
  const defaultMetrics = {
    sessionVolume: [
      { date: '2025-06-15', created: 5, completed: 4, failed: 1 },
      { date: '2025-06-16', created: 3, completed: 3, failed: 0 },
    ],
    tokenUsageByModel: [
      {
        model: 'claude-sonnet-4-20250514',
        inputTokens: 10000,
        outputTokens: 5000,
        cacheCreationTokens: 200,
        cacheReadTokens: 1000,
        estimatedCostUsd: 0.15,
      },
      {
        model: 'claude-opus-4-20250514',
        inputTokens: 5000,
        outputTokens: 2000,
        cacheCreationTokens: 0,
        cacheReadTokens: 500,
        estimatedCostUsd: 0.25,
      },
    ],
    costTrends: [
      { date: '2025-06-15', cost: 0.10, sessions: 3 },
      { date: '2025-06-16', cost: 0.30, sessions: 2 },
    ],
    topApiKeys: [
      {
        keyId: 'key-1',
        keyName: 'Production Key',
        sessions: 3,
        messages: 15,
        estimatedCostUsd: 0.25,
      },
      {
        keyId: 'key-2',
        keyName: 'Dev Key',
        sessions: 2,
        messages: 8,
        estimatedCostUsd: 0.15,
      },
    ],
    durationTrends: [],
    errorRates: { totalSessions: 10, errorRate: 0.1, lastErrors: [] },
    generatedAt: '2025-06-16T12:00:00.000Z',
  };

  return {
    getMetrics: () => ({ ...defaultMetrics, ...overrides }),
  } as unknown as MetricsCache;
}

function buildMockAuth(): AuthManager {
  return {
    validate: () => ({ valid: true, keyId: 'master', role: 'admin' }),
  } as unknown as AuthManager;
}

describe('GET /v1/analytics/costs (Issue #2246)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.decorateRequest('authKeyId', null as unknown as string);
    app.decorateRequest('matchedPermission', null as unknown as ApiKeyPermission);
    app.decorateRequest('tenantId', '_system' as unknown as string);

    app.addHook('onRequest', async (req: FastifyRequest) => {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      if (token) req.authKeyId = token;
    });

    const ctx = {
      metricsCache: buildMockMetricsCache(),
      auth: buildMockAuth(),
    } as unknown as RouteContext;

    registerAnalyticsRoutes(app, ctx);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns correct total cost and sessions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/costs',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalCostUsd).toBe(0.40); // 0.10 + 0.30
    expect(body.totalSessions).toBe(10); // from errorRates.totalSessions (Issue #2533)
  });

  it('returns per-model cost breakdown', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/costs',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.byModel).toHaveLength(2);

    const sonnet = body.byModel.find((m: { model: string }) => m.model === 'claude-sonnet-4-20250514');
    expect(sonnet).toBeDefined();
    expect(sonnet.estimatedCostUsd).toBe(0.15);
    expect(sonnet.inputTokens).toBe(10000);

    const opus = body.byModel.find((m: { model: string }) => m.model === 'claude-opus-4-20250514');
    expect(opus).toBeDefined();
    expect(opus.estimatedCostUsd).toBe(0.25);
  });

  it('returns per-key cost breakdown', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/costs',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.byKey).toHaveLength(2);
    expect(body.byKey[0].keyId).toBe('key-1');
    expect(body.byKey[0].keyName).toBe('Production Key');
    expect(body.byKey[0].estimatedCostUsd).toBe(0.25);
    expect(body.byKey[0].sessions).toBe(3);
    expect(body.byKey[0].messages).toBe(15);
  });

  it('returns daily cost trends', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/costs',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.dailyTrends).toHaveLength(2);
    expect(body.dailyTrends[0].date).toBe('2025-06-15');
    expect(body.dailyTrends[0].estimatedCostUsd).toBe(0.10);
    expect(body.dailyTrends[0].sessions).toBe(3);
    expect(body.dailyTrends[1].date).toBe('2025-06-16');
    expect(body.dailyTrends[1].estimatedCostUsd).toBe(0.30);
  });

  it('includes generatedAt timestamp', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/costs',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().generatedAt).toBe('2025-06-16T12:00:00.000Z');
  });

  it('handles empty data gracefully', async () => {
    const emptyApp = Fastify({ logger: false });
    emptyApp.decorateRequest('authKeyId', null as unknown as string);
    emptyApp.decorateRequest('matchedPermission', null as unknown as ApiKeyPermission);
    emptyApp.decorateRequest('tenantId', '_system' as unknown as string);
    emptyApp.addHook('onRequest', async (req: FastifyRequest) => {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      if (token) req.authKeyId = token;
    });

    const ctx = {
      metricsCache: buildMockMetricsCache({
        tokenUsageByModel: [],
        costTrends: [],
        topApiKeys: [],
        errorRates: { totalSessions: 0, failedSessions: 0, failureRate: 0, permissionPrompts: 0, approvals: 0, autoApprovals: 0 },
      }),
      auth: buildMockAuth(),
    } as unknown as RouteContext;

    registerAnalyticsRoutes(emptyApp, ctx);
    await emptyApp.ready();

    const res = await emptyApp.inject({
      method: 'GET',
      url: '/v1/analytics/costs',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalCostUsd).toBe(0);
    expect(body.totalSessions).toBe(0);
    expect(body.byModel).toHaveLength(0);
    expect(body.byKey).toHaveLength(0);
    expect(body.dailyTrends).toHaveLength(0);

    await emptyApp.close();
  });
});
