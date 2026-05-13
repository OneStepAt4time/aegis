/**
 * analytics-tokens-daily-3282.test.ts — Tests for per-day token breakdown.
 *
 * Issue #3282: GET /v1/analytics/tokens now includes dailyBreakdown
 * with from/to query parameter support.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { SYSTEM_TENANT } from '../config.js';
import { registerAnalyticsRoutes } from '../routes/analytics.js';
import type { RouteContext } from '../routes/context.js';

const NOW = new Date('2026-05-13T12:00:00Z').getTime();
const DAY = 86_400_000;

const records = [
  {
    id: 1, sessionId: 's1', keyId: 'k1',
    timestamp: '2026-05-10T10:00:00Z',
    eventType: 'message', inputTokens: 100, outputTokens: 50,
    cacheCreationTokens: 10, cacheReadTokens: 20,
    costUsd: 0.01, model: 'sonnet',
  },
  {
    id: 2, sessionId: 's2', keyId: 'k1',
    timestamp: '2026-05-10T14:00:00Z',
    eventType: 'message', inputTokens: 200, outputTokens: 100,
    cacheCreationTokens: 30, cacheReadTokens: 40,
    costUsd: 0.02, model: 'sonnet',
  },
  {
    id: 3, sessionId: 's3', keyId: 'k1',
    timestamp: '2026-05-12T10:00:00Z',
    eventType: 'message', inputTokens: 300, outputTokens: 150,
    cacheCreationTokens: 50, cacheReadTokens: 60,
    costUsd: 0.03, model: 'sonnet',
  },
];

function mockMetering() {
  return {
    getDailyTokenBreakdown: vi.fn((options?: { from?: string; to?: string }) => {
      let filtered = records;
      if (options?.from) filtered = filtered.filter(r => r.timestamp >= options.from!);
      if (options?.to) filtered = filtered.filter(r => r.timestamp <= options.to!);

      const dayMap = new Map<string, { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }>();
      for (const r of filtered) {
        const date = r.timestamp.slice(0, 10);
        let bucket = dayMap.get(date);
        if (!bucket) {
          bucket = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
          dayMap.set(date, bucket);
        }
        bucket.inputTokens += r.inputTokens;
        bucket.outputTokens += r.outputTokens;
        bucket.cacheReadTokens += r.cacheReadTokens;
        bucket.cacheWriteTokens += r.cacheCreationTokens;
      }

      return [...dayMap.entries()]
        .map(([date, d]) => ({
          date,
          inputTokens: d.inputTokens,
          outputTokens: d.outputTokens,
          cacheReadTokens: d.cacheReadTokens,
          cacheWriteTokens: d.cacheWriteTokens,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }),
    getUsageSummary: vi.fn(() => ({
      totalInputTokens: 600, totalOutputTokens: 300,
      totalCacheCreationTokens: 90, totalCacheReadTokens: 120,
      totalCostUsd: 0.06, recordCount: 3, sessions: 3,
    })),
    getRateTiers: vi.fn(() => []),
    getSessionUsage: vi.fn(() => []),
    getCostByKey: vi.fn(() => []),
    getUsageByKey: vi.fn(() => []),
  };
}

function mockMetricsCache() {
  return {
    getMetrics: vi.fn(() => ({
      tokenUsageByModel: [
        {
          model: 'sonnet', inputTokens: 600, outputTokens: 300,
          cacheCreationTokens: 90, cacheReadTokens: 120,
          estimatedCostUsd: 0.06,
        },
      ],
      costTrends: [],
      errorRates: { totalSessions: 3 },
      topApiKeys: [],
      generatedAt: new Date(NOW).toISOString(),
    })),
  };
}

function buildApp() {
  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (req: any) => {
    req.authKeyId = 'admin-key';
    req.tenantId = SYSTEM_TENANT;
  });

  const ctx = {
    sessions: { listSessions: vi.fn(() => []), getSession: vi.fn() },
    auth: { authEnabled: true },
    metering: mockMetering() as any,
    metricsCache: mockMetricsCache() as any,
    quotas: {} as any,
    config: { enforceSessionOwnership: true },
  } as unknown as RouteContext;

  registerAnalyticsRoutes(app, ctx);
  return app;
}

describe('GET /v1/analytics/tokens — dailyBreakdown (Issue #3282)', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  async function inject(uri: string) {
    return app.inject({
      method: 'GET',
      url: uri,
      headers: { authorization: 'Bearer admin-key' },
    });
  }

  it('returns dailyBreakdown with aggregated token counts per day', async () => {
    const res = await inject('/v1/analytics/tokens');
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.dailyBreakdown).toHaveLength(2);

    // May 10: 100+200=300 input, 50+100=150 output, 20+40=60 cacheRead, 10+30=40 cacheWrite
    const may10 = body.dailyBreakdown.find((d: any) => d.date === '2026-05-10');
    expect(may10).toBeDefined();
    expect(may10.inputTokens).toBe(300);
    expect(may10.outputTokens).toBe(150);
    expect(may10.cacheReadTokens).toBe(60);
    expect(may10.cacheWriteTokens).toBe(40);

    // May 12: 300 input, 150 output, 60 cacheRead, 50 cacheWrite
    const may12 = body.dailyBreakdown.find((d: any) => d.date === '2026-05-12');
    expect(may12).toBeDefined();
    expect(may12.inputTokens).toBe(300);
    expect(may12.outputTokens).toBe(150);
  });

  it('filters dailyBreakdown by from/to query params', async () => {
    const res = await inject('/v1/analytics/tokens?from=2026-05-12T00:00:00Z&to=2026-05-12T23:59:59Z');
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.dailyBreakdown).toHaveLength(1);
    expect(body.dailyBreakdown[0].date).toBe('2026-05-12');
    expect(body.dailyBreakdown[0].inputTokens).toBe(300);
  });

  it('returns empty dailyBreakdown for out-of-range dates', async () => {
    const res = await inject('/v1/analytics/tokens?from=2020-01-01T00:00:00Z&to=2020-01-02T00:00:00Z');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dailyBreakdown).toEqual([]);
  });

  it('returns empty dailyBreakdown when no records exist', async () => {
    // Build app with empty records
    const app2 = Fastify({ logger: false });
    app2.addHook('onRequest', async (req: any) => {
      req.authKeyId = 'admin-key';
      req.tenantId = SYSTEM_TENANT;
    });

    const emptyMetering = mockMetering();
    emptyMetering.getDailyTokenBreakdown = vi.fn(() => []);

    const ctx = {
      sessions: { listSessions: vi.fn(() => []), getSession: vi.fn() },
      auth: { authEnabled: true },
      metering: emptyMetering as any,
      metricsCache: mockMetricsCache() as any,
      quotas: {} as any,
      config: { enforceSessionOwnership: true },
    } as unknown as RouteContext;

    registerAnalyticsRoutes(app2, ctx);

    const res = await app2.inject({
      method: 'GET',
      url: '/v1/analytics/tokens',
      headers: { authorization: 'Bearer admin-key' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dailyBreakdown).toEqual([]);

    await app2.close();
  });

  it('preserves backward-compatible fields (totalTokens, modelDistribution, dailyCost)', async () => {
    const res = await inject('/v1/analytics/tokens');
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Legacy fields still present
    expect(body.totalTokens).toBeDefined();
    expect(body.modelDistribution).toBeDefined();
    expect(body.dailyCost).toBeDefined();
    expect(body.generatedAt).toBeDefined();

    // New field
    expect(body.dailyBreakdown).toBeDefined();
  });
});
