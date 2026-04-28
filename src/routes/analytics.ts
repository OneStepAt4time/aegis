/**
 * routes/analytics.ts — Analytics aggregation endpoints (Issue #1970, #2247).
 *
 * GET /v1/analytics/summary returns aggregated session, token, cost,
 * duration, and error-rate data from the MetricsCache (Issue #2250).
 * GET /v1/analytics/tokens  — token usage with per-model distribution
 *   derived from MetricsCache (Issue #2247).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteContext } from './context.js';
import { requireRole, registerWithLegacy } from './context.js';

export function registerAnalyticsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { metricsCache, auth } = ctx;

  // ── Summary endpoint (delegates to MetricsCache) ────────────
  registerWithLegacy(app, 'get', '/v1/analytics/summary', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
      return metricsCache.getMetrics();
    },
  });

  // ── Token usage endpoint (Issue #2247) ──────────────────────
  registerWithLegacy(app, 'get', '/v1/analytics/tokens', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;

      const metrics = metricsCache.getMetrics();

      const totalTokens = metrics.tokenUsageByModel.reduce(
        (sum, m) => sum + m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens,
        0,
      );
      const totalCostUsd = metrics.tokenUsageByModel.reduce(
        (sum, m) => sum + m.estimatedCostUsd,
        0,
      );

      return {
        totalTokens,
        totalCostUsd,
        modelDistribution: metrics.tokenUsageByModel.map(m => ({
          model: m.model,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          cacheCreationTokens: m.cacheCreationTokens,
          cacheReadTokens: m.cacheReadTokens,
          estimatedCostUsd: m.estimatedCostUsd,
        })),
        dailyCost: metrics.costTrends.map(d => ({
          date: d.date,
          estimatedCostUsd: d.cost,
          sessions: d.sessions,
        })),
        generatedAt: metrics.generatedAt,
      };
    },
  });
}
