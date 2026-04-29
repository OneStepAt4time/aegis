/**
 * analytics-rate-limits-2248.test.ts — Tests for GET /v1/analytics/rate-limits endpoint.
 *
 * Issue #2248: Rate limit monitoring API — exposes current rate limiter stats
 * (active sessions, auth failures, configured limits, per-IP breakdown).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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

function buildMockAuth(): AuthManager {
  return {
    validate: () => ({ valid: true, keyId: 'master', role: 'admin' }),
  } as unknown as AuthManager;
}

function buildMockRateLimiter() {
  return {
    getStats: vi.fn().mockReturnValue({
      activeIpCount: 3,
      activeAuthFailCount: 1,
      ipLimits: [
        { ip: '192.168.1.1', entries: 5 },
        { ip: '10.0.0.1', entries: 2 },
      ],
      authFailLimits: [{ ip: '192.168.1.50', failures: 3 }],
    }),
  };
}

function buildMockConfig() {
  return {
    rateLimit: {
      enabled: true,
      sessionsMax: 100,
      timeWindowSec: 60,
    },
  };
}

describe('GET /v1/analytics/rate-limits (Issue #2248)', () => {
  let app: ReturnType<typeof Fastify>;
  let mockRateLimiter: ReturnType<typeof buildMockRateLimiter>;

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

    mockRateLimiter = buildMockRateLimiter();

    const ctx = {
      metricsCache: buildMockMetricsCache(),
      auth: buildMockAuth(),
      rateLimiter: mockRateLimiter,
      config: buildMockConfig(),
    } as unknown as RouteContext;

    registerAnalyticsRoutes(app, ctx);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns rate limit status with configured limits and usage', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('enabled');
    expect(body.enabled).toBe(true);
    expect(body).toHaveProperty('activeSessions');
    expect(body.activeSessions).toBe(3);
    expect(body).toHaveProperty('activeAuthFailures');
    expect(body.activeAuthFailures).toBe(1);
    expect(body).toHaveProperty('configuredLimits');
    expect(body.configuredLimits.sessionsMax).toBe(100);
    expect(body.configuredLimits.timeWindowSec).toBe(60);
  });

  it('returns per-IP rate limit breakdown', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('rateLimits');
    expect(body.rateLimits).toHaveProperty('ipLimits');
    expect(body.rateLimits).toHaveProperty('authFailLimits');
    expect(Array.isArray(body.rateLimits.ipLimits)).toBe(true);
    expect(Array.isArray(body.rateLimits.authFailLimits)).toBe(true);
    expect(body.rateLimits.ipLimits).toContainEqual({ ip: '192.168.1.1', hits: 5 });
    expect(body.rateLimits.authFailLimits).toContainEqual({ ip: '192.168.1.50', hits: 3 });
  });

  it('returns generatedAt timestamp', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('generatedAt');
    expect(typeof body.generatedAt).toBe('string');
    expect(new Date(body.generatedAt).toISOString()).toBe(body.generatedAt);
  });

  it('handles disabled rate limiting gracefully', async () => {
    // Override config to disabled
    const disabledApp = Fastify({ logger: false });
    disabledApp.decorateRequest('authKeyId', null as unknown as string);
    disabledApp.decorateRequest('matchedPermission', null as unknown as ApiKeyPermission);
    disabledApp.decorateRequest('tenantId', '_system' as unknown as string);

    disabledApp.addHook('onRequest', async (req: FastifyRequest) => {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      if (token) req.authKeyId = token;
    });

    const mockRl = buildMockRateLimiter();
    const ctx = {
      metricsCache: buildMockMetricsCache(),
      auth: buildMockAuth(),
      rateLimiter: mockRl,
      config: { rateLimit: { enabled: false, sessionsMax: 0, timeWindowSec: 0 } },
    } as unknown as RouteContext;

    registerAnalyticsRoutes(disabledApp, ctx);
    await disabledApp.ready();

    const res = await disabledApp.inject({
      method: 'GET',
      url: '/v1/analytics/rate-limits',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(false);

    await disabledApp.close();
  });
});
