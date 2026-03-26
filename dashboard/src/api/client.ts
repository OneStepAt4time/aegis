/**
 * api/client.ts — Aegis API client.
 *
 * Typed fetch wrapper for all Aegis v1 endpoints.
 * Reads Bearer token from localStorage on every request.
 */

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

const BASE_URL = import.meta.env.VITE_AEGIS_URL ?? 'http://localhost:9100';

// ── Fetch wrapper ───────────────────────────────────────────────

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = localStorage.getItem('aegis_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
    const err = new Error(body.error ?? `HTTP ${res.status}`) as Error & { statusCode: number };
    err.statusCode = res.status;
    throw err;
  }

  return res.json() as Promise<T>;
}

// ── Health ──────────────────────────────────────────────────────

export function getHealth(): Promise<HealthResponse> {
  return request('/v1/health');
}

// ── Metrics ─────────────────────────────────────────────────────

export function getMetrics(): Promise<GlobalMetrics> {
  return request('/v1/metrics');
}

// ── Sessions ────────────────────────────────────────────────────

export function getSessions(): Promise<SessionsListResponse> {
  return request('/v1/sessions');
}

export function getSession(id: string): Promise<SessionInfo> {
  return request(`/v1/sessions/${encodeURIComponent(id)}`);
}

export function createSession(opts: CreateSessionRequest): Promise<SessionInfo> {
  return request('/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export function killSession(id: string): Promise<OkResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ── Session Health ──────────────────────────────────────────────

export function getSessionHealth(id: string): Promise<SessionHealth> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/health`);
}

// #128: Fetch health for all sessions in one request (avoids N+1)
export function getAllSessionsHealth(): Promise<Record<string, SessionHealth>> {
  return request('/v1/sessions/health');
}

// ── Session Messages ────────────────────────────────────────────

export function getSessionMessages(id: string): Promise<MessagesResponse> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/read`);
}

// ── Session Metrics ─────────────────────────────────────────────

export function getSessionMetrics(id: string): Promise<SessionMetrics> {
  return request(`/v1/sessions/${encodeURIComponent(id)}/metrics`);
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

/**
 * Subscribe to Server-Sent Events for a session.
 * Returns an unsubscribe function.
 */
export function subscribeSSE(
  sessionId: string,
  handler: (event: MessageEvent) => void,
  token?: string | null,
): () => void {
  const url = new URL(`/v1/sessions/${encodeURIComponent(sessionId)}/events`, BASE_URL);
  // #124/#125: Pass token as query param — EventSource cannot set headers
  if (token) url.searchParams.set('token', token);

  const eventSource = new EventSource(url.toString());

  eventSource.onmessage = handler;
  eventSource.onerror = () => {
    // EventSource will auto-reconnect; we just let it.
  };

  return () => {
    eventSource.close();
  };
}

/**
 * Subscribe to global SSE events (all sessions).
 * Returns an unsubscribe function.
 */
export function subscribeGlobalSSE(
  handler: (event: GlobalSSEEvent) => void,
  token?: string | null,
): () => void {
  const url = new URL('/v1/events', BASE_URL);
  // #124/#125: Pass token as query param — EventSource cannot set headers
  if (token) url.searchParams.set('token', token);

  const eventSource = new EventSource(url.toString());

  eventSource.onmessage = (e: MessageEvent) => {
    try {
      const parsed = JSON.parse(e.data as string) as GlobalSSEEvent;
      handler(parsed);
    } catch {
      // ignore malformed events
    }
  };
  eventSource.onerror = () => {
    // EventSource will auto-reconnect
  };

  return () => {
    eventSource.close();
  };
}
