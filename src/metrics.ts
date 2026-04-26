/**
 * metrics.ts — Usage metrics and counters.
 *
 * Issue #40: Global and per-session metrics for monitoring.
 * Counters are in-memory, persisted to disk on shutdown, loaded on startup.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { metricsFileSchema } from './validation.js';
import {
  sessionsCreatedTotal,
  sessionsCompletedTotal,
  sessionsFailedTotal,
  messagesTotal,
  toolCallsTotal,
  autoApprovalsTotal,
  webhooksSentTotal,
  webhooksFailedTotal,
  screenshotsTotal,
  pipelinesCreatedTotal,
  batchesCreatedTotal,
  promptsSentTotal,
  promptsDeliveredTotal,
  promptsFailedTotal,
  sessionsActive,
  recordLatency,
} from './prometheus.js';
import type {
  GlobalMetrics as GlobalMetricsResponse,
  AggregateMetricsResponse,
  AggregateMetricsTimePoint,
  AggregateMetricsByKey,
  AggregateMetricsAnomaly,
} from './api-contracts.js';
import type { TokenUsageDelta } from './transcript.js';

export interface GlobalMetrics {
  sessionsCreated: number;
  sessionsCompleted: number;
  sessionsFailed: number;
  totalMessages: number;
  totalToolCalls: number;
  autoApprovals: number;
  webhooksSent: number;
  webhooksFailed: number;
  screenshotsTaken: number;
  pipelinesCreated: number;
  batchesCreated: number;
  promptsSent: number;
  promptsDelivered: number;
  promptsFailed: number;
}

/** Issue #488: Cumulative token usage + estimated cost for a session. */
export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}

export interface SessionMetrics {
  durationSec: number;
  messages: number;
  toolCalls: number;
  approvals: number;
  autoApprovals: number;
  statusChanges: string[];
  /** Issue #488: Cumulative token usage and estimated cost. Present once tokens are first observed. */
  tokenUsage?: SessionTokenUsage;
}

/** Issue #87: Per-session latency samples (rolling window). */
export interface SessionLatency {
  hook_latency_ms: number[];
  state_change_detection_ms: number[];
  permission_response_ms: number[];
  channel_delivery_ms: number[];
}

/** Issue #87: Aggregated latency summary for a session. */
export interface SessionLatencySummary {
  hook_latency_ms: { min: number | null; max: number | null; avg: number | null; count: number };
  state_change_detection_ms: { min: number | null; max: number | null; avg: number | null; count: number };
  permission_response_ms: { min: number | null; max: number | null; avg: number | null; count: number };
  channel_delivery_ms: { min: number | null; max: number | null; avg: number | null; count: number };
}

export class MetricsCollector {
  private global: GlobalMetrics = {
    sessionsCreated: 0,
    sessionsCompleted: 0,
    sessionsFailed: 0,
    totalMessages: 0,
    totalToolCalls: 0,
    autoApprovals: 0,
    webhooksSent: 0,
    webhooksFailed: 0,
    screenshotsTaken: 0,
    pipelinesCreated: 0,
    batchesCreated: 0,
    promptsSent: 0,
    promptsDelivered: 0,
    promptsFailed: 0,
  };

  private perSession = new Map<string, SessionMetrics>();
  private latency = new Map<string, SessionLatency>();
  private sessionStartTimes = new Map<string, number>();
  private startTime = Date.now();

  /** Maximum samples per latency type per session (rolling window). */
  static readonly MAX_LATENCY_SAMPLES = 100;

  /**
   * Issue #488: Cost per million tokens by model family.
   * Rates: [input $/M, output $/M, cacheWrite $/M, cacheRead $/M].
   */
  private static readonly COST_TABLE: Record<string, [number, number, number, number]> = {
    'haiku':  [0.80,   4.00,  1.00,  0.08],
    'sonnet': [3.00,  15.00,  3.75,  0.30],
    'opus':   [15.00, 75.00, 18.75,  1.50],
  };

  private static estimateCost(delta: TokenUsageDelta, model?: string): number {
    let tier: [number, number, number, number] = MetricsCollector.COST_TABLE['sonnet'];
    if (model) {
      const lower = model.toLowerCase();
      if (lower.includes('haiku')) tier = MetricsCollector.COST_TABLE['haiku'];
      else if (lower.includes('opus')) tier = MetricsCollector.COST_TABLE['opus'];
    }
    const [inRate, outRate, cwRate, crRate] = tier;
    return (
      (delta.inputTokens * inRate +
       delta.outputTokens * outRate +
       delta.cacheCreationTokens * cwRate +
       delta.cacheReadTokens * crRate) / 1_000_000
    );
  }

  constructor(private metricsFile: string) {}

  async load(): Promise<void> {
    if (existsSync(this.metricsFile)) {
      try {
        const raw = await readFile(this.metricsFile, 'utf-8');
        const parsed = metricsFileSchema.safeParse(JSON.parse(raw));
        if (parsed.success && parsed.data.global) {
          this.global = { ...this.global, ...parsed.data.global };
        }
      } catch { /* ignore corrupt file */ }
    }
  }

  async save(): Promise<void> {
    const dir = dirname(this.metricsFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(this.metricsFile, JSON.stringify({ global: this.global, savedAt: Date.now() }, null, 2));
  }

  sessionCreated(sessionId: string): void {
    this.global.sessionsCreated++;
    sessionsCreatedTotal.inc();
    this.sessionStartTimes.set(sessionId, Date.now());
    this.perSession.set(sessionId, {
      durationSec: 0, messages: 0, toolCalls: 0,
      approvals: 0, autoApprovals: 0, statusChanges: [],
    });
  }

  sessionCompleted(sessionId: string): void {
    this.global.sessionsCompleted++;
    sessionsCompletedTotal.inc();
    this.finalizeSessionDuration(sessionId);
  }

  sessionFailed(sessionId: string): void {
    this.global.sessionsFailed++;
    sessionsFailedTotal.inc();
    this.finalizeSessionDuration(sessionId);
  }

  /** Record the final duration for a completed or failed session. */
  private finalizeSessionDuration(sessionId: string): void {
    const startedAt = this.sessionStartTimes.get(sessionId);
    const m = this.perSession.get(sessionId);
    if (startedAt !== undefined && m) {
      m.durationSec = Math.round((Date.now() - startedAt) / 1000);
    }
  }

  messageReceived(sessionId: string): void {
    this.global.totalMessages++;
    messagesTotal.inc();
    const m = this.perSession.get(sessionId);
    if (m) m.messages++;
  }

  toolCallReceived(sessionId: string): void {
    this.global.totalToolCalls++;
    toolCallsTotal.inc();
    const m = this.perSession.get(sessionId);
    if (m) m.toolCalls++;
  }

  approvalGranted(sessionId: string, auto = false): void {
    if (auto) { this.global.autoApprovals++; autoApprovalsTotal.inc(); }
    const m = this.perSession.get(sessionId);
    if (m) {
      m.approvals++;
      if (auto) m.autoApprovals++;
    }
  }

  statusChanged(sessionId: string, status: string): void {
    const m = this.perSession.get(sessionId);
    if (m) m.statusChanges.push(status);
  }

  webhookSent(): void { this.global.webhooksSent++; webhooksSentTotal.inc(); }
  webhookFailed(): void { this.global.webhooksFailed++; webhooksFailedTotal.inc(); }
  screenshotTaken(): void { this.global.screenshotsTaken++; screenshotsTotal.inc(); }
  pipelineCreated(): void { this.global.pipelinesCreated++; pipelinesCreatedTotal.inc(); }
  batchCreated(): void { this.global.batchesCreated++; batchesCreatedTotal.inc(); }

  promptSent(delivered: boolean): void {
    this.global.promptsSent++;
    promptsSentTotal.inc();
    if (delivered) {
      this.global.promptsDelivered++;
      promptsDeliveredTotal.inc();
    } else {
      this.global.promptsFailed++;
      promptsFailedTotal.inc();
    }
  }

  /** Issue #488: Accumulate token usage for a session. */
  recordTokenUsage(sessionId: string, delta: TokenUsageDelta, model?: string): void {
    const m = this.perSession.get(sessionId);
    if (!m) return;
    const addedCost = MetricsCollector.estimateCost(delta, model);
    if (!m.tokenUsage) {
      m.tokenUsage = {
        inputTokens: delta.inputTokens,
        outputTokens: delta.outputTokens,
        cacheCreationTokens: delta.cacheCreationTokens,
        cacheReadTokens: delta.cacheReadTokens,
        estimatedCostUsd: addedCost,
      };
    } else {
      m.tokenUsage.inputTokens += delta.inputTokens;
      m.tokenUsage.outputTokens += delta.outputTokens;
      m.tokenUsage.cacheCreationTokens += delta.cacheCreationTokens;
      m.tokenUsage.cacheReadTokens += delta.cacheReadTokens;
      m.tokenUsage.estimatedCostUsd += addedCost;
    }
  }

  // ── Issue #87: Latency metric recording ─────────────────────────────

  private getOrCreateLatency(sessionId: string): SessionLatency {
    let lat = this.latency.get(sessionId);
    if (!lat) {
      lat = { hook_latency_ms: [], state_change_detection_ms: [], permission_response_ms: [], channel_delivery_ms: [] };
      this.latency.set(sessionId, lat);
    }
    return lat;
  }

  private pushSample(arr: number[], value: number): void {
    arr.push(value);
    if (arr.length > MetricsCollector.MAX_LATENCY_SAMPLES) {
      arr.shift();
    }
  }

  recordHookLatency(sessionId: string, latencyMs: number): void {
    this.pushSample(this.getOrCreateLatency(sessionId).hook_latency_ms, latencyMs);
    recordLatency("hook_latency_ms", latencyMs);
  }

  recordStateChangeDetection(sessionId: string, latencyMs: number): void {
    this.pushSample(this.getOrCreateLatency(sessionId).state_change_detection_ms, latencyMs);
    recordLatency("state_change_detection_ms", latencyMs);
  }

  recordPermissionResponse(sessionId: string, latencyMs: number): void {
    this.pushSample(this.getOrCreateLatency(sessionId).permission_response_ms, latencyMs);
    recordLatency("permission_response_ms", latencyMs);
  }

  recordChannelDelivery(sessionId: string, latencyMs: number): void {
    this.pushSample(this.getOrCreateLatency(sessionId).channel_delivery_ms, latencyMs);
    recordLatency("channel_delivery_ms", latencyMs);
  }

  private summarizeSamples(samples: number[]): { min: number | null; max: number | null; avg: number | null; count: number } {
    if (samples.length === 0) {
      return { min: null, max: null, avg: null, count: 0 };
    }
    let min = samples[0];
    let max = samples[0];
    let sum = 0;
    for (const s of samples) {
      if (s < min) min = s;
      if (s > max) max = s;
      sum += s;
    }
    return { min, max, avg: Math.round(sum / samples.length), count: samples.length };
  }

  /** Stream-aggregate a single latency field across all sessions without creating temp arrays. */
  private aggregateLatencyField(field: keyof SessionLatency): { min: number | null; max: number | null; avg: number | null; count: number } {
    let min: number | undefined;
    let max: number | undefined;
    let sum = 0;
    let count = 0;
    for (const lat of this.latency.values()) {
      const samples = lat[field];
      for (const s of samples) {
        if (min === undefined || s < min) min = s;
        if (max === undefined || s > max) max = s;
        sum += s;
        count++;
      }
    }
    if (count === 0) return { min: null, max: null, avg: null, count: 0 };
    return { min: min!, max: max!, avg: Math.round(sum / count), count };
  }

  getSessionLatency(sessionId: string): SessionLatencySummary | null {
    const lat = this.latency.get(sessionId);
    if (!lat) return null;
    return {
      hook_latency_ms: this.summarizeSamples(lat.hook_latency_ms),
      state_change_detection_ms: this.summarizeSamples(lat.state_change_detection_ms),
      permission_response_ms: this.summarizeSamples(lat.permission_response_ms),
      channel_delivery_ms: this.summarizeSamples(lat.channel_delivery_ms),
    };
  }

  /** Clean up latency data for a session (called on session kill). */
  clearSessionLatency(sessionId: string): void {
    this.latency.delete(sessionId);
  }

  /** #357: Clean up all per-session data (call on session destroy). */
  cleanupSession(sessionId: string): void {
    this.perSession.delete(sessionId);
    this.latency.delete(sessionId);
    this.sessionStartTimes.delete(sessionId);
  }

  getGlobalMetrics(activeSessionCount: number): GlobalMetricsResponse {
    const avgMessages = this.global.sessionsCreated > 0
      ? Math.round(this.global.totalMessages / this.global.sessionsCreated) : 0;

    // Issue #1414: Calculate avg_duration_sec from per-session durations.
    // Completed/failed sessions have finalized durationSec; active sessions use elapsed time.
    let totalDuration = 0;
    const now = Date.now();
    for (const [id, m] of this.perSession) {
      if (m.durationSec > 0) {
        totalDuration += m.durationSec;
      } else {
        const startedAt = this.sessionStartTimes.get(id);
        if (startedAt !== undefined) {
          totalDuration += Math.round((now - startedAt) / 1000);
        }
      }
    }
    const avgDuration = this.perSession.size > 0
      ? Math.round(totalDuration / this.perSession.size) : 0;

    // Update Prometheus sessions_active gauge
    sessionsActive.set(activeSessionCount);

    // Issue #87: Stream-aggregate latency across all sessions (no temp arrays)
    const aggHook = this.aggregateLatencyField('hook_latency_ms');
    const aggStateChange = this.aggregateLatencyField('state_change_detection_ms');
    const aggPermission = this.aggregateLatencyField('permission_response_ms');
    const aggChannel = this.aggregateLatencyField('channel_delivery_ms');

    return {
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      sessions: {
        total_created: this.global.sessionsCreated,
        currently_active: activeSessionCount,
        completed: this.global.sessionsCompleted,
        failed: this.global.sessionsFailed,
        avg_duration_sec: avgDuration,
        avg_messages_per_session: avgMessages,
      },
      auto_approvals: this.global.autoApprovals,
      webhooks_sent: this.global.webhooksSent,
      webhooks_failed: this.global.webhooksFailed,
      screenshots_taken: this.global.screenshotsTaken,
      pipelines_created: this.global.pipelinesCreated,
      batches_created: this.global.batchesCreated,
      prompt_delivery: {
        sent: this.global.promptsSent,
        delivered: this.global.promptsDelivered,
        failed: this.global.promptsFailed,
        success_rate: this.global.promptsSent > 0
          ? Math.round((this.global.promptsDelivered / this.global.promptsSent) * 100) : null,
      },
      latency: {
        hook_latency_ms: aggHook,
        state_change_detection_ms: aggStateChange,
        permission_response_ms: aggPermission,
        channel_delivery_ms: aggChannel,
      },
    };
  }

  getSessionMetrics(sessionId: string): SessionMetrics | null {
    return this.perSession.get(sessionId) || null;
  }

  getTotalSessionsCreated(): number {
    return this.global.sessionsCreated;
  }

  /** Issue #2087: Expose per-session metrics entries for aggregation. */
  getAllSessionMetricsEntries(): IterableIterator<[string, SessionMetrics]> {
    return this.perSession.entries();
  }

  /** Issue #2087: Expose session start times for aggregation. */
  getAllSessionStartTimes(): IterableIterator<[string, number]> {
    return this.sessionStartTimes.entries();
  }
}

// ── Issue #2087: Aggregation helpers ────────────────────────────────

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
