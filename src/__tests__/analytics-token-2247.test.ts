/**
 * analytics-token-2247.test.ts — Tests for GET /v1/analytics/tokens endpoint.
 *
 * Issue #2247: Token usage API derived from MetricsCache.
 * Tests that the endpoint correctly reshapes cache data into the
 * token usage response format.
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
    topApiKeys: [],
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

describe('GET /v1/analytics/tokens (Issue #2247)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.decorateRequest('authKeyId', null as unknown as string);
    app.decorateRequest('matchedPermission', null as unknown as ApiKeyPermission);
    app.decorateRequest('tenantId', '_system' as unknown as string);

    // Auth hook
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

  it('returns token usage with correct totals', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/tokens',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Total tokens = (10000+5000+200+1000) + (5000+2000+0+500) = 23700
    expect(body.totalTokens).toBe(23700);
    // Total cost = 0.15 + 0.25 = 0.40
    expect(body.totalCostUsd).toBe(0.40);
  });

  it('returns per-model distribution', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/tokens',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.modelDistribution).toHaveLength(2);

    const sonnet = body.modelDistribution.find((m: { model: string }) => m.model === 'claude-sonnet-4-20250514');
    expect(sonnet).toBeDefined();
    expect(sonnet.inputTokens).toBe(10000);
    expect(sonnet.outputTokens).toBe(5000);
    expect(sonnet.cacheCreationTokens).toBe(200);
    expect(sonnet.cacheReadTokens).toBe(1000);
    expect(sonnet.estimatedCostUsd).toBe(0.15);
  });

  it('returns daily cost breakdown', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/tokens',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.dailyCost).toHaveLength(2);
    expect(body.dailyCost[0]).toHaveProperty('date', '2025-06-15');
    expect(body.dailyCost[0]).toHaveProperty('estimatedCostUsd', 0.10);
    expect(body.dailyCost[0]).toHaveProperty('sessions', 3);
    expect(body.dailyCost[1]).toHaveProperty('date', '2025-06-16');
    expect(body.dailyCost[1]).toHaveProperty('estimatedCostUsd', 0.30);
  });

  it('includes generatedAt timestamp', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/tokens',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.generatedAt).toBe('2025-06-16T12:00:00.000Z');
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
      }),
      auth: buildMockAuth(),
    } as unknown as RouteContext;

    registerAnalyticsRoutes(emptyApp, ctx);
    await emptyApp.ready();

    const res = await emptyApp.inject({
      method: 'GET',
      url: '/v1/analytics/tokens',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalTokens).toBe(0);
    expect(body.totalCostUsd).toBe(0);
    expect(body.modelDistribution).toHaveLength(0);
    expect(body.dailyCost).toHaveLength(0);

    await emptyApp.close();
  });
});
