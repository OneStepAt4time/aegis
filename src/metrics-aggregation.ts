/**
 * metrics-aggregation.ts — Pure-function metrics aggregation over sessions.
 *
 * Extracted from metrics.ts: computes time-series, per-key breakdowns,
 * and anomaly detection from raw session data.
 */

import type {
  AggregateMetricsResponse,
  AggregateMetricsTimePoint,
  AggregateMetricsByKey,
  AggregateMetricsAnomaly,
} from './api-contracts.js';
import type { SessionMetrics } from './metrics-types.js';

export type GroupBy = 'day' | 'hour' | 'key';

/** Minimal session info needed for aggregation (decoupled from SessionManager). */
export interface SessionForAggregation {
  id: string;
  createdAt: number;
  ownerKeyId?: string;
  /** Number of stall events detected for this session. */
  stallCount?: number;
}

/** Map from API key ID to key name. */
export type KeyNameMap = Map<string, string>;

/**
 * Compute aggregated metrics over a time range from per-session data.
 *
 * Pure function — receives data, returns aggregation. Used by the
 * `/v1/metrics/aggregate` route and directly testable.
 */
export function computeAggregateMetrics(
  sessions: SessionForAggregation[],
  perSessionMetrics: Map<string, SessionMetrics>,
  sessionStartTimes: Map<string, number>,
  keyNameMap: KeyNameMap,
  from: number,
  to: number,
  groupBy: GroupBy = 'day',
): AggregateMetricsResponse {
  // Filter sessions by time range
  const filtered = sessions.filter(s => s.createdAt >= from && s.createdAt <= to);

  // Accumulators
  let totalDuration = 0;
  let totalMessages = 0;
  let totalToolCalls = 0;
  let totalTokenCostUsd = 0;
  let totalApprovals = 0;
  let totalAutoApprovals = 0;
  let totalStalls = 0;
  const now = Date.now();

  // Per-key accumulator
  const byKeyAcc = new Map<string, { sessions: number; messages: number; toolCalls: number; tokenCostUsd: number }>();

  // Time-series accumulator: bucket key -> stats
  const tsAcc = new Map<string, { sessions: number; messages: number; toolCalls: number; tokenCostUsd: number }>();

  // Cost array for anomaly detection
  const sessionCosts: Array<{ sessionId: string; cost: number }> = [];

  for (const session of filtered) {
    const m = perSessionMetrics.get(session.id);
    const startedAt = sessionStartTimes.get(session.id);
    const duration = m && m.durationSec > 0
      ? m.durationSec
      : (startedAt ? Math.round((now - startedAt) / 1000) : 0);
    const messages = m?.messages ?? 0;
    const toolCalls = m?.toolCalls ?? 0;
    const approvals = m?.approvals ?? 0;
    const autoApprovals = m?.autoApprovals ?? 0;
    const cost = m?.tokenUsage?.estimatedCostUsd ?? 0;
    const stalls = session.stallCount ?? 0;

    totalDuration += duration;
    totalMessages += messages;
    totalToolCalls += toolCalls;
    totalTokenCostUsd += cost;
    totalApprovals += approvals;
    totalAutoApprovals += autoApprovals;
    totalStalls += stalls;

    // By-key aggregation
    const keyId = session.ownerKeyId ?? '__none__';
    const existing = byKeyAcc.get(keyId);
    if (existing) {
      existing.sessions++;
      existing.messages += messages;
      existing.toolCalls += toolCalls;
      existing.tokenCostUsd += cost;
    } else {
      byKeyAcc.set(keyId, { sessions: 1, messages, toolCalls, tokenCostUsd: cost });
    }

    // Time-series bucket
    if (groupBy !== 'key') {
      const bucketKey = groupBy === 'hour'
        ? new Date(session.createdAt).toISOString().slice(0, 13) + ':00:00.000Z'
        : new Date(session.createdAt).toISOString().slice(0, 10) + 'T00:00:00.000Z';
      const bucket = tsAcc.get(bucketKey);
      if (bucket) {
        bucket.sessions++;
        bucket.messages += messages;
        bucket.toolCalls += toolCalls;
        bucket.tokenCostUsd += cost;
      } else {
        tsAcc.set(bucketKey, { sessions: 1, messages, toolCalls, tokenCostUsd: cost });
      }
    }

    // Track cost for anomaly detection
    if (cost > 0) {
      sessionCosts.push({ sessionId: session.id, cost });
    }
  }

  // Summary
  const totalSessions = filtered.length;
  const avgDurationSeconds = totalSessions > 0 ? Math.round(totalDuration / totalSessions) : 0;
  const permissionApprovalRate = totalApprovals > 0
    ? Math.round((totalAutoApprovals / totalApprovals) * 100)
    : null;

  const summary = {
    totalSessions,
    avgDurationSeconds,
    totalTokenCostUsd: Math.round(totalTokenCostUsd * 100) / 100,
    totalMessages,
    totalToolCalls,
    permissionsApproved: totalApprovals,
    permissionApprovalRate,
    stalls: totalStalls,
  };

  // Time series (sorted by timestamp)
  const timeSeries: AggregateMetricsTimePoint[] = [...tsAcc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, data]) => ({
      timestamp,
      ...data,
      tokenCostUsd: Math.round(data.tokenCostUsd * 100) / 100,
    }));

  // By-key breakdown (sorted by sessions desc)
  const byKey: AggregateMetricsByKey[] = [...byKeyAcc.entries()]
    .sort(([, a], [, b]) => b.sessions - a.sessions)
    .map(([keyId, data]) => ({
      keyId,
      keyName: keyNameMap.get(keyId) ?? (keyId === '__none__' ? 'no-key' : keyId),
      ...data,
      tokenCostUsd: Math.round(data.tokenCostUsd * 100) / 100,
    }));

  // Anomaly detection: sessions exceeding p95 x 3 token cost
  const anomalies: AggregateMetricsAnomaly[] = [];
  if (sessionCosts.length >= 2) {
    const costs = sessionCosts.map(s => s.cost).sort((a, b) => a - b);
    const p95Index = Math.ceil(costs.length * 0.95) - 1;
    const p95 = costs[p95Index] ?? costs[costs.length - 1] ?? 0;
    const threshold = p95 * 3;
    for (const { sessionId, cost } of sessionCosts) {
      if (cost > threshold) {
        anomalies.push({
          sessionId,
          tokenCostUsd: Math.round(cost * 100) / 100,
          reason: `exceeds_p95_by_${(cost / p95).toFixed(1)}x`,
        });
      }
    }
  }

  return { summary, timeSeries, byKey, anomalies };
}
