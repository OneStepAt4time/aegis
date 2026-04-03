import type { SessionInfo as InternalSessionInfo, SessionManager } from './session.js';
import type { MetricsCollector, SessionLatencySummary } from './metrics.js';
import type {
  SessionSSEEvent as InternalSessionSSEEvent,
  GlobalSSEEvent as InternalGlobalSSEEvent,
} from './events.js';
import type {
  SessionInfo,
  MessagesResponse,
  SessionSummary,
  SessionMetrics,
  SessionLatency,
  GlobalMetrics,
  SessionSSEEvent,
  GlobalSSEEvent,
} from './api-contracts.js';

type Assert<T extends true> = T;

export type SessionInfoContractCompat = Assert<InternalSessionInfo extends SessionInfo ? true : false>;
export type SessionReadMessagesContractCompat = Assert<
  Awaited<ReturnType<SessionManager['readMessages']>> extends MessagesResponse ? true : false
>;
export type SessionSummaryContractCompat = Assert<
  Awaited<ReturnType<SessionManager['getSummary']>> extends SessionSummary ? true : false
>;
export type SessionMetricsContractCompat = Assert<
  NonNullable<ReturnType<MetricsCollector['getSessionMetrics']>> extends SessionMetrics ? true : false
>;
export type SessionLatencySummaryContractCompat = Assert<
  SessionLatencySummary extends NonNullable<SessionLatency['aggregated']> ? true : false
>;
export type GlobalMetricsContractCompat = Assert<
  ReturnType<MetricsCollector['getGlobalMetrics']> extends GlobalMetrics ? true : false
>;
export type SessionSSEContractCompat = Assert<InternalSessionSSEEvent extends SessionSSEEvent ? true : false>;
export type GlobalSSEContractCompat = Assert<InternalGlobalSSEEvent extends GlobalSSEEvent ? true : false>;