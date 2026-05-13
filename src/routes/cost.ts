/**
 * routes/cost.ts — Session cost tracking API (Issue #3264).
 *
 * Focused cost endpoints that complement the broader analytics/usage routes:
 * - Per-session cost summary with burn rate
 * - Aggregate cost summary with time-windowed burn rate
 * - Cost grouped by model
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  type RouteContext,
  registerWithLegacy,
  requireRole,
  withOwnership,
} from './context.js';

/** Per-session cost summary response. */
interface SessionCostResponse {
  sessionId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  cacheHitRate: number;
  estimatedCostUsd: number;
  model: string | null;
  burnRateUsdPerHour: number | null;
  durationMinutes: number | null;
  recordCount: number;
}

/** Aggregate cost summary response. */
interface CostSummaryResponse {
  from: string | null;
  to: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  cacheHitRate: number;
  estimatedCostUsd: number;
  burnRateUsdPerHour: number | null;
  sessions: number;
}

/** Cost grouped by model response. */
interface ModelCostEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
  cacheHitRate: number;
}

interface CostByModelResponse {
  from: string | null;
  to: string | null;
  models: ModelCostEntry[];
  totalModels: number;
  totalCostUsd: number;
}

/** Calculate burn rate (USD/hour) from cost and time range. */
function calcBurnRate(costUsd: number, from: string | undefined, to: string | undefined): number | null {
  if (!from || !to) return null;
  const durationMs = new Date(to).getTime() - new Date(from).getTime();
  if (durationMs <= 0) return null;
  return Math.round((costUsd / durationMs) * 3600 * 1_000_000) / 1_000_000;
}

/** Calculate cache-hit rate from read and write tokens. */
function calcCacheHitRate(cacheRead: number, cacheWrite: number): number {
  const total = cacheRead + cacheWrite;
  if (total === 0) return 0;
  return Math.round((cacheRead / total) * 10000) / 10000;
}

export function registerCostRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { metering } = ctx;

  /**
   * GET /v1/sessions/:id/cost — Per-session cost breakdown.
   *
   * Returns aggregated token counts, cost estimate, cache-hit rate,
   * and burn rate for a single session.
   */
  registerWithLegacy(app, 'get', '/v1/sessions/:id/cost', withOwnership(ctx.sessions, async (_req, _reply, session) => {
    if (!requireRole(ctx.auth, _req, _reply, 'admin', 'operator', 'viewer')) return;

    const sessionId = session.id;
    const records = metering.getSessionUsage(sessionId);
    const summary = metering.getUsageSummary({ sessionId });

    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let latestModel: string | null = null;
    let earliestTs: string | null = null;
    let latestTs: string | null = null;

    for (const r of records) {
      totalCacheRead += r.cacheReadTokens;
      totalCacheWrite += r.cacheCreationTokens;
      if (r.model) latestModel = r.model;
      if (!earliestTs || r.timestamp < earliestTs) earliestTs = r.timestamp;
      if (!latestTs || r.timestamp > latestTs) latestTs = r.timestamp;
    }

    const durationMinutes = earliestTs && latestTs
      ? Math.round((new Date(latestTs).getTime() - new Date(earliestTs).getTime()) / 60000)
      : null;

    const response: SessionCostResponse = {
      sessionId,
      totalInputTokens: summary.totalInputTokens,
      totalOutputTokens: summary.totalOutputTokens,
      totalCacheCreationTokens: summary.totalCacheCreationTokens,
      totalCacheReadTokens: summary.totalCacheReadTokens,
      cacheHitRate: calcCacheHitRate(totalCacheRead, totalCacheWrite),
      estimatedCostUsd: summary.totalCostUsd,
      model: latestModel,
      burnRateUsdPerHour: calcBurnRate(summary.totalCostUsd, earliestTs ?? undefined, latestTs ?? undefined),
      durationMinutes,
      recordCount: summary.recordCount,
    };
    return response;
  }));

  /**
   * GET /v1/cost/summary — Aggregate cost with burn rate.
   *
   * Query params:
   *   from — ISO timestamp lower bound (inclusive)
   *   to   — ISO timestamp upper bound (inclusive)
   */
  registerWithLegacy(app, 'get', '/v1/cost/summary', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(ctx.auth, req, reply, 'admin', 'operator', 'viewer')) return;

    const query = req.query as { from?: string; to?: string };
    const summary = metering.getUsageSummary({ from: query.from, to: query.to });

    const response: CostSummaryResponse = {
      from: summary.from ?? null,
      to: summary.to ?? null,
      totalInputTokens: summary.totalInputTokens,
      totalOutputTokens: summary.totalOutputTokens,
      totalCacheCreationTokens: summary.totalCacheCreationTokens,
      totalCacheReadTokens: summary.totalCacheReadTokens,
      cacheHitRate: calcCacheHitRate(summary.totalCacheReadTokens, summary.totalCacheCreationTokens),
      estimatedCostUsd: summary.totalCostUsd,
      burnRateUsdPerHour: calcBurnRate(summary.totalCostUsd, summary.from, summary.to),
      sessions: summary.sessions,
    };
    return response;
  });

  /**
   * GET /v1/cost/by-model — Cost grouped by model.
   *
   * Uses the MetricsCache for model-grouped token and cost data.
   * Query params:
   *   from — ISO timestamp lower bound (inclusive)
   *   to   — ISO timestamp upper bound (inclusive)
   */
  registerWithLegacy(app, 'get', '/v1/cost/by-model', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(ctx.auth, req, reply, 'admin', 'operator', 'viewer')) return;

    const query = req.query as { from?: string; to?: string };
    const summary = metering.getUsageSummary({ from: query.from, to: query.to });
    const metricsCache = ctx.metricsCache;
    const analytics = metricsCache.getMetrics();

    const modelEntries: ModelCostEntry[] = analytics.tokenUsageByModel.map(m => ({
      model: m.model,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheCreationTokens: m.cacheCreationTokens,
      cacheReadTokens: m.cacheReadTokens,
      estimatedCostUsd: m.estimatedCostUsd,
      cacheHitRate: calcCacheHitRate(m.cacheReadTokens, m.cacheCreationTokens),
    }));

    const totalCost = modelEntries.reduce((sum, m) => sum + m.estimatedCostUsd, 0);

    const response: CostByModelResponse = {
      from: query.from ?? summary.from ?? null,
      to: query.to ?? summary.to ?? null,
      models: modelEntries,
      totalModels: modelEntries.length,
      totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
    };
    return response;
  });
}
