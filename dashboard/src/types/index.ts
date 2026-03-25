/**
 * types/index.ts — Aegis API type definitions.
 *
 * Mirrors the backend types from session.ts, metrics.ts, events.ts, and server.ts.
 */

// ── Session ─────────────────────────────────────────────────────

export type UIState =
  | 'idle'
  | 'working'
  | 'permission_prompt'
  | 'plan_mode'
  | 'ask_question'
  | 'bash_approval'
  | 'settings'
  | 'unknown';

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
  autoApprove: boolean;
  settingsPatched?: boolean;
  promptDelivery?: { delivered: boolean; attempts: number };
  actionHints?: Record<string, {
    method: string;
    url: string;
    description: string;
  }>;
}

// ── Health ──────────────────────────────────────────────────────

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

// ── Messages ────────────────────────────────────────────────────

export interface ParsedEntry {
  role: 'user' | 'assistant' | 'system';
  contentType: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'permission_request';
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

// ── Metrics ─────────────────────────────────────────────────────

export interface SessionMetrics {
  durationSec: number;
  messages: number;
  toolCalls: number;
  approvals: number;
  autoApprovals: number;
  statusChanges: string[];
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
}

// ── SSE Events ──────────────────────────────────────────────────

export type SSEEventType = 'status' | 'message' | 'approval' | 'ended' | 'heartbeat' | 'connected';

export interface SessionSSEEvent {
  event: SSEEventType;
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ── Global SSE Events ──────────────────────────────────────────

export type GlobalSSEEventType =
  | 'session_status_change'
  | 'session_message'
  | 'session_approval'
  | 'session_ended'
  | 'session_created';

export interface GlobalSSEEvent {
  event: GlobalSSEEventType;
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ── Create Session ──────────────────────────────────────────────

export interface CreateSessionRequest {
  workDir: string;
  name?: string;
  prompt?: string;
  resumeSessionId?: string;
  claudeCommand?: string;
  env?: Record<string, string>;
  stallThresholdMs?: number;
  autoApprove?: boolean;
}

// ── Pane ────────────────────────────────────────────────────────

export interface PaneResponse {
  pane: string;
}

// ── Summary ─────────────────────────────────────────────────────

export interface SessionSummary {
  sessionId: string;
  windowName: string;
  status: UIState;
  totalMessages: number;
  messages: Array<{ role: string; contentType: string; text: string }>;
  createdAt: number;
  lastActivity: number;
  autoApprove: boolean;
}

// ── Simple OK response ──────────────────────────────────────────

export interface OkResponse {
  ok: boolean;
}

export interface SendResponse extends OkResponse {
  delivered: boolean;
  attempts: number;
}

// ── API Error ───────────────────────────────────────────────────

export interface ApiError {
  error: string;
}
