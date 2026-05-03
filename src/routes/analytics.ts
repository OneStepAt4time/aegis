/**
 * routes/analytics.ts — Analytics aggregation endpoints (Issue #1970, #2246, #2247, #2248).
 *
 * GET /v1/analytics/summary     — aggregated session, token, cost,
 *   duration, and error-rate data from the MetricsCache (Issue #2250).
 * GET /v1/analytics/costs       — cost breakdown with per-model and daily trends (Issue #2246).
 * GET /v1/analytics/tokens      — token usage with per-model distribution (Issue #2247).
 * GET /v1/analytics/rate-limits — rate-limit / quota usage with session forecast (Issue #2248).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteContext } from './context.js';
import { requireRole, registerWithLegacy } from './context.js';
import type {
  RateLimitKeyUsage,
  RateLimitForecast,
  RateLimitAnalyticsResponse,
} from '../api-contracts.js';
import type { ApiKey } from '../services/auth/types.js';

/** Fastify rate-limit plugin global config, exposed at startup. */
const GLOBAL_RATE_LIMIT = { max: 600, timeWindowMs: 60_000 };

export function registerAnalyticsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { metricsCache, auth, quotas, sessions } = ctx;

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
      // Issue #2533: Use the lifetime counter (from MetricsCollector) instead of
      // summing costTrends sessions, which only reflects live in-memory sessions.
      const totalSessions = metrics.errorRates.totalSessions;

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

  // ── Rate-limit / quota usage endpoint (Issue #2248) ──────────
  registerWithLegacy(app, 'get', '/v1/analytics/rate-limits', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;

      const keys = auth.listKeys();
      const allSessions = sessions.listSessions();

      // Build per-key usage snapshots
      // listKeys() omits 'hash' but QuotaManager.getUsage only reads id + quotas
      const perKey: RateLimitKeyUsage[] = keys.map((key) => {
        const owned = allSessions.filter((s) => s.ownerKeyId === key.id);
        const usage = quotas.getUsage(key as unknown as ApiKey, owned.length);
        return {
          keyId: key.id,
          keyName: key.name,
          activeSessions: usage.activeSessions,
          maxSessions: usage.maxSessions,
          tokensInWindow: usage.tokensInWindow,
          maxTokens: usage.maxTokens,
          spendInWindowUsd: usage.spendInWindow,
          maxSpendUsd: usage.maxSpend,
          windowMs: usage.windowMs,
        };
      });

      // Compute forecast: find the tightest bottleneck across all keys
      const forecast = computeForecast(perKey);

      const response: RateLimitAnalyticsResponse = {
        global: { ...GLOBAL_RATE_LIMIT },
        perKey,
        forecast,
        generatedAt: new Date().toISOString(),
      };

      return response;
    },
  });
}

// ── Forecast helper ──────────────────────────────────────────────

/**
 * Estimate how many more sessions can be created before the first
 * quota dimension is exhausted.  Returns null when no quotas are set
 * (unlimited capacity).
 */
function computeForecast(perKey: RateLimitKeyUsage[]): RateLimitForecast {
  if (perKey.length === 0) return { estimatedSessionsRemaining: null, bottleneck: null };

  let minRemaining: number | null = null;
  let bottleneck: RateLimitForecast['bottleneck'] = null;

  for (const key of perKey) {
    // Concurrent sessions dimension
    if (key.maxSessions !== null) {
      const remaining = key.maxSessions - key.activeSessions;
      if (minRemaining === null || remaining < minRemaining) {
        minRemaining = remaining;
        bottleneck = 'concurrent_sessions';
      }
    }

    // Tokens dimension — estimate from average tokens/session
    if (key.maxTokens !== null && key.tokensInWindow > 0 && key.activeSessions > 0) {
      const avgTokensPerSession = key.tokensInWindow / key.activeSessions;
      if (avgTokensPerSession > 0) {
        const remaining = Math.floor((key.maxTokens - key.tokensInWindow) / avgTokensPerSession);
        if (minRemaining === null || remaining < minRemaining) {
          minRemaining = remaining;
          bottleneck = 'tokens_per_window';
        }
      }
    }

    // Spend dimension — estimate from average spend/session
    if (key.maxSpendUsd !== null && key.spendInWindowUsd > 0 && key.activeSessions > 0) {
      const avgSpendPerSession = key.spendInWindowUsd / key.activeSessions;
      if (avgSpendPerSession > 0) {
        const remaining = Math.floor((key.maxSpendUsd - key.spendInWindowUsd) / avgSpendPerSession);
        if (minRemaining === null || remaining < minRemaining) {
          minRemaining = remaining;
          bottleneck = 'spend_per_window';
        }
      }
    }
  }

  return { estimatedSessionsRemaining: minRemaining, bottleneck };
}
