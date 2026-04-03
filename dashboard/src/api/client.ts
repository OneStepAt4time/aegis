/**
 * api/client.ts — Aegis API client.
 *
 * Typed fetch wrapper for all Aegis v1 endpoints.
 * Reads Bearer token from localStorage on every request.
 */

import { z } from 'zod';

import type {
  HealthResponse,
  GlobalMetrics,
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
  GlobalSSEEvent,
  SessionsListResponse,
  SessionStatusCounts,
  UIState,
  ApiError,
} from '../types';
import {
  AuthKeySummarySchema,
  CreatedAuthKeySchema,
  HealthResponseSchema,
  SessionInfoSchema,
  SendResponseSchema,
  OkResponseSchema,
  SessionsListResponseSchema,
  SessionHealthSchema,
  SessionMetricsSchema,
  SessionLatencySchema,
  SessionMessagesSchema,
  GlobalMetricsSchema,
  GlobalSSEEventSchema,
} from './schemas';
const BASE_URL = import.meta.env.VITE_AEGIS_URL ?? '';
const SESSION_STATUS_VALUES: UIState[] = [
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
];

// ── Helpers ──────────────────────────────────────────────────────

function headersToObject(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) {
    const obj: Record<string, string> = {};
    h.forEach((v, k) => { obj[k] = v; });
    return obj;
  }
  return h as Record<string, string>;
}

// ── Runtime validation (defensive, non-blocking) ─────────────────

/**
 * Validates raw API data against a Zod schema.
 * On mismatch, throws an Error with validation failure details.
 */
function validateResponse<T>(data: unknown, schema: z.ZodType<T>, context: string): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  console.error(`[aegis] API response validation failed (${context}):`, result.error.issues);
  throw new Error(`API response validation failed for ${context}: ${result.error.issues.map(i => i.message).join(', ')}`);
}

// ── Error classification ────────────────────────────────────────

/** Returns true if the error is a transient failure worth retrying. */
export function isRetryableError(error: Error): boolean {
  if (error.name === 'AbortError') return false;
  if (!error.message) return false;
  if (error.message.includes('HTTP ')) return false;
  return true;
}

// ── Fetch wrapper ───────────────────────────────────────────────

interface RequestOptions extends RequestInit {
  /** AbortSignal for request cancellation (e.g., from useEffect cleanup) */
  signal?: AbortSignal;
  /** Number of retry attempts for transient failures (default: 0, no retry) */
  retries?: number;
  /** Optional Zod schema for runtime response validation (defensive, non-blocking) */
  schema?: z.ZodType<unknown>;
  /** Label for validation warnings (used with schema) */
  schemaContext?: string;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const token = localStorage.getItem('aegis_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headersToObject(options.headers),
  };

  const { retries = 0, schema, schemaContext, ...fetchOptions } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, { ...fetchOptions, headers });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
        const err = new Error(body.error ?? `HTTP ${res.status}`) as Error & { statusCode: number };
        err.statusCode = res.status;
        throw err;
      }
      const data = await res.json();
      if (schema) return validateResponse(data, schema as z.ZodType<T>, schemaContext ?? path);
      return data as T;
    } catch (e) {
      lastError = e as Error;
      // Retry only on transient network errors (not HTTP errors or AbortError)
      if (attempt < retries && isRetryableError(lastError)) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      } else {
        throw lastError;
      }
    }
  }
  throw lastError;
  // Error handling moved into retry loop above
}

// ── Health ──────────────────────────────────────────────────────

export function getHealth(): Promise<HealthResponse> {
  return request('/v1/health', { schema: HealthResponseSchema, schemaContext: 'getHealth' });
}

// ── Metrics ─────────────────────────────────────────────────────

export function getMetrics(): Promise<GlobalMetrics> {
  return request('/v1/metrics', { schema: GlobalMetricsSchema, schemaContext: 'getMetrics' });
}

// ── Sessions ────────────────────────────────────────────────────

// TODO(#248): Server supports pagination (limit/offset query params) but client doesn't use it yet.
//            Add pagination params here when the dashboard needs to handle large session lists.
interface GetSessionsOptions {
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
  const counts: Partial<SessionStatusCounts> = { all: 0 };

  const [allSessions, ...statusResults] = await Promise.all([
    getSessions({ page: 1, limit: 1 }),
    ...SESSION_STATUS_VALUES.map((status) => getSessions({ page: 1, limit: 1, status })),
  ]);

  counts.all = allSessions.pagination.total;
  SESSION_STATUS_VALUES.forEach((status, index) => {
    counts[status] = statusResults[index]?.pagination.total ?? 0;
  });

  return counts as SessionStatusCounts;
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
  return request('/v1/sessions/health');
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

export function getSessionPane(id: string): Promise<PaneResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/pane`);
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

export function approve(id: string): Promise<OkResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
  });
}

export function reject(id: string): Promise<OkResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
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

// ── SSE ─────────────────────────────────────────────────────────

import { ResilientEventSource } from './resilient-eventsource';

// #408: Retry SSE token creation with exponential backoff instead of
// falling back to the long-lived bearer token, which defeats short-lived token security.
const SSE_TOKEN_MAX_RETRIES = 3;
const SSE_TOKEN_BASE_DELAY_MS = 1000;

async function createSSETokenWithRetry(
  onGiveUp?: () => void,
  signal?: AbortSignal,
): Promise<SSETokenResponse> {
  for (let attempt = 0; attempt < SSE_TOKEN_MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await createSSEToken(signal);
    } catch { /* SSE token creation failed — retry with backoff */
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (attempt < SSE_TOKEN_MAX_RETRIES - 1) {
        const delay = SSE_TOKEN_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, delay);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve(undefined);
          }, { once: true });
        });
      }
    }
  }
  onGiveUp?.();
  throw new Error('Real-time updates unavailable');
}

/**
 * Subscribe to Server-Sent Events for a session.
 * Returns an unsubscribe function.
 *
 * #408: If a bearer token is provided, fetches a short-lived SSE token first
 * to avoid exposing the long-lived bearer token in the URL query parameter.
 * Retries SSE token creation with exponential backoff on failure.
 * If all retries fail, real-time updates are unavailable (no bearer fallback).
 */
export function subscribeSSE(
  sessionId: string,
  handler: (event: MessageEvent) => void,
  token?: string | null,
  callbacks?: { onReconnecting?: (attempt: number, delay: number) => void; onGiveUp?: () => void; onOpen?: () => void; onClose?: () => void },
): () => void {
  const basePath = `/v1/sessions/${encodeURIComponent(sessionId)}/events`;

  let resilient: ResilientEventSource | null = null;
  let closed = false;
  const abortController = new AbortController();

  if (token) {
    // #408: Retry SSE token creation — never fall back to bearer token
    createSSETokenWithRetry(callbacks?.onGiveUp, abortController.signal)
      .then((sseToken) => {
        if (closed) return;
        const url = `${basePath}?token=${encodeURIComponent(sseToken.token)}`;
        resilient = new ResilientEventSource(url, handler, callbacks);
      })
      .catch(() => {
        // All retries exhausted or aborted — do NOT fall back to bearer token (#408)
      });
  } else {
    // No auth needed
    resilient = new ResilientEventSource(basePath, handler, callbacks);
  }

  return () => {
    closed = true;
    abortController.abort();
    resilient?.close();
  };
}

/**
 * Subscribe to global SSE events (all sessions).
 * Returns an unsubscribe function.
 *
 * #408: If a bearer token is provided, fetches a short-lived SSE token first
 * to avoid exposing the long-lived bearer token in the URL query parameter.
 * Retries SSE token creation with exponential backoff on failure.
 * If all retries fail, real-time updates are unavailable (no bearer fallback).
 */
export function subscribeGlobalSSE(
  handler: (event: GlobalSSEEvent) => void,
  token?: string | null,
  callbacks?: { onOpen?: () => void; onClose?: () => void; onReconnecting?: (attempt: number, delay: number) => void; onGiveUp?: () => void },
): () => void {
  const basePath = '/v1/events';

  let resilient: ResilientEventSource | null = null;
  let closed = false;
  const abortController = new AbortController();

  const wrappedHandler = (e: MessageEvent) => {
    try {
      const result = GlobalSSEEventSchema.safeParse(JSON.parse(e.data as string));
      if (!result.success) {
        console.warn('Global SSE event failed validation', result.error.message);
        return;
      }
      handler(result.data as GlobalSSEEvent);
    } catch {
      // ignore malformed events
    }
  };

  if (token) {
    // #408: Retry SSE token creation — never fall back to bearer token
    createSSETokenWithRetry(callbacks?.onGiveUp, abortController.signal)
      .then((sseToken) => {
        if (closed) return;
        const url = `${basePath}?token=${encodeURIComponent(sseToken.token)}`;
        resilient = new ResilientEventSource(url, wrappedHandler, callbacks);
      })
      .catch(() => {
        // All retries exhausted or aborted — do NOT fall back to bearer token (#408)
      });
  } else {
    resilient = new ResilientEventSource(basePath, wrappedHandler, callbacks);
  }

  return () => {
    closed = true;
    abortController.abort();
    callbacks?.onClose?.();
    resilient?.close();
  };
}

// ── Slash Commands & Bash ──────────────────────────────────────

export function sendCommand(id: string, command: string): Promise<SendResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/command`, {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
}

export function sendBash(id: string, command: string): Promise<SendResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/bash`, {
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
  sessions: Array<{ id: string; name: string; promptDelivery?: { delivered: boolean; attempts: number } }>;
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

// ── Pipelines ──────────────────────────────────────────────────

export interface PipelineRequest {
  name: string;
  workDir: string;
  stages: { workDir: string; name?: string; prompt?: string }[];
}

export interface PipelineStageInfo {
  name: string;
  status: string;
  sessionId?: string;
  dependsOn?: string[];
}

export interface PipelineInfo {
  id: string;
  name: string;
  status: string;
  stages: PipelineStageInfo[];
  createdAt: number;
}

export function createPipeline(opts: PipelineRequest): Promise<PipelineInfo> {
  return request('/v1/pipelines', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export function getPipelines(): Promise<PipelineInfo[]> {
  return request('/v1/pipelines');
}

export function getPipeline(id: string): Promise<PipelineInfo> {
  return request(`/v1/pipelines/${encodeURIComponent(id)}`);
}

// ── Auth Keys ──────────────────────────────────────────────────

// #297: Short-lived SSE token to avoid exposing long-lived bearer token in URL
export interface SSETokenResponse {
  token: string;
  expiresAt: number;
}

export function createSSEToken(signal?: AbortSignal): Promise<SSETokenResponse> {
  return request('/v1/auth/sse-token', { method: 'POST', signal });
}

// ── Auth Keys ──────────────────────────────────────────────────

export interface AuthKey {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
  rateLimit: number;
}

export interface CreatedAuthKey {
  id: string;
  name: string;
  key: string;
}

export function createAuthKey(name: string): Promise<CreatedAuthKey> {
  return request('/v1/auth/keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
    schema: CreatedAuthKeySchema,
    schemaContext: 'createAuthKey',
  });
}

export function getAuthKeys(): Promise<AuthKey[]> {
  return request('/v1/auth/keys', {
    schema: z.array(AuthKeySummarySchema),
    schemaContext: 'getAuthKeys',
  });
}

export function revokeAuthKey(id: string): Promise<OkResponse> {
  return request(`/v1/auth/keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    schema: OkResponseSchema,
    schemaContext: 'revokeAuthKey',
  });
}
