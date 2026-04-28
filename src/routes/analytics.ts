/**
 * routes/analytics.ts — Analytics aggregation endpoint (Issue #1970).
 *
 * GET /v1/analytics/summary returns aggregated session, token, cost,
 * duration, and error-rate data from the MetricsCache (Issue #2250).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteContext } from './context.js';
import { requireRole, registerWithLegacy } from './context.js';

export function registerAnalyticsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { metricsCache, auth } = ctx;

  registerWithLegacy(app, 'get', '/v1/analytics/summary', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
      return metricsCache.getMetrics();
    },
  });
}
