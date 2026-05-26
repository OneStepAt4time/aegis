/**
 * api/sessions.ts — Session CRUD, actions, messages, health, metrics, pane.
 */

import type {
  SessionInfo,
  SessionHealth,
  MessagesResponse,
  SessionMetrics,
  SessionLatency,
  PaneResponse,
  SessionSummary,
  OkResponse,
  SendResponse,
  CreateSessionRequest,
  UIState,
  SessionStatusCounts,
  SessionStats,
  SessionsListResponse,
} from '../types';
import {
  SessionInfoSchema,
  SendResponseSchema,
  OkResponseSchema,
  SessionStatsSchema,
  SessionsListResponseSchema,
  SessionHealthSchema,
  SessionMetricsSchema,
  SessionLatencySchema,
  SessionMessagesSchema,
  AllSessionsHealthSchema,
} from './schemas';
import { request, SESSION_STATUS_VALUES } from './base';

// ── Sessions List ──────────────────────────────────────────────

export interface GetSessionsOptions {
  page?: number;
  limit?: number;
  status?: UIState;
}

export function getSessions(options: GetSessionsOptions = {}): Promise<SessionsListResponse> {
  const params = new URLSearchParams();
  if (options.page !== undefined) params.set('page', String(options.page));
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.status) params.set('status', options.status);

  const query = params.toString();
  const path = query ? `/v1/sessions?${query}` : '/v1/sessions';

  return request(path, { schema: SessionsListResponseSchema, schemaContext: 'getSessions' });
}

export async function getSessionStatusCounts(): Promise<SessionStatusCounts> {
  const stats = await request<SessionStats>('/v1/sessions/stats', {
    schema: SessionStatsSchema,
    schemaContext: 'getSessionStatusCounts',
  });

  const counts: SessionStatusCounts = {
    all: stats.total ?? stats.active,
    idle: 0,
    working: 0,
    compacting: 0,
    context_warning: 0,
    waiting_for_input: 0,
    permission_prompt: 0,
    plan_mode: 0,
    ask_question: 0,
    bash_approval: 0,
    settings: 0,
    error: 0,
    rate_limit: 0,
    pending: 0,
    unknown: 0,
    killed: 0,
    completed: 0,
    awaiting_approval: 0,
    crashed: 0,
  };

  SESSION_STATUS_VALUES.forEach((status) => {
    counts[status] = stats.byStatus[status] ?? 0;
  });

  return counts;
}

export function getSession(id: string): Promise<SessionInfo> {
  return request(`/v1/sessions/${encodeURIComponent(id)}`, { schema: SessionInfoSchema, schemaContext: 'getSession' });
}

export function createSession(opts: CreateSessionRequest & { signal?: AbortSignal }): Promise<SessionInfo> {
  const { signal, ...body } = opts;
  return request('/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
    schema: SessionInfoSchema,
    schemaContext: 'createSession',
  });
}

/**
 * Resilient session creation: wraps createSession with a fallback.
 * If the API returns a malformed response (Zod validation failure) or a
 * response missing a session ID, refetches the sessions list and returns
 * the most recently created session.
 * Defensive fix for #3738.
 */
export async function createSessionWithFallback(opts: CreateSessionRequest & { signal?: AbortSignal }): Promise<SessionInfo> {
  try {
    const session = await createSession(opts);
    if (session?.id) return session;
  } catch (err) {
    // Only attempt fallback on validation errors or missing-id responses.
    // Re-throw auth errors, network errors, and HTTP 4xx/5xx immediately.
    const msg = err instanceof Error ? err.message : '';
    const isValidation = msg.includes('API response validation failed');
    const isNoId = msg.includes('session info could not be retrieved');
    if (!isValidation && !isNoId) throw err;
  }
  // Fallback: refetch sessions list and return the newest
  const list = await getSessions({ limit: 1 });
  if (list.sessions.length > 0) return list.sessions[0];
  throw new Error('Session was created but session info could not be retrieved');
}

export function killSession(id: string): Promise<OkResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    schema: OkResponseSchema,
    schemaContext: 'killSession',
  });
}

// ── Session Health ──────────────────────────────────────────────

export function getSessionHealth(id: string): Promise<SessionHealth> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/health`, {
    schema: SessionHealthSchema,
    schemaContext: 'getSessionHealth',
  });
}

// #128: Fetch health for all sessions in one request (avoids N+1)
export function getAllSessionsHealth(): Promise<Record<string, SessionHealth>> {
  return request('/v1/sessions/health', {
    schema: AllSessionsHealthSchema,
    schemaContext: 'getAllSessionsHealth',
  });
}

// ── Session Messages ────────────────────────────────────────────

export function getSessionMessages(id: string): Promise<MessagesResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/read`, {
    schema: SessionMessagesSchema,
    schemaContext: 'getSessionMessages',
  });
}

// ── Session Metrics ─────────────────────────────────────────────

export function getSessionMetrics(id: string): Promise<SessionMetrics> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/metrics`, {
    schema: SessionMetricsSchema,
    schemaContext: 'getSessionMetrics',
  });
}

export function getSessionLatency(id: string): Promise<SessionLatency> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/latency`, {
    schema: SessionLatencySchema,
    schemaContext: 'getSessionLatency',
  });
}

// ── Session Pane ────────────────────────────────────────────────

export function getSessionPane(id: string, terminalId?: string): Promise<PaneResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/terminal/content${terminalId ? `?terminalId=${encodeURIComponent(terminalId)}` : ''}`).then((res) => ({ pane: (res as { content: string }).content }));
}

// ── Actions ─────────────────────────────────────────────────────

export function sendMessage(id: string, text: string): Promise<SendResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/send`, {
    method: 'POST',
    body: JSON.stringify({ text }),
    schema: SendResponseSchema,
    schemaContext: 'sendMessage',
  });
}

/** Issue #4193: Quick approve via dedicated permission endpoint (richer audit trail). */
export function quickApprove(id: string, opts?: { approverId?: string }): Promise<OkResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/permission/approve`, {
    method: 'POST',
    body: JSON.stringify({ approverId: opts?.approverId }),
  });
}

/** Legacy approve — kept for backward compatibility with Telegram one-tap flow. */
export function approve(id: string): Promise<OkResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
  });
}

/** Issue #4193: Quick reject via dedicated permission endpoint (richer audit trail with reason). */
export function quickReject(id: string, opts?: { reason?: string }): Promise<OkResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/permission/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason: opts?.reason }),
  });
}

/** Legacy reject — kept for backward compatibility with Telegram one-tap flow. */
export function reject(id: string): Promise<OkResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
  });
}

/** Session-level approval (Telegram one-tap flow) */
export function sessionApprove(id: string): Promise<OkResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/session-approve`, {
    method: "POST",
  });
}

/** Session-level rejection (Telegram one-tap flow) */
export function sessionReject(id: string): Promise<OkResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/session-reject`, {
    method: "POST",
  });
}

export function interrupt(id: string): Promise<OkResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/interrupt`, {
    method: 'POST',
  });
}

export function escape(id: string): Promise<OkResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/escape`, {
    method: 'POST',
  });
}

// Issue #468: Fork session
interface ForkSessionRequest {
  name?: string;
  prompt?: string;
}

export function forkSession(id: string, opts: ForkSessionRequest = {}): Promise<SessionInfo & { forkedFrom: string }> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/fork`, {
    method: 'POST',
    body: JSON.stringify(opts),
    schema: SessionInfoSchema,
    schemaContext: 'forkSession',
  });
}

// ── Summary ─────────────────────────────────────────────────────

export function getSessionSummary(id: string): Promise<SessionSummary> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/summary`);
}

// ── Slash Commands ──────────────────────────────────────────────

export function sendCommand(id: string, command: string): Promise<SendResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/command`, {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
}

// ── Screenshot ─────────────────────────────────────────────────

export function getScreenshot(id: string): Promise<{ image: string; mimeType?: string }> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/screenshot`, {
    method: 'POST',
  });
}

// ── Batch ──────────────────────────────────────────────────────

export interface BatchResult {
  sessions: Array<{ id: string; name: string; promptDelivery?: { delivered: boolean; attempts: number; status?: 'pending' | 'delivered' | 'failed' | 'timeout' } }>;
  created: number;
  failed: number;
  errors: string[];
}

export function batchCreateSessions(opts: { sessions: CreateSessionRequest[]; signal?: AbortSignal }): Promise<BatchResult> {
  const { signal, ...body } = opts;
  return request('/v1/sessions/batch', {
    method: 'POST',
    signal,
    body: JSON.stringify(body),
  });
}
