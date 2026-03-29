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

export interface SessionMetrics {
  durationSec: number;
  messages: number;
  toolCalls: number;
  approvals: number;
  autoApprovals: number;
  statusChanges: string[];
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
  private startTime = Date.now();

  /** Maximum samples per latency type per session (rolling window). */
  static readonly MAX_LATENCY_SAMPLES = 100;

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
    this.perSession.set(sessionId, {
      durationSec: 0, messages: 0, toolCalls: 0,
      approvals: 0, autoApprovals: 0, statusChanges: [],
    });
  }

  sessionCompleted(sessionId: string): void {
    this.global.sessionsCompleted++;
  }

  sessionFailed(sessionId: string): void {
    this.global.sessionsFailed++;
  }

  messageReceived(sessionId: string): void {
    this.global.totalMessages++;
    const m = this.perSession.get(sessionId);
    if (m) m.messages++;
  }

  toolCallReceived(sessionId: string): void {
    this.global.totalToolCalls++;
    const m = this.perSession.get(sessionId);
    if (m) m.toolCalls++;
  }

  approvalGranted(sessionId: string, auto = false): void {
    if (auto) this.global.autoApprovals++;
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

  webhookSent(): void { this.global.webhooksSent++; }
  webhookFailed(): void { this.global.webhooksFailed++; }
  screenshotTaken(): void { this.global.screenshotsTaken++; }
  pipelineCreated(): void { this.global.pipelinesCreated++; }
  batchCreated(): void { this.global.batchesCreated++; }

  promptSent(delivered: boolean): void {
    this.global.promptsSent++;
    if (delivered) {
      this.global.promptsDelivered++;
    } else {
      this.global.promptsFailed++;
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
  }

  recordStateChangeDetection(sessionId: string, latencyMs: number): void {
    this.pushSample(this.getOrCreateLatency(sessionId).state_change_detection_ms, latencyMs);
  }

  recordPermissionResponse(sessionId: string, latencyMs: number): void {
    this.pushSample(this.getOrCreateLatency(sessionId).permission_response_ms, latencyMs);
  }

  recordChannelDelivery(sessionId: string, latencyMs: number): void {
    this.pushSample(this.getOrCreateLatency(sessionId).channel_delivery_ms, latencyMs);
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
  }

  getGlobalMetrics(activeSessionCount: number): Record<string, unknown> {
    const avgMessages = this.global.sessionsCreated > 0
      ? Math.round(this.global.totalMessages / this.global.sessionsCreated) : 0;

    // Issue #87: Aggregate latency across all sessions
    const allHookLatency: number[] = [];
    const allStateChange: number[] = [];
    const allPermissionResponse: number[] = [];
    const allChannelDelivery: number[] = [];
    for (const lat of this.latency.values()) {
      allHookLatency.push(...lat.hook_latency_ms);
      allStateChange.push(...lat.state_change_detection_ms);
      allPermissionResponse.push(...lat.permission_response_ms);
      allChannelDelivery.push(...lat.channel_delivery_ms);
    }

    return {
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      sessions: {
        total_created: this.global.sessionsCreated,
        currently_active: activeSessionCount,
        completed: this.global.sessionsCompleted,
        failed: this.global.sessionsFailed,
        avg_duration_sec: 0,
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
      // Issue #87: Aggregate latency metrics
      latency: {
        hook_latency_ms: this.summarizeSamples(allHookLatency),
        state_change_detection_ms: this.summarizeSamples(allStateChange),
        permission_response_ms: this.summarizeSamples(allPermissionResponse),
        channel_delivery_ms: this.summarizeSamples(allChannelDelivery),
      },
    };
  }

  getSessionMetrics(sessionId: string): SessionMetrics | null {
    return this.perSession.get(sessionId) || null;
  }

  getTotalSessionsCreated(): number {
    return this.global.sessionsCreated;
  }
}
