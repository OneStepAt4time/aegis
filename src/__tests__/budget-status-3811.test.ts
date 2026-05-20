/**
 * budget-status-3811.test.ts — Tests for Issue #3811
 *
 * Verifies the /v1/settings/budget endpoint returns accurate
 * server-side enforcement status for the dashboard.
 */

import Fastify from 'fastify';
import { describe, it, expect } from 'vitest';
import { registerCostRoutes } from '../routes/cost.js';
import type { RouteContext } from '../routes/context.js';

function createMockContext(): RouteContext {
  return {
    sessions: {
      getSession: () => null,
      listSessions: () => [],
    } as unknown as RouteContext['sessions'],
    auth: {
      authEnabled: false,
      getRole: () => 'admin',
      getPermissions: () => [],
      hasPermission: () => true,
      validateToken: () => ({ valid: true, keyId: 'test' }),
    } as unknown as RouteContext['auth'],
    quotas: {} as RouteContext['quotas'],
    config: {} as RouteContext['config'],
    metrics: {} as RouteContext['metrics'],
    monitor: {} as RouteContext['monitor'],
    eventBus: {} as RouteContext['eventBus'],
    channels: {} as RouteContext['channels'],
    jsonlWatcher: {} as RouteContext['jsonlWatcher'],
    pipelines: {} as RouteContext['pipelines'],
    toolRegistry: {} as RouteContext['toolRegistry'],
    getAuditLogger: () => undefined,
    alertManager: {} as RouteContext['alertManager'],
    sseLimiter: {} as RouteContext['sseLimiter'],
    memoryBridge: null,
    requestKeyMap: new Map(),
    validateWorkDir: async () => '/tmp',
    serverState: { draining: false },
    metering: {
      getSessionUsage: () => [],
      getUsageSummary: () => ({ totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationTokens: 0, totalCacheReadTokens: 0, estimatedCostUsd: 0, records: [] }),
    } as unknown as RouteContext['metering'],
    metricsCache: {
      getMetrics: () => ({ models: {} }),
    } as unknown as RouteContext['metricsCache'],
  } as RouteContext;
}

describe('Issue #3811: Budget enforcement status', () => {
  it('GET /v1/settings/budget returns enforcement status', async () => {
    const app = Fastify();
    const ctx = createMockContext();
    registerCostRoutes(app, ctx);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/settings/budget',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body).toHaveProperty('serverSideEnforcement', false);
    expect(body).toHaveProperty('dailyLimitUsd', null);
    expect(body).toHaveProperty('monthlyLimitUsd', null);
    expect(body).toHaveProperty('hardStopEnabled', false);
    expect(body).toHaveProperty('message');
    expect(body.message).toContain('locally');

    await app.close();
  });
});
