/**
 * api-contracts.ts — Shared API contract types for backend and dashboard.
 *
 * Keep this file runtime-free (types only) so both packages can import it
 * without bundling backend implementation code into the frontend.
 */

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

export interface HealthResponse {
  status: string;
  version: string;
  uptime: number;
  sessions: {
    active: number;
    total: number;
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
  | 'verification';

export interface SessionSSEEvent {
  event: SSEEventType;
  sessionId: string;
  timestamp: string;
  emittedAt?: number;
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
  data: Record<string, unknown>;
}

export interface CreateSessionRequest {
  workDir: string;
  name?: string;
  prompt?: string;
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