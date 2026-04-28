/**
 * routes/analytics.ts — Analytics aggregation endpoints (Issue #1970, #2246, #2247, #2248).
 *
 * GET /v1/analytics/summary — aggregated session, token, cost,
 *   duration, and error-rate data from the MetricsCache (Issue #2250).
 * GET /v1/analytics/costs  — cost breakdown with per-model and daily trends (Issue #2246).
 * GET /v1/analytics/tokens — token usage with per-model distribution (Issue #2247).
 * GET /v1/analytics/rate-limits — OAuth usage polling, session forecast, and overage tracking (Issue #2248).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteContext } from './context.js';
import { requireRole, registerWithLegacy } from './context.js';
import type { AnalyticsRateLimitsResponse, AnalyticsSessionForecast } from '../api-contracts.js';

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

  // ── Cost breakdown endpoint (Issue #2246) ───────────────────
  registerWithLegacy(app, 'get', '/v1/analytics/costs', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;

      const metrics = metricsCache.getMetrics();
      const totalCostUsd = metrics.costTrends.reduce((sum, d) => sum + d.cost, 0);
      const totalSessions = metrics.costTrends.reduce((sum, d) => sum + d.sessions, 0);

      return {
        totalCostUsd,
        totalSessions,
        byModel: metrics.tokenUsageByModel.map(m => ({
          model: m.model,
          estimatedCostUsd: m.estimatedCostUsd,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          cacheCreationTokens: m.cacheCreationTokens,
          cacheReadTokens: m.cacheReadTokens,
        })),
        byKey: metrics.topApiKeys.map(k => ({
          keyId: k.keyId,
          keyName: k.keyName,
          estimatedCostUsd: k.estimatedCostUsd,
          sessions: k.sessions,
          messages: k.messages,
        })),
        dailyTrends: metrics.costTrends.map(d => ({
          date: d.date,
          estimatedCostUsd: d.cost,
          sessions: d.sessions,
        })),
        generatedAt: metrics.generatedAt,
      };
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

  // ── Rate limit monitoring endpoint (Issue #2248) ─────────────
  registerWithLegacy(app, 'get', '/v1/analytics/rate-limits', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireRole(auth, req, reply, 'admin', 'operator')) return;

      const keys = auth.listKeys();
      const now = Date.now();
      const WINDOW_MS = 60 * 1000; // 1-minute rolling window

      // Build per-key rate limit status from AuthManager's internal bucket state.
      // AuthManager.validate() updates rateLimits Map; we reflect that state here.
      const keyRateLimitStatuses: AnalyticsRateLimitsResponse['keys'] = keys.map(key => {
        const bucket = (auth as unknown as { rateLimits: Map<string, { count: number; windowStart: number }> })
          .rateLimits.get(key.id);
        const used = bucket && bucket.windowStart > now - WINDOW_MS ? bucket.count : 0;
        const limit = key.rateLimit;
        const remaining = Math.max(0, limit - used);
        const resetsAt = new Date(now + WINDOW_MS).toISOString();

        return {
          keyId: key.id,
          keyName: key.name,
          limit,
          used,
          remaining,
          resetsAt,
        };
      });

      // Session forecast — active sessions from MetricsCache vs session quotas
      const metrics = metricsCache.getMetrics();
      const activeSessions = metrics.sessionVolume.reduce((sum, d) => sum + d.created, 0);
      // Max sessions is the sum of concurrent session quotas across all keys (default 5 per key)
      const maxSessions = keys.reduce((sum, k) => sum + (k.quotas?.maxConcurrentSessions ?? 5), 0);

      const sessionForecast: AnalyticsSessionForecast = {
        activeSessions,
        maxSessions,
        sessionsRemaining: Math.max(0, maxSessions - activeSessions),
      };

      // Historical throttle events — derived from keys that are currently rate-limited
      // (bucket.count > limit). These represent recent throttle occurrences.
      const throttleEvents: AnalyticsRateLimitsResponse['throttleEvents'] = [];
      for (const key of keys) {
        const bucket = (auth as unknown as { rateLimits: Map<string, { count: number; windowStart: number }> })
          .rateLimits.get(key.id);
        if (bucket && bucket.count > key.rateLimit && key.rateLimit > 0) {
          throttleEvents.push({
            keyId: key.id,
            keyName: key.name,
            timestamp: new Date(bucket.windowStart).toISOString(),
            burstSize: bucket.count,
          });
        }
      }

      const response: AnalyticsRateLimitsResponse = {
        keys: keyRateLimitStatuses,
        sessionForecast,
        throttleEvents,
        generatedAt: new Date().toISOString(),
      };

      return response;
    },
  });
}
