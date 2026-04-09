/**
 * @aegis/client — Official TypeScript client for Aegis Bridge.
 *
 * @example
 * import { AegisClient, type SessionInfo } from '@aegis/client';
 *
 * const client = new AegisClient('http://localhost:18792', 'your-token');
 * const sessions = await client.listSessions();
 */

export { AegisClient, type AegisClientOptions } from './AegisClient.js';
export type {
  // Session
  SessionInfo,
  SessionHealth,
  SessionSummary,
  SessionMetrics,
  SessionLatency,
  MessagesResponse,
  ParsedEntry,
  CreateSessionRequest,
  OkResponse,
  SendResponse,
  PaneResponse,
  // Server
  HealthResponse,
  GlobalMetrics,
  // Pagination
  SessionsListResponse,
  SessionStatusCounts,
  SessionStats,
  // Batch
  BatchResult,
  BatchDeleteRequest,
  BatchDeleteResponse,
  // Pipeline
  PipelineState,
  // Memory
  MemoryEntryResponse,
  // SSE
  SSEEventType,
  SessionSSEEvent,
  GlobalSSEEventType,
  GlobalSSEEvent,
  // Metrics
  LatencySummaryStat,
  // Audit
  AuditRecord,
  AuditPageResponse,
  // Shared
  UIState,
  SessionStatusFilter,
  ApiError,
} from './types.js';
