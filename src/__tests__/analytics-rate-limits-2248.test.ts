/**
 * analytics-rate-limits-2248.test.ts — Tests for GET /v1/analytics/rate-limits endpoint.
 *
 * Issue #2248: Rate limit monitoring API — OAuth usage polling, session forecast,
 * and overage tracking.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { registerAnalyticsRoutes } from '../routes/analytics.js';
import type { RouteContext } from '../routes/context.js';
import type { MetricsCache } from '../services/metrics-cache.js';
import type { AuthManager } from '../auth.js';
import type { ApiKeyPermission } from '../api-contracts.js';

interface MockKey {
  id: string;
  name: string;
  rateLimit: number;
  quotas?: { maxConcurrentSessions?: number };
}

interface MockRateLimitBucket {
  count: number;
  windowStart: number;
}

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
    ],
    durationTrends: [],
    errorRates: { totalSessions: 10, errorRate: 0.1, lastErrors: [] },
    generatedAt: '2025-06-16T12:00:00.000Z',
  };

  return {
    getMetrics: () => ({ ...defaultMetrics, ...overrides }),
  } as unknown as MetricsCache;
}

function buildMockAuth(
  keys: MockKey[] = [],
  rateLimits: Map<string, MockRateLimitBucket> = new Map(),
  authEnabled = true,
): AuthManager {
  return {
    validate: () => ({ valid: true, keyId: 'master', role: 'admin' }),
    listKeys: () => keys,
    authEnabled,
    getRole: () => 'admin',
    rateLimits,
  } as unknown as AuthManager;
}

describe('GET /v1/analytics/rate-limits (Issue #2248)', () => {
  const mockKeys: MockKey[] = [
    { id: 'key-1', name: 'Production Key', rateLimit: 100 },
    { id: 'key-2', name: 'Dev Key', rateLimit: 50 },
  ];

  const now = Date.now();
  const rateLimitsMap = new Map<string, MockRateLimitBucket>([
    ['key-1', { count: 25, windowStart: now }],
    ['key-2', { count: 10, windowStart: now }],
  ]);

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
      auth: buildMockAuth(mockKeys, rateLimitsMap, true),
    } as unknown as RouteContext;

    registerAnalyticsRoutes(app, ctx);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns rate limit status for all keys', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).toHaveProperty('keys');
    expect(body).toHaveProperty('generatedAt');
    expect(Array.isArray(body.keys)).toBe(true);
  });

  it('includes per-key rate limit details', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.keys).toHaveLength(2);

    const prodKey = body.keys.find((k: { keyId: string }) => k.keyId === 'key-1');
    expect(prodKey).toBeDefined();
    expect(prodKey.keyName).toBe('Production Key');
    expect(prodKey.limit).toBe(100);
    expect(prodKey.used).toBe(25);
    expect(prodKey.remaining).toBe(75);
    expect(prodKey.resetsAt).toBeDefined();
  });

  it('returns 403 for viewer role', async () => {
    const viewerApp = Fastify({ logger: false });
    viewerApp.decorateRequest('authKeyId', null as unknown as string);
    viewerApp.decorateRequest('matchedPermission', null as unknown as ApiKeyPermission);
    viewerApp.decorateRequest('tenantId', '_system' as unknown as string);

    viewerApp.addHook('onRequest', async (req: FastifyRequest) => {
      req.authKeyId = 'viewer-key';
    });

    const ctx = {
      metricsCache: buildMockMetricsCache(),
      auth: {
        validate: () => ({ valid: true, keyId: 'viewer-key', role: 'viewer' }),
        authEnabled: true,
        getRole: () => 'viewer' as const,
        listKeys: () => mockKeys,
        rateLimits: new Map(),
      } as unknown as AuthManager,
    } as unknown as RouteContext;

    registerAnalyticsRoutes(viewerApp, ctx);
    await viewerApp.ready();

    const res = await viewerApp.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer viewer-key' },
    });

    expect(res.statusCode).toBe(403);
    await viewerApp.close();
  });

  it('includes session forecast when sessions data is available', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).toHaveProperty('sessionForecast');
    expect(body.sessionForecast).toHaveProperty('activeSessions');
    expect(body.sessionForecast).toHaveProperty('maxSessions');
    expect(body.sessionForecast).toHaveProperty('sessionsRemaining');
    expect(typeof body.sessionForecast.activeSessions).toBe('number');
    expect(typeof body.sessionForecast.maxSessions).toBe('number');
    expect(typeof body.sessionForecast.sessionsRemaining).toBe('number');
  });

  it('includes historical throttle events when present', async () => {
    // Set up a key that is currently over rate limit to simulate throttle
    const overLimitMap = new Map<string, MockRateLimitBucket>([
      ['key-1', { count: 150, windowStart: now }], // over limit of 100
      ['key-2', { count: 10, windowStart: now }],
    ]);

    const throttleApp = Fastify({ logger: false });
    throttleApp.decorateRequest('authKeyId', null as unknown as string);
    throttleApp.decorateRequest('matchedPermission', null as unknown as ApiKeyPermission);
    throttleApp.decorateRequest('tenantId', '_system' as unknown as string);

    throttleApp.addHook('onRequest', async (req: FastifyRequest) => {
      req.authKeyId = 'master';
    });

    const ctx = {
      metricsCache: buildMockMetricsCache(),
      auth: buildMockAuth(mockKeys, overLimitMap, true),
    } as unknown as RouteContext;

    registerAnalyticsRoutes(throttleApp, ctx);
    await throttleApp.ready();

    const res = await throttleApp.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).toHaveProperty('throttleEvents');
    expect(Array.isArray(body.throttleEvents)).toBe(true);

    const key1Event = body.throttleEvents.find((e: { keyId: string }) => e.keyId === 'key-1');
    expect(key1Event).toBeDefined();
    expect(key1Event.burstSize).toBe(150);

    await throttleApp.close();
  });

  it('rate limit usage does not exceed limit and used+remaining equals limit', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    for (const keyEntry of body.keys) {
      if (keyEntry.limit > 0) {
        expect(keyEntry.used).toBeLessThanOrEqual(keyEntry.limit);
        expect(keyEntry.remaining).toBeGreaterThanOrEqual(0);
        expect(keyEntry.used + keyEntry.remaining).toBe(keyEntry.limit);
      }
    }
  });

  it('handles zero rate limit (unlimited) keys gracefully', async () => {
    const unlimitedKeys: MockKey[] = [
      { id: 'unlimited-key', name: 'Unlimited Key', rateLimit: 0 },
    ];

    const unlimitedApp = Fastify({ logger: false });
    unlimitedApp.decorateRequest('authKeyId', null as unknown as string);
    unlimitedApp.decorateRequest('matchedPermission', null as unknown as ApiKeyPermission);
    unlimitedApp.decorateRequest('tenantId', '_system' as unknown as string);

    unlimitedApp.addHook('onRequest', async (req: FastifyRequest) => {
      req.authKeyId = 'master';
    });

    const ctx = {
      metricsCache: buildMockMetricsCache(),
      auth: buildMockAuth(unlimitedKeys, new Map(), true),
    } as unknown as RouteContext;

    registerAnalyticsRoutes(unlimitedApp, ctx);
    await unlimitedApp.ready();

    const res = await unlimitedApp.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    const unlimitedEntry = body.keys.find((k: { keyId: string }) => k.keyId === 'unlimited-key');
    expect(unlimitedEntry).toBeDefined();
    expect(unlimitedEntry.limit).toBe(0);
    expect(unlimitedEntry.used).toBe(0);
    expect(unlimitedEntry.remaining).toBe(0);

    await unlimitedApp.close();
  });
});
