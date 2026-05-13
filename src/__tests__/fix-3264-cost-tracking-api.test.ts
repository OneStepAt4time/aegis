/**
 * fix-3264-cost-tracking-api.test.ts — Tests for session cost tracking API endpoints.
 *
 * Issue #3264: GET /v1/sessions/:id/cost, GET /v1/cost/summary, GET /v1/cost/by-model
 */

import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { SYSTEM_TENANT } from '../config.js';
import { registerCostRoutes } from '../routes/cost.js';
import type { RouteContext } from '../routes/context.js';
import type { UsageRecord, UsageSummary } from '../metering.js';

const SESSION_ID = '00000000-0000-4000-8000-000000003264';
const NOW = 1_800_000_000_000;
const ONE_HOUR_AGO = new Date(NOW - 3600_000).toISOString();
const NOW_ISO = new Date(NOW).toISOString();

function makeRecords(): UsageRecord[] {
  return [
    {
      id: 1, sessionId: SESSION_ID, keyId: 'master',
      timestamp: ONE_HOUR_AGO,
      eventType: 'message', inputTokens: 1000, outputTokens: 500,
      cacheCreationTokens: 200, cacheReadTokens: 800,
      costUsd: 0.015, model: 'claude-sonnet-4-20250514',
    },
    {
      id: 2, sessionId: SESSION_ID, keyId: 'master',
      timestamp: NOW_ISO,
      eventType: 'message', inputTokens: 2000, outputTokens: 1000,
      cacheCreationTokens: 400, cacheReadTokens: 1600,
      costUsd: 0.030, model: 'claude-sonnet-4-20250514',
    },
  ];
}

function mockMetering(records: UsageRecord[]) {
  return {
    getSessionUsage: vi.fn(() => records),
    getUsageSummary: vi.fn((opts?: { from?: string; to?: string; keyId?: string; sessionId?: string }) => {
      const filtered = opts?.sessionId ? records.filter(r => r.sessionId === opts?.sessionId) : records;
      const timeFiltered = filtered.filter(r => {
        if (opts?.from && r.timestamp < opts.from) return false;
        if (opts?.to && r.timestamp > opts.to) return false;
        return true;
      });
      return {
        totalInputTokens: timeFiltered.reduce((s, r) => s + r.inputTokens, 0),
        totalOutputTokens: timeFiltered.reduce((s, r) => s + r.outputTokens, 0),
        totalCacheCreationTokens: timeFiltered.reduce((s, r) => s + r.cacheCreationTokens, 0),
        totalCacheReadTokens: timeFiltered.reduce((s, r) => s + r.cacheReadTokens, 0),
        totalCostUsd: Math.round(timeFiltered.reduce((s, r) => s + r.costUsd, 0) * 1_000_000) / 1_000_000,
        recordCount: timeFiltered.length,
        sessions: new Set(timeFiltered.map(r => r.sessionId)).size,
        from: timeFiltered.length > 0 ? timeFiltered[0].timestamp : undefined,
        to: timeFiltered.length > 0 ? timeFiltered[timeFiltered.length - 1].timestamp : undefined,
      } as UsageSummary;
    }),
    getUsageByKey: vi.fn(() => []),
    getRateTiers: vi.fn(() => []),
  };
}

function mockMetricsCache() {
  return {
    getMetrics: vi.fn(() => ({
      tokenUsageByModel: [
        {
          model: 'claude-sonnet-4-20250514',
          inputTokens: 3000, outputTokens: 1500,
          cacheCreationTokens: 600, cacheReadTokens: 2400,
          estimatedCostUsd: 0.045,
        },
      ],
      costTrends: [],
      errorRates: { totalSessions: 1 },
      topApiKeys: [],
      generatedAt: NOW_ISO,
    })),
  };
}

const session = {
  id: SESSION_ID, displayName: 'cost-test', status: 'working',
  workDir: '/tmp', createdAt: NOW - 3600000, lastActivity: NOW,
};

/**
 * Build a Fastify app with cost routes.
 *
 * @param authKey If provided, sets req.authKeyId to this value (simulates authenticated).
 *                If omitted, req.authKeyId is undefined (simulates unauthenticated).
 */
function buildApp(authKey?: string) {
  const app = Fastify({ logger: false });
  const records = makeRecords();

  const authEnabled = true;

  app.addHook('onRequest', async (req) => {
    // Only set authKeyId if a key was provided — undefined simulates no auth
    if (authKey !== undefined) {
      req.authKeyId = authKey;
    }
    req.tenantId = SYSTEM_TENANT;
  });

  const ctx = {
    sessions: {
      getSession: vi.fn((id: string) => id === SESSION_ID ? session : undefined),
      listSessions: vi.fn(() => [session]),
    },
    auth: { authEnabled },
    metering: mockMetering(records),
    metricsCache: mockMetricsCache(),
    config: { enforceSessionOwnership: true },
  } as unknown as RouteContext;

  registerCostRoutes(app, ctx);
  return app;
}

describe('Issue #3264 — Session cost tracking API', () => {
  describe('GET /v1/sessions/:id/cost', () => {
    it('returns per-session cost summary with burn rate', async () => {
      const app = buildApp('master');
      try {
        const response = await app.inject({
          method: 'GET',
          url: `/v1/sessions/${SESSION_ID}/cost`,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.sessionId).toBe(SESSION_ID);
        expect(body.totalInputTokens).toBe(3000);
        expect(body.totalOutputTokens).toBe(1500);
        expect(body.totalCacheCreationTokens).toBe(600);
        expect(body.totalCacheReadTokens).toBe(2400);
        expect(body.estimatedCostUsd).toBe(0.045);
        expect(body.model).toBe('claude-sonnet-4-20250514');
        expect(body.cacheHitRate).toBeGreaterThan(0);
        expect(body.burnRateUsdPerHour).toBeGreaterThan(0);
        expect(body.durationMinutes).toBe(60);
      } finally {
        await app.close();
      }
    });
  });

  describe('GET /v1/cost/summary', () => {
    it('returns aggregate cost with burn rate', async () => {
      const app = buildApp('master');
      try {
        const response = await app.inject({
          method: 'GET',
          url: '/v1/cost/summary',
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.totalInputTokens).toBe(3000);
        expect(body.totalOutputTokens).toBe(1500);
        expect(body.estimatedCostUsd).toBe(0.045);
        expect(body.cacheHitRate).toBeGreaterThan(0);
        expect(body.burnRateUsdPerHour).toBeGreaterThan(0);
        expect(body.sessions).toBe(1);
      } finally {
        await app.close();
      }
    });

    it('supports time range filtering', async () => {
      const app = buildApp('master');
      try {
        const response = await app.inject({
          method: 'GET',
          url: `/v1/cost/summary?from=${ONE_HOUR_AGO}&to=${NOW_ISO}`,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.from).toBeTruthy();
        expect(body.to).toBeTruthy();
      } finally {
        await app.close();
      }
    });
  });

  describe('GET /v1/cost/by-model', () => {
    it('returns cost grouped by model', async () => {
      const app = buildApp('master');
      try {
        const response = await app.inject({
          method: 'GET',
          url: '/v1/cost/by-model',
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.models).toHaveLength(1);
        expect(body.models[0].model).toBe('claude-sonnet-4-20250514');
        expect(body.models[0].estimatedCostUsd).toBe(0.045);
        expect(body.models[0].cacheHitRate).toBeGreaterThan(0);
        expect(body.totalCostUsd).toBe(0.045);
      } finally {
        await app.close();
      }
    });
  });

  describe('Auth rejection', () => {
    it('GET /v1/cost/summary rejects unauthenticated requests', async () => {
      const app = buildApp(); // no authKey → unauthenticated
      try {
        const response = await app.inject({
          method: 'GET',
          url: '/v1/cost/summary',
        });
        expect(response.statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });

    it('GET /v1/cost/by-model rejects unauthenticated requests', async () => {
      const app = buildApp();
      try {
        const response = await app.inject({
          method: 'GET',
          url: '/v1/cost/by-model',
        });
        expect(response.statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });

    it('GET /v1/sessions/:id/cost rejects unauthenticated requests', async () => {
      const app = buildApp();
      try {
        const response = await app.inject({
          method: 'GET',
          url: `/v1/sessions/${SESSION_ID}/cost`,
        });
        expect(response.statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });
  });
});
