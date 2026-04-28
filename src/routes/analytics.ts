/**
 * routes/analytics.ts — Analytics aggregation endpoints (Issue #1970, #2248).
 *
 * GET /v1/analytics/summary returns aggregated session, token, cost,
 * duration, and error-rate data from the MetricsCache (Issue #2250).
 *
 * GET /v1/analytics/rate-limits returns current rate limit usage,
 * per-key breakdown, and throttle history (Issue #2248).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteContext } from './context.js';
import { requireRole, registerWithLegacy } from './context.js';
import type { AnalyticsRateLimits } from '../api-contracts.js';

export function registerAnalyticsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { metricsCache, auth, rateLimiter } = ctx;

  registerWithLegacy(app, 'get', '/v1/analytics/summary', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
      return metricsCache.getMetrics();
    },
  });

  // Issue #2248: Rate limit monitoring endpoint
  registerWithLegacy(app, 'get', '/v1/analytics/rate-limits', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireRole(auth, req, reply, 'admin', 'operator')) return;

      const cfg = rateLimiter.getRateLimitConfig();
      const ipStats = rateLimiter.getIpStats();
      const keyStats = rateLimiter.getKeyStats();
      const throttleHistory = rateLimiter.getThrottleHistory();

      const response: AnalyticsRateLimits = {
        limits: {
          ipNormal: cfg.ipNormal,
          ipMaster: cfg.ipMaster,
          sessionsPerTenant: null, // Issue #1953 — not yet implemented
          ipWindowMs: cfg.ipWindowMs,
        },
        ipUsage: {
          activeIps: ipStats.activeIps,
          limitedIps: ipStats.limitedIps,
          lastThrottleAt: throttleHistory[throttleHistory.length - 1]
            ? new Date(throttleHistory[throttleHistory.length - 1]!.timestamp).toISOString()
            : null,
        },
        topKeys: keyStats,
        throttleHistory: throttleHistory.map((e) => ({
          timestamp: new Date(e.timestamp).toISOString(),
          ip: e.ip,
          keyId: e.keyId,
          limit: e.limit,
          current: e.current,
        })),
        generatedAt: new Date().toISOString(),
      };

      return reply.send(response);
    },
  });
}
