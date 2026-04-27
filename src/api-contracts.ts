/**
 * api-contracts.ts — Shared API contract types for backend and dashboard.
 *
 * Keep this file runtime-free (types only) so both packages can import it
 * without bundling backend implementation code into the frontend.
 */

import type { ApiKeyPermission as ServiceApiKeyPermission } from './services/auth/index.js';

export type UIState =
  | 'idle'
  | 'working'
  | 'compacting'
  | 'context_warning'
  | 'waiting_for_input'
  | 'permission_prompt'
  | 'plan_mode'
  | 'ask_question'
  | 'bash_approval'
  | 'settings'
  | 'error'
  | 'unknown';

export type SessionStatusFilter = 'all' | UIState;

export interface PendingPermissionInfo {
  toolName?: string;
  prompt?: string;
  startedAt: number;
  timeoutMs: number;
  expiresAt: number;
  remainingMs: number;
}

export interface PendingQuestionInfo {
  toolUseId: string;
  content: string;
  options: string[] | null;
  since: number;
}

export interface SessionInfo {
  id: string;
  windowId: string;
  windowName: string;
  workDir: string;
  claudeSessionId?: string;
  jsonlPath?: string;
  byteOffset: number;
  monitorOffset: number;
  status: UIState;
  createdAt: number;
  lastActivity: number;
  stallThresholdMs: number;
  permissionMode: string;
  autoApprove?: boolean;
  settingsPatched?: boolean;
  permissionPromptAt?: number;
  permissionRespondedAt?: number;
  pendingPermission?: PendingPermissionInfo;
  pendingQuestion?: PendingQuestionInfo;
  promptDelivery?: { delivered: boolean; attempts: number };
  actionHints?: Record<string, {
    method: string;
    url: string;
    description: string;
  }>;
  ownerKeyId?: string;
  tenantId?: string;
}

export interface SessionHealth {
  alive: boolean;
  windowExists: boolean;
  claudeRunning: boolean;
  paneCommand: string | null;
  status: UIState;
  hasTranscript: boolean;
  lastActivity: number;
  lastActivityAgo: number;
  sessionAge: number;
  details: string;
  actionHints?: Record<string, {
    method: string;
    url: string;
    description: string;
  }>;
}

export interface HealthResponse {
  status: string;
  version: string;
  platform: NodeJS.Platform;
  uptime: number;
  sessions: {
    active: number;
    total: number;
  };
  tmux?: {
    healthy: boolean;
    error: string | null;
  };
  claude?: {
    available: boolean;
    healthy: boolean;
    version: string | null;
    minimumVersion: string;
    error: string | null;
  };
  timestamp: string;
}

export interface ParsedEntry {
  role: 'user' | 'assistant' | 'system';
  contentType: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'tool_error' | 'permission_request' | 'progress';
  text: string;
  toolName?: string;
  toolUseId?: string;
  timestamp?: string;
}

export interface MessagesResponse {
  messages: ParsedEntry[];
  status: UIState;
  statusText: string | null;
  interactiveContent: string | null;
}

export interface SessionMetrics {
  durationSec: number;
  messages: number;
  toolCalls: number;
  approvals: number;
  autoApprovals: number;
  statusChanges: string[];
  /** Issue #488: Cumulative token usage and estimated cost. Present once tokens are first observed. */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    estimatedCostUsd: number;
  };
}

export interface LatencySummaryStat {
  min: number | null;
  max: number | null;
  avg: number | null;
  count: number;
}

export interface SessionLatency {
  sessionId: string;
  realtime: {
    hook_latency_ms: number | null;
    state_change_detection_ms: number | null;
    permission_response_ms: number | null;
  } | null;
  aggregated: {
    hook_latency_ms: LatencySummaryStat;
    state_change_detection_ms: LatencySummaryStat;
    permission_response_ms: LatencySummaryStat;
    channel_delivery_ms: LatencySummaryStat;
  } | null;
}

export interface GlobalMetrics {
  uptime: number;
  sessions: {
    total_created: number;
    currently_active: number;
    completed: number;
    failed: number;
    avg_duration_sec: number;
    avg_messages_per_session: number;
  };
  auto_approvals: number;
  webhooks_sent: number;
  webhooks_failed: number;
  screenshots_taken: number;
  pipelines_created: number;
  batches_created: number;
  prompt_delivery: {
    sent: number;
    delivered: number;
    failed: number;
    success_rate: number | null;
  };
  latency: {
    hook_latency_ms: LatencySummaryStat;
    state_change_detection_ms: LatencySummaryStat;
    permission_response_ms: LatencySummaryStat;
    channel_delivery_ms: LatencySummaryStat;
  };
}

export type SSEEventType =
  | 'connected'
  | 'status'
  | 'message'
  | 'approval'
  | 'ended'
  | 'heartbeat'
  | 'stall'
  | 'dead'
  | 'system'
  | 'hook'
  | 'subagent_start'
  | 'subagent_stop'
  | 'verification'
  | 'permission_denied';

export interface SessionSSEEvent {
  event: SSEEventType;
  sessionId: string;
  timestamp: string;
  emittedAt?: number;
  id?: number;
  data?: Record<string, unknown>;
}

export type GlobalSSEEventType =
  | 'session_status_change'
  | 'session_message'
  | 'session_approval'
  | 'session_ended'
  | 'session_created'
  | 'session_stall'
  | 'session_dead'
  | 'session_subagent_start'
  | 'session_subagent_stop'
  | 'session_verification'
  /** Issue #1911: Emitted to all global SSE subscribers during graceful shutdown. */
  | 'shutdown';

export interface GlobalSSEEvent {
  event: GlobalSSEEventType;
  sessionId: string;
  timestamp: string;
  id?: number;
  data: Record<string, unknown>;
}

export interface CreateSessionRequest {
  workDir: string;
  name?: string;
  prompt?: string;
  prd?: string;
  resumeSessionId?: string;
  claudeCommand?: string;
  env?: Record<string, string>;
  stallThresholdMs?: number;
  permissionMode?: string;
  autoApprove?: boolean;
  parentId?: string;
  memoryKeys?: string[];
}

export interface PaneResponse {
  pane: string;
}

export interface SessionSummary {
  sessionId: string;
  windowName: string;
  status: UIState;
  totalMessages: number;
  messages: Array<{ role: string; contentType: string; text: string }>;
  createdAt: number;
  lastActivity: number;
  permissionMode: string;
  prd?: string;
}

export interface OkResponse {
  ok: boolean;
}

export interface SendResponse extends OkResponse {
  delivered: boolean;
  attempts: number;
}

export type ApiKeyRole = 'viewer' | 'operator' | 'admin';
export type ApiKeyPermission = ServiceApiKeyPermission;

export interface AuthKeySummary {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
  rateLimit: number;
  expiresAt: number | null;
  role: ApiKeyRole;
  /** Per-action permissions. Optional for backward compat with servers that return role-only keys. */
  permissions?: ApiKeyPermission[];
}

export interface CreatedAuthKey {
  id: string;
  key: string;
  name: string;
  expiresAt: number | null;
  role: ApiKeyRole;
  permissions: ApiKeyPermission[];
}

export interface VerifyTokenRequest {
  token: string;
}

export interface VerifyTokenResponse {
  valid: boolean;
  role?: ApiKeyRole;
}

export interface ApiError {
  error: string;
}

export interface SessionsListResponse {
  sessions: SessionInfo[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type SessionStatusCounts = Record<SessionStatusFilter, number>;

/** Issue #754: Aggregated session statistics. */
export interface SessionStats {
  active: number;
  byStatus: Partial<Record<UIState, number>>;
  totalCreated: number;
  totalCompleted: number;
  totalFailed: number;
}

/** Issue #754: Bulk-delete request body. */
export interface BatchDeleteRequest {
  ids?: string[];
  status?: UIState;
}

/** Issue #754: Bulk-delete response. */
export interface BatchDeleteResponse {
  deleted: number;
  notFound: string[];
  errors: string[];
}

// ── Analytics (Issue #1970) ──────────────────────────────────────────

/** Issue #1970: Daily session volume bucket. */
export interface AnalyticsSessionVolume {
  date: string;
  created: number;
}

/** Issue #1970: Token usage and cost aggregated by model. */
export interface AnalyticsModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}

/** Issue #1970: Daily cost bucket. */
export interface AnalyticsCostTrend {
  date: string;
  cost: number;
  sessions: number;
}

/** Issue #1970: API key usage stats. */
export interface AnalyticsKeyUsage {
  keyId: string;
  keyName: string;
  sessions: number;
  messages: number;
  estimatedCostUsd: number;
}

/** Issue #1970: Daily average duration. */
export interface AnalyticsDurationTrend {
  date: string;
  avgDurationSec: number;
  count: number;
}

/** Issue #1970: Error and permission stats. */
export interface AnalyticsErrorRates {
  totalSessions: number;
  failedSessions: number;
  failureRate: number;
  permissionPrompts: number;
  approvals: number;
  autoApprovals: number;
}

/** Issue #1970: Aggregated analytics summary. */
export interface AnalyticsSummary {
  sessionVolume: AnalyticsSessionVolume[];
  tokenUsageByModel: AnalyticsModelUsage[];
  costTrends: AnalyticsCostTrend[];
  topApiKeys: AnalyticsKeyUsage[];
  durationTrends: AnalyticsDurationTrend[];
  errorRates: AnalyticsErrorRates;
  generatedAt: string;
}

/** Issue #2087: Aggregate metrics response types */
export interface AggregateMetricsTimePoint {
  timestamp: string;
  sessions: number;
  messages: number;
  toolCalls: number;
  tokenCostUsd: number;
}

export interface AggregateMetricsByKey {
  keyId: string;
  keyName: string;
  sessions: number;
  messages: number;
  toolCalls: number;
  tokenCostUsd: number;
}

export interface AggregateMetricsAnomaly {
  sessionId: string;
  tokenCostUsd: number;
  reason: string;
}

export interface AggregateMetricsResponse {
  summary: {
    totalSessions: number;
    avgDurationSeconds: number;
    totalTokenCostUsd: number;
    totalMessages: number;
    totalToolCalls: number;
    permissionsApproved: number;
    permissionApprovalRate: number | null;
    stalls: number;
  };
  timeSeries: AggregateMetricsTimePoint[];
  byKey: AggregateMetricsByKey[];
  anomalies: AggregateMetricsAnomaly[];
}
