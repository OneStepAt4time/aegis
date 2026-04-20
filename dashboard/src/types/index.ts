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
  ApiKeyPermission,
  ApiKeyRole,
  AuthKeySummary,
  CreatedAuthKey,
  VerifyTokenRequest,
  VerifyTokenResponse,
  ApiError,
  SessionsListResponse,
  SessionStatusCounts,
  PendingPermissionInfo,
  PendingQuestionInfo,
  BatchDeleteRequest,
  BatchDeleteResponse,
} from '../../../src/api-contracts';

// ── Audit Trail ─────────────────────────────────────────────────

export interface AuditRecord {
  /** ISO 8601 timestamp — field name matches backend `ts` */
  ts: string;
  actor: string;
  action: string;
  sessionId?: string;
  detail: string;
  prevHash: string;
  hash: string;
}

export interface AuditFilters {
  actor?: string;
  action?: string;
  sessionId?: string;
  from?: string;
  to?: string;
}

export interface AuditPagination {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  reverse: boolean;
}

export interface AuditChainMetadata {
  count: number;
  firstHash: string | null;
  lastHash: string | null;
  badgeHash: string | null;
  firstTs: string | null;
  lastTs: string | null;
}

export interface AuditIntegrityMetadata {
  valid: boolean;
  brokenAt?: number;
  file?: string;
}

export interface AuditPageResponse {
  count: number;
  records: AuditRecord[];
  total: number;
  filters: AuditFilters;
  pagination: AuditPagination;
  chain: AuditChainMetadata;
  integrity?: AuditIntegrityMetadata;
}

// ── Users & Session History ────────────────────────────────────

export interface UserSummary {
  id: string;
  name: string;
  role: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number | null;
  rateLimit: number;
  activeSessions: number;
  totalSessionsCreated: number;
  lastSessionAt: number | null;
}

export interface UsersResponse {
  count: number;
  users: UserSummary[];
}

export interface SessionHistoryRecord {
  id: string;
  ownerKeyId?: string;
  createdAt?: number;
  endedAt?: number;
  lastSeenAt: number;
  finalStatus: 'active' | 'killed' | 'unknown';
  source: 'audit' | 'live' | 'audit+live';
}

export interface SessionHistoryResponse {
  records: SessionHistoryRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
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

