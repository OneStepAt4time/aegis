/**
 * api/schemas.ts — Zod runtime validation schemas for critical API responses.
 *
 * These mirror the TypeScript types in types/index.ts. Used by client.ts
 * to validate responses at runtime (defensive — never blocks).
 */

import { z } from 'zod';
import type {
  AuditChainMetadata,
  AuditIntegrityMetadata,
  AuditPageResponse,
  AuditRecord,
  HealthResponse,
  SessionInfo,
  SessionStats,
  SessionsListResponse,
  SessionHealth,
  SessionMetrics,
  SessionLatency,
  MessagesResponse,
  GlobalMetrics,
  SessionSSEEvent,
  AuthKeySummary,
  CreatedAuthKey,
} from '../types';

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

const NodePlatformSchema = z.enum([
  'aix',
  'android',
  'darwin',
  'freebsd',
  'haiku',
  'linux',
  'openbsd',
  'sunos',
  'win32',
  'cygwin',
  'netbsd',
]);

// ── OkResponse ──────────────────────────────────────────────────

export const OkResponseSchema = z.object({
  ok: z.boolean(),
});

const ApiKeyPermissionSchema = z.enum(['create', 'send', 'approve', 'reject', 'kill']);

export const AuthKeySummarySchema: z.ZodType<AuthKeySummary> = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number(),
  rateLimit: z.number(),
  expiresAt: z.number().nullable(),
  role: z.enum(['admin', 'operator', 'viewer']),
  permissions: z.array(ApiKeyPermissionSchema),
});

export const CreatedAuthKeySchema: z.ZodType<CreatedAuthKey> = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  expiresAt: z.number().nullable(),
  role: z.enum(['admin', 'operator', 'viewer']),
  permissions: z.array(ApiKeyPermissionSchema),
});

// ── Audit Trail ──────────────────────────────────────────────────

export const AuditRecordSchema: z.ZodType<AuditRecord> = z.object({
  ts: z.string(),
  actor: z.string(),
  action: z.string(),
  sessionId: z.string().optional(),
  detail: z.string(),
  prevHash: z.string(),
  hash: z.string(),
});

export const AuditChainMetadataSchema: z.ZodType<AuditChainMetadata> = z.object({
  count: z.number().int().nonnegative(),
  firstHash: z.string().nullable(),
  lastHash: z.string().nullable(),
  badgeHash: z.string().nullable(),
  firstTs: z.string().nullable(),
  lastTs: z.string().nullable(),
});

export const AuditIntegrityMetadataSchema: z.ZodType<AuditIntegrityMetadata> = z.object({
  valid: z.boolean(),
  brokenAt: z.number().int().positive().optional(),
  file: z.string().optional(),
});

export const AuditPageResponseSchema: z.ZodType<AuditPageResponse> = z.object({
  count: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  records: z.array(AuditRecordSchema),
  filters: z.object({
    actor: z.string().optional(),
    action: z.string().optional(),
    sessionId: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  pagination: z.object({
    limit: z.number().int().positive(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    reverse: z.boolean(),
  }),
  chain: AuditChainMetadataSchema,
  integrity: AuditIntegrityMetadataSchema.optional(),
});

// ── SendResponse ────────────────────────────────────────────────

export const SendResponseSchema = OkResponseSchema.extend({
  delivered: z.boolean(),
  attempts: z.number(),
});

// ── HealthResponse ──────────────────────────────────────────────

export const HealthResponseSchema: z.ZodType<HealthResponse> = z.object({
  status: z.string(),
  version: z.string(),
  platform: NodePlatformSchema,
  uptime: z.number(),
  sessions: z.object({
    active: z.number(),
    total: z.number(),
  }),
  tmux: z.object({
    healthy: z.boolean(),
    error: z.string().nullable(),
  }).optional(),
  claude: z.object({
    available: z.boolean(),
    healthy: z.boolean(),
    version: z.string().nullable(),
    minimumVersion: z.string(),
    error: z.string().nullable(),
  }).optional(),
  timestamp: z.string(),
});

// ── SessionInfo ─────────────────────────────────────────────────

const PendingPermissionInfoSchema = z.object({
  toolName: z.string().optional(),
  prompt: z.string().optional(),
  startedAt: z.number(),
  timeoutMs: z.number(),
  expiresAt: z.number(),
  remainingMs: z.number(),
});

const PendingQuestionInfoSchema = z.object({
  toolUseId: z.string(),
  content: z.string(),
  options: z.array(z.string()).nullable(),
  since: z.number(),
});

export const SessionInfoSchema: z.ZodType<SessionInfo> = z.object({
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
  permissionPromptAt: z.number().optional(),
  permissionRespondedAt: z.number().optional(),
  pendingPermission: PendingPermissionInfoSchema.optional(),
  pendingQuestion: PendingQuestionInfoSchema.optional(),
  promptDelivery: z.object({ delivered: z.boolean(), attempts: z.number() }).optional(),
  actionHints: z.record(z.string(), z.object({
    method: z.string(),
    url: z.string(),
    description: z.string(),
  })).optional(),
});

// ── SessionsListResponse ────────────────────────────────────────

export const SessionsListResponseSchema: z.ZodType<SessionsListResponse> = z.object({
  sessions: z.array(SessionInfoSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

// ── SessionStats ───────────────────────────────────────────────

export const SessionStatsSchema: z.ZodType<SessionStats> = z.object({
  active: z.number(),
  byStatus: z.partialRecord(UIState, z.number()),
  totalCreated: z.number(),
  totalCompleted: z.number(),
  totalFailed: z.number(),
});

// ── SessionHealth ──────────────────────────────────────────────

export const SessionHealthSchema: z.ZodType<SessionHealth> = z.object({
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

// ── AllSessionsHealth (Issue #1136) ─────────────────────────────

export const AllSessionsHealthSchema = z.record(z.string(), SessionHealthSchema);

// ── SessionMetrics ─────────────────────────────────────────────

export const SessionMetricsSchema: z.ZodType<SessionMetrics> = z.object({
  durationSec: z.number(),
  messages: z.number(),
  toolCalls: z.number(),
  approvals: z.number(),
  autoApprovals: z.number(),
  statusChanges: z.array(z.string()),
  tokenUsage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheCreationTokens: z.number(),
    cacheReadTokens: z.number(),
    estimatedCostUsd: z.number(),
  }).optional(),
});

const LatencySummaryStatSchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
  avg: z.number().nullable(),
  count: z.number(),
});

export const SessionLatencySchema: z.ZodType<SessionLatency> = z.object({
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

export const ParsedEntrySchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  contentType: z.enum(['text', 'thinking', 'tool_use', 'tool_result', 'tool_error', 'permission_request', 'progress']),
  text: z.string(),
  toolName: z.string().optional(),
  toolUseId: z.string().optional(),
  timestamp: z.string().optional(),
});

// ── SessionMessages (Issue #407) ────────────────────────────────

export const SessionMessagesSchema: z.ZodType<MessagesResponse> = z.object({
  messages: z.array(ParsedEntrySchema),
  status: UIState,
  statusText: z.string().nullable(),
  interactiveContent: z.string().nullable(),
});

// ── GlobalMetrics (Issue #407) ──────────────────────────────────

export const GlobalMetricsSchema: z.ZodType<GlobalMetrics> = z.object({
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
  'connected',
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
  'verification',
  'permission_denied',
]);

export const SessionSSEEventDataSchema: z.ZodType<SessionSSEEvent> = z.object({
  event: SSEEventTypes,
  sessionId: z.string(),
  timestamp: z.string(),
  emittedAt: z.number().optional(),
  id: z.number().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}).transform((event) => ({
  ...event,
  data: event.data ?? {},
}));

// ── Global SSE Event (Issue #410) ──────────────────────────────

const GlobalSSEEventType = z.enum([
  'connected',
  'heartbeat',
  'session_status_change',
  'session_message',
  'session_approval',
  'session_ended',
  'session_created',
  'session_stall',
  'session_dead',
  'session_subagent_start',
  'session_subagent_stop',
  'session_verification',
  'shutdown',
]);

export const GlobalSSEEventSchema = z.object({
  event: GlobalSSEEventType,
  sessionId: z.string().optional(),
  timestamp: z.string(),
  id: z.number().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}).transform((event) => ({
  ...event,
  sessionId: event.sessionId ?? 'global',
  data: event.data ?? {},
}));

// ── WebSocket Terminal Messages (Issue #1107) ─────────────────────

const WsPaneMessageSchema = z.object({
  type: z.literal('pane'),
  content: z.string(),
});

const WsStatusMessageSchema = z.object({
  type: z.literal('status'),
  status: z.string(),
});

const WsErrorMessageSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
});

export const WsInboundMessageSchema = z.discriminatedUnion('type', [
  WsPaneMessageSchema,
  WsStatusMessageSchema,
  WsErrorMessageSchema,
]);
