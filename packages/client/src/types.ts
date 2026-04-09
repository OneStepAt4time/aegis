/**
 * types.ts — Aegis API contract types.
 *
 * Shared type definitions for the Aegis HTTP API.
 * Import this in your application to get full type safety.
 *
 * @example
 * import { AegisClient, type SessionInfo, type UIState } from '@onestepat4time/aegis-client';
 *
 * const client = new AegisClient('http://localhost:18792', 'your-token');
 * const sessions = await client.listSessions();
 */

// ── Primitive & shared types ────────────────────────────────────────

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

// ── Session types ────────────────────────────────────────────────────

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
  promptDelivery?: { delivered: boolean; attempts: number };
  actionHints?: Record<string, {
    method: string;
    url: string;
    description: string;
  }>;
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

export interface PaneResponse {
  pane: string;
}

// ── Request/response bodies ─────────────────────────────────────────

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

export interface OkResponse {
  ok: boolean;
}

export interface SendResponse extends OkResponse {
  delivered: boolean;
  attempts: number;
}

export interface ApiError {
  error: string;
}

// ── Server health ───────────────────────────────────────────────────

export interface HealthResponse {
  status: string;
  version: string;
  platform: string;
  uptime: number;
  sessions: {
    active: number;
    total: number;
  };
  timestamp: string;
}

// ── Metrics ─────────────────────────────────────────────────────────

export interface LatencySummaryStat {
  min: number | null;
  max: number | null;
  avg: number | null;
  count: number;
}

export interface SessionMetrics {
  durationSec: number;
  messages: number;
  toolCalls: number;
  approvals: number;
  autoApprovals: number;
  statusChanges: string[];
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    estimatedCostUsd: number;
  };
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

// ── SSE events ─────────────────────────────────────────────────────

export type SSEEventType =
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
  data: Record<string, unknown>;
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
  | 'session_verification';

export interface GlobalSSEEvent {
  event: GlobalSSEEventType;
  sessionId: string;
  timestamp: string;
  id?: number;
  data: Record<string, unknown>;
}

// ── Pagination ─────────────────────────────────────────────────────

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

// ── Session stats ─────────────────────────────────────────────────

export interface SessionStats {
  active: number;
  byStatus: Partial<Record<UIState, number>>;
  totalCreated: number;
  totalCompleted: number;
  totalFailed: number;
}

// ── Batch operations ───────────────────────────────────────────────

export interface BatchDeleteRequest {
  ids?: string[];
  status?: UIState;
}

export interface BatchDeleteResponse {
  deleted: number;
  notFound: string[];
  errors: string[];
}

export interface BatchResult {
  sessions: Array<{
    id: string;
    name: string;
    promptDelivery?: { delivered: boolean; attempts: number };
  }>;
  created: number;
  failed: number;
  errors: string[];
}

// ── Pipeline ───────────────────────────────────────────────────────

export interface PipelineState {
  id: string;
  name: string;
  currentStage: 'plan' | 'execute' | 'verify' | 'fix' | 'submit' | 'done';
  status: 'running' | 'completed' | 'failed';
  retryCount: number;
  maxRetries: number;
  stageHistory: Array<{
    stage: string;
    enteredAt: number;
    exitedAt?: number;
  }>;
}

// ── Memory ────────────────────────────────────────────────────────

export interface MemoryEntryResponse {
  key: string;
  value: string;
  expiresAt?: number;
}

// ── Audit ─────────────────────────────────────────────────────────

export interface AuditRecord {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  sessionId?: string;
  detail?: string;
}

export interface AuditPageResponse {
  records: AuditRecord[];
  total: number;
  page: number;
  pageSize: number;
}
