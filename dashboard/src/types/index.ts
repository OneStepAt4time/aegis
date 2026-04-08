/**
 * types/index.ts — Dashboard-facing types.
 *
 * API contract types are re-exported from src/api-contracts.ts so backend and
 * dashboard read the same source of truth.
 */

export type {
  UIState,
  SessionStatusFilter,
  SessionInfo,
  SessionHealth,
  SessionStats,
  HealthResponse,
  ParsedEntry,
  MessagesResponse,
  SessionMetrics,
  LatencySummaryStat,
  SessionLatency,
  GlobalMetrics,
  SSEEventType,
  SessionSSEEvent,
  GlobalSSEEventType,
  GlobalSSEEvent,
  CreateSessionRequest,
  PaneResponse,
  SessionSummary,
  OkResponse,
  SendResponse,
  ApiError,
  SessionsListResponse,
  SessionStatusCounts,
  BatchDeleteRequest,
  BatchDeleteResponse,
} from '../../../src/api-contracts';

// ── Audit Trail ─────────────────────────────────────────────────

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

// ── Session Templates ───────────────────────────────────────────

export interface SessionTemplate {
  id: string;
  name: string;
  description?: string;
  workDir: string;
  prompt?: string;
  claudeCommand?: string;
  env?: Record<string, string>;
  stallThresholdMs?: number;
  permissionMode?: string;
  autoApprove?: boolean;
  parentId?: string;
  memoryKeys?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface RowHealth {
  alive: boolean;
  loading: boolean;
}

// ── WebSocket Terminal Messages ─────────────────────────────────

export interface WsPaneMessage {
  type: 'pane';
  content: string;
}

export interface WsStatusMessage {
  type: 'status';
  status: string;
}

export interface WsErrorMessage {
  type: 'error';
  message: string;
}

export type WsInboundMessage = WsPaneMessage | WsStatusMessage | WsErrorMessage;

export interface WsInputMessage {
  type: 'input';
  text: string;
}

export interface WsResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

export type WsOutboundMessage = WsInputMessage | WsResizeMessage;

