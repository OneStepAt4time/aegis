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
    eventBus: {} as RouteContext['eventBus'],
    metrics: {} as RouteContext['metrics'],
    toolRegistry: {} as RouteContext['toolRegistry'],
    metering: {
      getSessionUsage: () => [],
      getUsageSummary: () => ({ totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationTokens: 0, totalCacheReadTokens: 0, estimatedCostUsd: 0, records: [] }),
    } as unknown as RouteContext['metering'],
    auth: {
      authEnabled: false,
      getRole: () => 'admin',
      getPermissions: () => [],
      hasPermission: () => true,
      validateToken: () => ({ valid: true, keyId: 'test' }),
    } as unknown as RouteContext['auth'],
    metricsCache: {
      getMetrics: () => ({ models: {} }),
    } as unknown as RouteContext['metricsCache'],
    jsonlWatcher: {} as RouteContext['jsonlWatcher'],
    sessionStore: {} as RouteContext['sessionStore'],
    pipelineManager: {} as RouteContext['pipelineManager'],
  };
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
