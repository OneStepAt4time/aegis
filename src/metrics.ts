/**
 * metrics.ts — Usage metrics and counters.
 *
 * Issue #40: Global and per-session metrics for monitoring.
 * Counters are in-memory, persisted to disk on shutdown, loaded on startup.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

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
}

export interface SessionMetrics {
  durationSec: number;
  messages: number;
  toolCalls: number;
  approvals: number;
  autoApprovals: number;
  statusChanges: string[];
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
  };

  private perSession = new Map<string, SessionMetrics>();
  private startTime = Date.now();

  constructor(private metricsFile: string) {}

  async load(): Promise<void> {
    if (existsSync(this.metricsFile)) {
      try {
        const data = JSON.parse(await readFile(this.metricsFile, 'utf-8'));
        if (data.global) this.global = { ...this.global, ...data.global };
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

  getGlobalMetrics(activeSessionCount: number): Record<string, unknown> {
    const avgMessages = this.global.sessionsCreated > 0
      ? Math.round(this.global.totalMessages / this.global.sessionsCreated) : 0;

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
    };
  }

  getSessionMetrics(sessionId: string): SessionMetrics | null {
    return this.perSession.get(sessionId) || null;
  }
}
