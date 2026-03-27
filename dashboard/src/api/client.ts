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
  PaneResponse,
  SessionSummary,
  OkResponse,
  SendResponse,
  CreateSessionRequest,
  GlobalSSEEvent,
  SessionsListResponse,
  ApiError,
} from '../types';
import {
  HealthResponseSchema,
  SessionInfoSchema,
  SendResponseSchema,
  OkResponseSchema,
  SessionsListResponseSchema,
  SessionHealthSchema,
  SessionMetricsSchema,
} from './schemas';

const BASE_URL = import.meta.env.VITE_AEGIS_URL ?? '';

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
 * On mismatch, logs a warning and returns the raw data as-is.
 */
function validateResponse<T>(data: unknown, schema: z.ZodType<T>, context: string): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  console.warn(`[aegis] API validation warning (${context}):`, result.error.issues);
  return data as T;
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

// NOTE: unchecked — lower-criticality endpoint
export function getMetrics(): Promise<GlobalMetrics> {
  return request('/v1/metrics');
}

// ── Sessions ────────────────────────────────────────────────────

// TODO(#248): Server supports pagination (limit/offset query params) but client doesn't use it yet.
//            Add pagination params here when the dashboard needs to handle large session lists.
export function getSessions(): Promise<SessionsListResponse> {
  return request('/v1/sessions', { schema: SessionsListResponseSchema, schemaContext: 'getSessions' });
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

// NOTE: unchecked — lower-criticality endpoint
export function getSessionMessages(id: string): Promise<MessagesResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/read`);
}

// ── Session Metrics ─────────────────────────────────────────────

export function getSessionMetrics(id: string): Promise<SessionMetrics> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/metrics`, {
    schema: SessionMetricsSchema,
    schemaContext: 'getSessionMetrics',
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

// ── Summary ─────────────────────────────────────────────────────

export function getSessionSummary(id: string): Promise<SessionSummary> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/summary`);
}

// ── SSE ─────────────────────────────────────────────────────────

import { ResilientEventSource } from './resilient-eventsource';

/**
 * Subscribe to Server-Sent Events for a session.
 * Returns an unsubscribe function.
 */
export function subscribeSSE(
  sessionId: string,
  handler: (event: MessageEvent) => void,
  token?: string | null,
  callbacks?: { onReconnecting?: (attempt: number, delay: number) => void; onGiveUp?: () => void; onOpen?: () => void; onClose?: () => void },
): () => void {
  // #268: Use relative URL in dev so requests go through Vite proxy,
  // avoiding token leakage in absolute URLs
  const basePath = `/v1/sessions/${encodeURIComponent(sessionId)}/events`;
  const url = token ? `${basePath}?token=${encodeURIComponent(token)}` : basePath;

  const resilient = new ResilientEventSource(url, handler, callbacks);

  return () => {
    resilient.close();
  };
}

/**
 * Subscribe to global SSE events (all sessions).
 * Returns an unsubscribe function.
 */
export function subscribeGlobalSSE(
  handler: (event: GlobalSSEEvent) => void,
  token?: string | null,
  callbacks?: { onOpen?: () => void; onClose?: () => void; onReconnecting?: (attempt: number, delay: number) => void; onGiveUp?: () => void },
): () => void {
  // #268: Use relative URL in dev so requests go through Vite proxy
  const basePath = '/v1/events';
  const url = token ? `${basePath}?token=${encodeURIComponent(token)}` : basePath;

  const wrappedHandler = (e: MessageEvent) => {
    try {
      const parsed = JSON.parse(e.data as string) as GlobalSSEEvent;
      handler(parsed);
    } catch {
      // ignore malformed events
    }
  };

  const resilient = new ResilientEventSource(url, wrappedHandler, callbacks);

  return () => {
    callbacks?.onClose?.();
    resilient.close();
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

export function batchCreateSessions(opts: { sessions: CreateSessionRequest[] }): Promise<{ results: SessionInfo[] }> {
  return request('/v1/sessions/batch', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

// ── Pipelines ──────────────────────────────────────────────────

export interface PipelineRequest {
  name: string;
  sessions: { workDir: string; name?: string; prompt?: string }[];
}

export interface PipelineInfo {
  id: string;
  name: string;
  status: string;
  sessions: SessionInfo[];
  createdAt: string;
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

export interface AuthKey {
  id: string;
  name: string;
  key: string;
  createdAt: string;
}

export function createAuthKey(name: string): Promise<AuthKey> {
  return request('/v1/auth/keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function getAuthKeys(): Promise<AuthKey[]> {
  return request('/v1/auth/keys');
}

export function revokeAuthKey(id: string): Promise<OkResponse> {
  return request(`/v1/auth/keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
