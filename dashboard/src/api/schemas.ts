/**
 * api/schemas.ts — Zod runtime validation schemas for critical API responses.
 *
 * These mirror the TypeScript types in types/index.ts. Used by client.ts
 * to validate responses at runtime (defensive — never blocks).
 */

import { z } from 'zod';

// ── Primitives ──────────────────────────────────────────────────

const UIState = z.enum([
  'idle',
  'working',
  'compacting',
  'context_warning',
  'waiting_for_input',
  'permission_prompt',
  'plan_mode',
  'ask_question',
  'bash_approval',
  'settings',
  'error',
  'unknown',
]);

// ── OkResponse ──────────────────────────────────────────────────

export const OkResponseSchema = z.object({
  ok: z.boolean(),
});

export const AuthKeySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number(),
  rateLimit: z.number(),
});

export const CreatedAuthKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
});

// ── SendResponse ────────────────────────────────────────────────

export const SendResponseSchema = OkResponseSchema.extend({
  delivered: z.boolean(),
  attempts: z.number(),
});

// ── HealthResponse ──────────────────────────────────────────────

export const HealthResponseSchema = z.object({
  status: z.string(),
  version: z.string(),
  uptime: z.number(),
  sessions: z.object({
    active: z.number(),
    total: z.number(),
  }),
  timestamp: z.string(),
});

// ── SessionInfo ─────────────────────────────────────────────────

export const SessionInfoSchema = z.object({
  id: z.string(),
  windowId: z.string(),
  windowName: z.string(),
  workDir: z.string(),
  claudeSessionId: z.string().optional(),
  jsonlPath: z.string().optional(),
  byteOffset: z.number(),
  monitorOffset: z.number(),
  status: UIState,
  createdAt: z.number(),
  lastActivity: z.number(),
  stallThresholdMs: z.number(),
  permissionMode: z.string(),
  autoApprove: z.boolean().optional(),
  settingsPatched: z.boolean().optional(),
  promptDelivery: z.object({ delivered: z.boolean(), attempts: z.number() }).optional(),
  actionHints: z.record(z.string(), z.object({
    method: z.string(),
    url: z.string(),
    description: z.string(),
  })).optional(),
});

// ── SessionsListResponse ────────────────────────────────────────

export const SessionsListResponseSchema = z.object({
  sessions: z.array(SessionInfoSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

// ── SessionHealth ──────────────────────────────────────────────

export const SessionHealthSchema = z.object({
  alive: z.boolean(),
  windowExists: z.boolean(),
  claudeRunning: z.boolean(),
  paneCommand: z.string().nullable(),
  status: UIState,
  hasTranscript: z.boolean(),
  lastActivity: z.number(),
  lastActivityAgo: z.number(),
  sessionAge: z.number(),
  details: z.string(),
  actionHints: z.record(z.string(), z.object({
    method: z.string(),
    url: z.string(),
    description: z.string(),
  })).optional(),
});

// ── SessionMetrics ─────────────────────────────────────────────

export const SessionMetricsSchema = z.object({
  durationSec: z.number(),
  messages: z.number(),
  toolCalls: z.number(),
  approvals: z.number(),
  autoApprovals: z.number(),
  statusChanges: z.array(z.string()),
});

const LatencySummaryStatSchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
  avg: z.number().nullable(),
  count: z.number(),
});

export const SessionLatencySchema = z.object({
  sessionId: z.string(),
  realtime: z.object({
    hook_latency_ms: z.number().nullable(),
    state_change_detection_ms: z.number().nullable(),
    permission_response_ms: z.number().nullable(),
  }).nullable(),
  aggregated: z.object({
    hook_latency_ms: LatencySummaryStatSchema,
    state_change_detection_ms: LatencySummaryStatSchema,
    permission_response_ms: LatencySummaryStatSchema,
    channel_delivery_ms: LatencySummaryStatSchema,
  }).nullable(),
});

// ── ParsedEntry ──────────────────────────────────────────────────

const ParsedEntrySchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  contentType: z.enum(['text', 'thinking', 'tool_use', 'tool_result', 'permission_request']),
  text: z.string(),
  toolName: z.string().optional(),
  toolUseId: z.string().optional(),
  timestamp: z.string().optional(),
});

// ── SessionMessages (Issue #407) ────────────────────────────────

export const SessionMessagesSchema = z.object({
  messages: z.array(ParsedEntrySchema),
  status: UIState,
  statusText: z.string().nullable(),
  interactiveContent: z.string().nullable(),
});

// ── GlobalMetrics (Issue #407) ──────────────────────────────────

export const GlobalMetricsSchema = z.object({
  uptime: z.number(),
  sessions: z.object({
    total_created: z.number(),
    currently_active: z.number(),
    completed: z.number(),
    failed: z.number(),
    avg_duration_sec: z.number(),
    avg_messages_per_session: z.number(),
  }),
  auto_approvals: z.number(),
  webhooks_sent: z.number(),
  webhooks_failed: z.number(),
  screenshots_taken: z.number(),
  pipelines_created: z.number(),
  batches_created: z.number(),
  prompt_delivery: z.object({
    sent: z.number(),
    delivered: z.number(),
    failed: z.number(),
    success_rate: z.number().nullable(),
  }),
  latency: z.object({
    hook_latency_ms: LatencySummaryStatSchema,
    state_change_detection_ms: LatencySummaryStatSchema,
    permission_response_ms: LatencySummaryStatSchema,
    channel_delivery_ms: LatencySummaryStatSchema,
  }),
});

// ── SSE Event Data (Issue #410) ────────────────────────────────

const SSEEventTypes = z.enum([
  'status',
  'message',
  'approval',
  'ended',
  'heartbeat',
  'stall',
  'dead',
  'system',
  'hook',
  'subagent_start',
  'subagent_stop',
]);

export const SessionSSEEventDataSchema = z.object({
  event: SSEEventTypes,
  sessionId: z.string(),
  timestamp: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

// ── Global SSE Event (Issue #410) ──────────────────────────────

const GlobalSSEEventType = z.enum([
  'session_status_change',
  'session_message',
  'session_approval',
  'session_ended',
  'session_created',
  'session_stall',
  'session_dead',
  'session_subagent_start',
  'session_subagent_stop',
]);

export const GlobalSSEEventSchema = z.object({
  event: GlobalSSEEventType,
  sessionId: z.string(),
  timestamp: z.string(),
  data: z.record(z.string(), z.unknown()),
});
