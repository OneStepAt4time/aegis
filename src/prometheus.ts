/**
 * prometheus.ts — Prometheus metrics registry and instrumentation.
 *
 * Issue #1412: Add Prometheus exposition format endpoint for scraping.
 * Mirrors MetricsCollector counters/gauges/histograms to prom-client registry
 * with proper histogram buckets for latency metrics.
 */

import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';

// Create a dedicated registry (avoids mixing with default metrics)
export const promRegistry = new Registry();

// Collect default Node.js metrics (memory, CPU, event loop, etc.)
collectDefaultMetrics({ register: promRegistry });

// ── Histogram buckets for latency (ms) ─────────────────────────────────────
// Covers: 0.5ms → 10s (sub-ms to multi-second operations)
export const LATENCY_BUCKETS_MS = [
  0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500,
  1000, 2500, 5000, 10000,
];

// ── Session counters ────────────────────────────────────────────────────────
export const sessionsCreatedTotal = new Counter({
  name: 'aegis_sessions_created_total',
  help: 'Total number of sessions created',
  registers: [promRegistry],
});

export const sessionsCompletedTotal = new Counter({
  name: 'aegis_sessions_completed_total',
  help: 'Total number of sessions completed',
  registers: [promRegistry],
});

export const sessionsFailedTotal = new Counter({
  name: 'aegis_sessions_failed_total',
  help: 'Total number of sessions that failed',
  registers: [promRegistry],
});

// ── Message / tool counters ─────────────────────────────────────────────────
export const messagesTotal = new Counter({
  name: 'aegis_messages_total',
  help: 'Total number of messages received',
  registers: [promRegistry],
});

export const toolCallsTotal = new Counter({
  name: 'aegis_tool_calls_total',
  help: 'Total number of tool calls',
  registers: [promRegistry],
});

export const autoApprovalsTotal = new Counter({
  name: 'aegis_auto_approvals_total',
  help: 'Total number of auto-approved permissions',
  registers: [promRegistry],
});

// ── Webhook / screenshot counters ───────────────────────────────────────────
export const webhooksSentTotal = new Counter({
  name: 'aegis_webhooks_sent_total',
  help: 'Total number of webhooks sent successfully',
  registers: [promRegistry],
});

export const webhooksFailedTotal = new Counter({
  name: 'aegis_webhooks_failed_total',
  help: 'Total number of webhooks that failed',
  registers: [promRegistry],
});

export const screenshotsTotal = new Counter({
  name: 'aegis_screenshots_total',
  help: 'Total number of screenshots taken',
  registers: [promRegistry],
});

// ── Pipeline / batch counters ────────────────────────────────────────────────
export const pipelinesCreatedTotal = new Counter({
  name: 'aegis_pipelines_created_total',
  help: 'Total number of pipelines created',
  registers: [promRegistry],
});

export const batchesCreatedTotal = new Counter({
  name: 'aegis_batches_created_total',
  help: 'Total number of batch sessions created',
  registers: [promRegistry],
});

// ── Prompt delivery counters ────────────────────────────────────────────────
export const promptsSentTotal = new Counter({
  name: 'aegis_prompts_sent_total',
  help: 'Total number of prompts sent',
  registers: [promRegistry],
});

export const promptsDeliveredTotal = new Counter({
  name: 'aegis_prompts_delivered_total',
  help: 'Total number of prompts successfully delivered',
  registers: [promRegistry],
});

export const promptsFailedTotal = new Counter({
  name: 'aegis_prompts_failed_total',
  help: 'Total number of prompts that failed to deliver',
  registers: [promRegistry],
});

// ── Gauges ───────────────────────────────────────────────────────────────────
export const sessionsActive = new Gauge({
  name: 'aegis_sessions_active',
  help: 'Number of currently active sessions',
  registers: [promRegistry],
});

// ── Latency histograms (Issue #87 → #1412: proper buckets) ─────────────────
export const hookLatencyMs = new Histogram({
  name: 'aegis_hook_latency_ms',
  help: 'Hook processing latency in milliseconds',
  buckets: LATENCY_BUCKETS_MS,
  registers: [promRegistry],
});

export const stateChangeDetectionLatencyMs = new Histogram({
  name: 'aegis_state_change_detection_latency_ms',
  help: 'State change detection latency in milliseconds',
  buckets: LATENCY_BUCKETS_MS,
  registers: [promRegistry],
});

export const permissionResponseLatencyMs = new Histogram({
  name: 'aegis_permission_response_latency_ms',
  help: 'Permission response latency in milliseconds',
  buckets: LATENCY_BUCKETS_MS,
  registers: [promRegistry],
});

export const channelDeliveryLatencyMs = new Histogram({
  name: 'aegis_channel_delivery_latency_ms',
  help: 'Channel delivery latency in milliseconds',
  buckets: LATENCY_BUCKETS_MS,
  registers: [promRegistry],
});

/** Convenience: observe a latency value on the right histogram by field name. */
export function recordLatency(
  field: 'hook_latency_ms' | 'state_change_detection_ms' | 'permission_response_ms' | 'channel_delivery_ms',
  valueMs: number,
): void {
  switch (field) {
    case 'hook_latency_ms':           hookLatencyMs.observe(valueMs);              break;
    case 'state_change_detection_ms': stateChangeDetectionLatencyMs.observe(valueMs); break;
    case 'permission_response_ms':     permissionResponseLatencyMs.observe(valueMs);   break;
    case 'channel_delivery_ms':       channelDeliveryLatencyMs.observe(valueMs);      break;
  }
}

/** Return content-type for Prometheus scrape responses. */
export const METRICS_CONTENT_TYPE = promRegistry.contentType;
