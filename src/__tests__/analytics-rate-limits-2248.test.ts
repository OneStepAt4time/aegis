/**
 * analytics-rate-limits-2248.test.ts — Tests for GET /v1/analytics/rate-limits endpoint.
 *
 * Issue #2248: Rate-limit / quota usage API with session forecast.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { registerAnalyticsRoutes } from '../routes/analytics.js';
import type { RouteContext } from '../routes/context.js';
import type { MetricsCache } from '../services/metrics-cache.js';
import type { AuthManager } from '../auth.js';
import type { QuotaManager } from '../services/auth/QuotaManager.js';
import type { ApiKeyPermission } from '../api-contracts.js';
import type { ApiKey } from '../services/auth/types.js';
import type { QuotaUsage } from '../services/auth/QuotaManager.js';

// ── Mock factories ──────────────────────────────────────────────────

function makeKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: overrides.id ?? 'key-1',
    name: overrides.name ?? 'Test Key',
    hash: 'hash',
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    rateLimit: 60,
    expiresAt: null,
    role: 'operator',
    permissions: ['create', 'send'],
    ...overrides,
  };
}

function buildMockMetricsCache(): MetricsCache {
  return {
    getMetrics: () => ({
      sessionVolume: [],
      tokenUsageByModel: [],
      costTrends: [],
      topApiKeys: [],
      durationTrends: [],
      errorRates: { totalSessions: 0, errorRate: 0 },
      generatedAt: new Date().toISOString(),
    }),
  } as unknown as MetricsCache;
}

function buildMockAuth(keys: ApiKey[] = []): AuthManager {
  return {
    validate: () => ({ valid: true, keyId: 'master', role: 'admin' }),
    listKeys: () => keys,
    authEnabled: false,
  } as unknown as AuthManager;
}

function buildMockQuotaManager(keyUsageMap: Map<string, QuotaUsage> = new Map()): QuotaManager {
  return {
    getUsage: (key: ApiKey, activeSessionCount: number) => {
      const cached = keyUsageMap.get(key.id);
      if (cached) return cached;
      return {
        activeSessions: activeSessionCount,
        maxSessions: key.quotas?.maxConcurrentSessions ?? null,
        tokensInWindow: 0,
        maxTokens: key.quotas?.maxTokensPerWindow ?? null,
        spendInWindow: 0,
        maxSpendUsd: key.quotas?.maxSpendPerWindow ?? null,
        windowMs: key.quotas?.quotaWindowMs ?? 3_600_000,
      };
    },
  } as unknown as QuotaManager;
}

function buildMockSessions(ownerKeyIdCounts: Map<string, number> = new Map()) {
  const sessions: Array<{ ownerKeyId: string }> = [];
  for (const [keyId, count] of ownerKeyIdCounts) {
    for (let i = 0; i < count; i++) {
      sessions.push({ ownerKeyId: keyId });
    }
  }
  return { listSessions: () => sessions };
}

function createApp(keys: ApiKey[], keyUsageMap: Map<string, QuotaUsage>, ownerKeyIdCounts: Map<string, number>) {
  const app = Fastify({ logger: false });
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
    auth: buildMockAuth(keys),
    quotas: buildMockQuotaManager(keyUsageMap),
    sessions: buildMockSessions(ownerKeyIdCounts),
  } as unknown as RouteContext;

  registerAnalyticsRoutes(app, ctx);
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('GET /v1/analytics/rate-limits (Issue #2248)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    const keys = [
      makeKey({
        id: 'key-1',
        name: 'Production Key',
        quotas: { maxConcurrentSessions: 5, maxTokensPerWindow: 100_000, maxSpendPerWindow: 10, quotaWindowMs: 3_600_000 },
      }),
      makeKey({
        id: 'key-2',
        name: 'Dev Key',
        quotas: { maxConcurrentSessions: 2, maxTokensPerWindow: null, maxSpendPerWindow: null, quotaWindowMs: 3_600_000 },
      }),
    ];

    const usageMap = new Map<string, QuotaUsage>([
      ['key-1', {
        activeSessions: 3,
        maxSessions: 5,
        tokensInWindow: 40_000,
        maxTokens: 100_000,
        spendInWindow: 2.50,
        maxSpend: 10,
        windowMs: 3_600_000,
      }],
      ['key-2', {
        activeSessions: 2,
        maxSessions: 2,
        tokensInWindow: 15_000,
        maxTokens: null,
        spendInWindow: 0.80,
        maxSpend: null,
        windowMs: 3_600_000,
      }],
    ]);

    const ownerCounts = new Map<string, number>([
      ['key-1', 3],
      ['key-2', 2],
    ]);

    app = createApp(keys, usageMap, ownerCounts);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with correct structure', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).toHaveProperty('global');
    expect(body).toHaveProperty('perKey');
    expect(body).toHaveProperty('forecast');
    expect(body).toHaveProperty('generatedAt');
  });

  it('returns global rate-limit config', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    const body = res.json();
    expect(body.global.max).toBe(600);
    expect(body.global.timeWindowMs).toBe(60_000);
  });

  it('returns per-key quota usage', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    const body = res.json();
    expect(body.perKey).toHaveLength(2);

    const prod = body.perKey.find((k: { keyId: string }) => k.keyId === 'key-1');
    expect(prod).toBeDefined();
    expect(prod.keyName).toBe('Production Key');
    expect(prod.activeSessions).toBe(3);
    expect(prod.maxSessions).toBe(5);
    expect(prod.tokensInWindow).toBe(40_000);
    expect(prod.maxTokens).toBe(100_000);
    expect(prod.spendInWindowUsd).toBe(2.50);
    expect(prod.maxSpendUsd).toBe(10);
    expect(prod.windowMs).toBe(3_600_000);

    const dev = body.perKey.find((k: { keyId: string }) => k.keyId === 'key-2');
    expect(dev).toBeDefined();
    expect(dev.activeSessions).toBe(2);
    expect(dev.maxSessions).toBe(2);
    expect(dev.maxTokens).toBeNull();
    expect(dev.maxSpendUsd).toBeNull();
  });

  it('computes session forecast with bottleneck detection', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    const body = res.json();
    expect(body.forecast).toBeDefined();
    // key-2 has 2/2 concurrent sessions — bottleneck is concurrent_sessions, remaining = 0
    expect(body.forecast.estimatedSessionsRemaining).toBe(0);
    expect(body.forecast.bottleneck).toBe('concurrent_sessions');
  });

  it('includes generatedAt timestamp', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    const body = res.json();
    expect(typeof body.generatedAt).toBe('string');
    expect(new Date(body.generatedAt).getTime()).not.toBeNaN();
  });

  it('handles empty keys gracefully', async () => {
    const emptyApp = createApp([], new Map(), new Map());
    await emptyApp.ready();

    const res = await emptyApp.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.perKey).toHaveLength(0);
    expect(body.forecast.estimatedSessionsRemaining).toBeNull();
    expect(body.forecast.bottleneck).toBeNull();

    await emptyApp.close();
  });

  it('requires authentication', async () => {
    const noAuthApp = Fastify({ logger: false });
    const authEnabled = {
      authEnabled: true,
      validate: () => ({ valid: false, reason: 'no_auth' }),
      listKeys: () => [],
    } as unknown as AuthManager;

    noAuthApp.decorateRequest('authKeyId', null as unknown as string);
    noAuthApp.decorateRequest('matchedPermission', null as unknown as ApiKeyPermission);
    noAuthApp.decorateRequest('tenantId', '_system' as unknown as string);

    noAuthApp.addHook('onRequest', async (req: FastifyRequest) => {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      if (token) req.authKeyId = token;
    });

    const ctx = {
      metricsCache: buildMockMetricsCache(),
      auth: authEnabled,
      quotas: buildMockQuotaManager(),
      sessions: buildMockSessions(),
    } as unknown as RouteContext;

    registerAnalyticsRoutes(noAuthApp, ctx);
    await noAuthApp.ready();

    const res = await noAuthApp.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
    });

    expect(res.statusCode).toBe(401);

    await noAuthApp.close();
  });

  it('forecast detects tokens bottleneck when tighter than concurrent', async () => {
    const keys = [
      makeKey({
        id: 'key-tokens',
        name: 'Token Heavy',
        quotas: { maxConcurrentSessions: 100, maxTokensPerWindow: 50_000, maxSpendPerWindow: null, quotaWindowMs: 3_600_000 },
      }),
    ];

    const usageMap = new Map<string, QuotaUsage>([
      ['key-tokens', {
        activeSessions: 10,
        maxSessions: 100,
        tokensInWindow: 45_000,   // only 5k left → 1 more session at 4500 avg
        maxTokens: 50_000,
        spendInWindow: 0,
        maxSpend: null,
        windowMs: 3_600_000,
      }],
    ]);

    const ownerCounts = new Map<string, number>([['key-tokens', 10]]);
    const tokensApp = createApp(keys, usageMap, ownerCounts);
    await tokensApp.ready();

    const res = await tokensApp.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    const body = res.json();
    // 5000 remaining tokens / 4500 avg per session = 1 session
    expect(body.forecast.bottleneck).toBe('tokens_per_window');
    expect(body.forecast.estimatedSessionsRemaining).toBe(1);

    await tokensApp.close();
  });

  it('forecast detects spend bottleneck when tighter than others', async () => {
    const keys = [
      makeKey({
        id: 'key-spend',
        name: 'Spend Heavy',
        quotas: { maxConcurrentSessions: 100, maxTokensPerWindow: 1_000_000, maxSpendPerWindow: 5, quotaWindowMs: 3_600_000 },
      }),
    ];

    const usageMap = new Map<string, QuotaUsage>([
      ['key-spend', {
        activeSessions: 10,
        maxSessions: 100,
        tokensInWindow: 100_000,
        maxTokens: 1_000_000,
        spendInWindow: 4.50,   // only $0.50 left at $0.45/session avg = 1 session
        maxSpend: 5,
        windowMs: 3_600_000,
      }],
    ]);

    const ownerCounts = new Map<string, number>([['key-spend', 10]]);
    const spendApp = createApp(keys, usageMap, ownerCounts);
    await spendApp.ready();

    const res = await spendApp.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    const body = res.json();
    // $0.50 remaining / $0.45 avg = 1 session
    expect(body.forecast.bottleneck).toBe('spend_per_window');
    expect(body.forecast.estimatedSessionsRemaining).toBe(1);

    await spendApp.close();
  });
});
