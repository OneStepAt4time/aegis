/**
 * routes/analytics.ts — Analytics aggregation endpoint (Issue #1970).
 *
 * GET /v1/analytics/summary returns aggregated session, token, cost,
 * duration, and error-rate data computed from in-memory state.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteContext } from './context.js';
import { requireRole, registerWithLegacy } from './context.js';
import type {
  AnalyticsSummary,
  AnalyticsSessionVolume,
  AnalyticsModelUsage,
  AnalyticsCostTrend,
  AnalyticsKeyUsage,
  AnalyticsDurationTrend,
  AnalyticsErrorRates,
} from '../api-contracts.js';

interface DayBucket {
  created: number;
  cost: number;
  durations: number[];
  messages: number;
}

interface ModelBucket {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}

interface KeyBucket {
  sessions: number;
  messages: number;
  estimatedCostUsd: number;
}

export function registerAnalyticsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { sessions, metrics, auth } = ctx;

  registerWithLegacy(app, 'get', '/v1/analytics/summary', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;

      const allSessions = sessions.listSessions();
      const global = metrics.getGlobalMetrics(allSessions.length);

      // Build key-id → name map for display
      const keys = auth.listKeys();
      const keyNameMap = new Map(keys.map((k) => [k.id, k.name]));

      // Aggregation buckets
      const dailyMap = new Map<string, DayBucket>();
      const modelMap = new Map<string, ModelBucket>();
      const keyUsageMap = new Map<string, KeyBucket>();
      let totalPermissionPrompts = 0;
      let totalApprovals = 0;
      let totalAutoApprovals = 0;

      for (const session of allSessions) {
        const sm = metrics.getSessionMetrics(session.id);
        const date = new Date(session.createdAt).toISOString().split('T')[0] ?? 'unknown';

        // ── Daily bucket ──────────────────────────────────────────
        let day = dailyMap.get(date);
        if (!day) {
          day = { created: 0, cost: 0, durations: [], messages: 0 };
          dailyMap.set(date, day);
        }
        day.created++;
        day.messages += sm?.messages ?? 0;

        if (sm) {
          if (sm.durationSec > 0) {
            day.durations.push(sm.durationSec);
          }

          // ── Token usage by model ──────────────────────────────
          if (sm.tokenUsage) {
            day.cost += sm.tokenUsage.estimatedCostUsd;
            const model = session.model || 'unknown';
            let mb = modelMap.get(model);
            if (!mb) {
              mb = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0 };
              modelMap.set(model, mb);
            }
            mb.inputTokens += sm.tokenUsage.inputTokens;
            mb.outputTokens += sm.tokenUsage.outputTokens;
            mb.cacheCreationTokens += sm.tokenUsage.cacheCreationTokens;
            mb.cacheReadTokens += sm.tokenUsage.cacheReadTokens;
            mb.estimatedCostUsd += sm.tokenUsage.estimatedCostUsd;
          }

          // ── Permission tracking ───────────────────────────────
          totalPermissionPrompts += sm.statusChanges.filter(
            (s) => s === 'permission_prompt' || s === 'bash_approval',
          ).length;
          totalApprovals += sm.approvals;
          totalAutoApprovals += sm.autoApprovals;
        }

        // ── Key usage bucket ────────────────────────────────────
        const keyId = session.ownerKeyId || 'anonymous';
        let kb = keyUsageMap.get(keyId);
        if (!kb) {
          kb = { sessions: 0, messages: 0, estimatedCostUsd: 0 };
          keyUsageMap.set(keyId, kb);
        }
        kb.sessions++;
        kb.messages += sm?.messages ?? 0;
        if (sm?.tokenUsage) {
          kb.estimatedCostUsd += sm.tokenUsage.estimatedCostUsd;
        }
      }

      // ── Build response arrays ──────────────────────────────────

      const sessionVolume: AnalyticsSessionVolume[] = [...dailyMap.entries()]
        .map(([date, d]) => ({ date, created: d.created }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const tokenUsageByModel: AnalyticsModelUsage[] = [...modelMap.entries()]
        .map(([model, d]) => ({ model, ...d }))
        .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

      const costTrends: AnalyticsCostTrend[] = [...dailyMap.entries()]
        .map(([date, d]) => ({ date, cost: d.cost, sessions: d.created }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const topApiKeys: AnalyticsKeyUsage[] = [...keyUsageMap.entries()]
        .map(([keyId, d]) => ({
          keyId,
          keyName: keyNameMap.get(keyId)
            ?? (keyId === 'master' ? 'Master' : keyId === 'anonymous' ? 'Anonymous' : keyId),
          ...d,
        }))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 10);

      const durationTrends: AnalyticsDurationTrend[] = [...dailyMap.entries()]
        .filter(([, d]) => d.durations.length > 0)
        .map(([date, d]) => ({
          date,
          avgDurationSec: Math.round(d.durations.reduce((a, b) => a + b, 0) / d.durations.length),
          count: d.durations.length,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const totalSessions = global.sessions.total_created;
      const failedSessions = global.sessions.failed;

      const errorRates: AnalyticsErrorRates = {
        totalSessions,
        failedSessions,
        failureRate: totalSessions > 0 ? failedSessions / totalSessions : 0,
        permissionPrompts: totalPermissionPrompts,
        approvals: totalApprovals,
        autoApprovals: totalAutoApprovals,
      };

      const result: AnalyticsSummary = {
        sessionVolume,
        tokenUsageByModel,
        costTrends,
        topApiKeys,
        durationTrends,
        errorRates,
        generatedAt: new Date().toISOString(),
      };

      return result;
    },
  });
}
