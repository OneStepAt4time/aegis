/**
 * api/client.ts — Aegis API client.
 *
 * Typed fetch wrapper for all Aegis v1 endpoints.
 * Reads Bearer token from an in-memory accessor registered by the auth store (#1924).
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
  SessionStats,
  SessionsListResponse,
  SessionStatusCounts,
  UIState,
  ApiError,
  AuthKeySummary,
  VerifyTokenResponse,
  CreatedAuthKey,
  AnalyticsSummary,
} from '../types';
import type {
  AuditChainMetadata,
  AuditIntegrityMetadata,
  AuditPageResponse,
} from '../types/index.js';
import {
  AuditPageResponseSchema,
  AuthKeySummarySchema,
  CreatedAuthKeySchema,
  HealthResponseSchema,
  SessionInfoSchema,
  SendResponseSchema,
  OkResponseSchema,
  SessionStatsSchema,
  SessionsListResponseSchema,
  SessionHealthSchema,
  SessionMetricsSchema,
  SessionLatencySchema,
  SessionMessagesSchema,
  GlobalMetricsSchema,
  GlobalSSEEventSchema,
  AllSessionsHealthSchema,
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

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

// #1924: Token is held in memory by the auth store and read via this accessor.
// No persistence to localStorage — reduces XSS token-theft exposure.
let tokenAccessor: (() => string | null) = () => null;

export function setTokenAccessor(fn: () => string | null): void {
  tokenAccessor = fn;
}

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
  console.error('[aegis] API response validation failed (%s):', context, result.error.issues);
  throw new Error('API response validation failed for ' + context + ': ' + result.error.issues.map(i => i.message).join(', '));
}

// ── Error classification ────────────────────────────────────────

/** Returns true if the error is a transient failure worth retrying. */
export function isRetryableError(error: Error): boolean {
  if (error.name === 'AbortError') return false;
  if (!error.message) return false;
  if (error.message.includes('HTTP ')) return false;
  // Validation failures are deterministic — retrying won't help
  if (error.message.includes('validation failed') || error.message.includes('validateResponse')) return false;
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

async function requestResponse(
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const token = tokenAccessor();
  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headersToObject(options.headers),
  };

  const { retries = 0, schema: _schema, schemaContext: _schemaContext, ...fetchOptions } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, { ...fetchOptions, headers });
      if (!res.ok) {
        if (res.status === 401) {
          unauthorizedHandler?.();
          if (!unauthorizedHandler && window.location.pathname !== '/dashboard/login') {
            window.location.assign('/dashboard/login');
          }
          throw new Error('Unauthorized');
        }
        const body = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
        const err = new Error(body.error ?? `HTTP ${res.status}`) as Error & { statusCode: number };
        err.statusCode = res.status;
        throw err;
      }
      return res;
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
  throw lastError ?? new Error(`Request failed for ${path}`);
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { schema, schemaContext, ...requestOptions } = options;
  const res = await requestResponse(path, requestOptions);
  const data = await res.json();
  if (schema) return validateResponse(data, schema as z.ZodType<T>, schemaContext ?? path);
  return data as T;
}

// ── Health ──────────────────────────────────────────────────────

export function getHealth(): Promise<HealthResponse> {
  return request('/v1/health', { schema: HealthResponseSchema, schemaContext: 'getHealth' });
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
}

interface NpmPackageResponse {
  version?: string;
}

const NPM_PACKAGE_NAME = '@onestepat4time/aegis';
const NPM_REGISTRY_URL = `https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`;
const NPM_PACKAGE_URL = `https://www.npmjs.com/package/${NPM_PACKAGE_NAME}`;

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function compareSemver(a: string, b: string): number {
  const aParts = normalizeVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const bParts = normalizeVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const maxLen = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLen; i++) {
    const left = aParts[i] ?? 0;
    const right = bParts[i] ?? 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}

export async function checkForUpdates(currentVersion: string): Promise<UpdateCheckResult> {
  const res = await fetch(NPM_REGISTRY_URL, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Update check failed (HTTP ${res.status})`);
  }

  const payload = await res.json() as NpmPackageResponse;
  const latestVersion = normalizeVersion(payload.version ?? currentVersion);
  const normalizedCurrent = normalizeVersion(currentVersion);

  return {
    currentVersion: normalizedCurrent,
    latestVersion,
    updateAvailable: compareSemver(latestVersion, normalizedCurrent) > 0,
    releaseUrl: NPM_PACKAGE_URL,
  };
}

// ── Metrics ─────────────────────────────────────────────────────

export function getMetrics(): Promise<GlobalMetrics> {
  return request('/v1/metrics', { schema: GlobalMetricsSchema, schemaContext: 'getMetrics' });
}

// ── Analytics (Issue #1970) ──────────────────────────────────────

export function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  return request('/v1/analytics/summary');
}

// ── Sessions ────────────────────────────────────────────────────

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
  const stats = await request<SessionStats>('/v1/sessions/stats', {
    schema: SessionStatsSchema,
    schemaContext: 'getSessionStatusCounts',
  });

  const counts: SessionStatusCounts = {
    all: stats.active,
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
    unknown: 0,
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

// ── Auth Verify ────────────────────────────────────────────────
export function verifyToken(token: string): Promise<VerifyTokenResponse> {
  return request('/v1/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
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

export type AuthKey = AuthKeySummary;
export type { CreatedAuthKey };

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

// ── Session Templates (Issue #467) ──────────────────────────────

import type { SessionTemplate } from '../types/index.js';

export function createTemplate(opts: {
  name: string;
  description?: string;
  sessionId?: string;
  workDir?: string;
  prompt?: string;
  claudeCommand?: string;
  env?: Record<string, string>;
  stallThresholdMs?: number;
  permissionMode?: string;
  autoApprove?: boolean;
  memoryKeys?: string[];
}): Promise<SessionTemplate> {
  return request('/v1/templates', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export function getTemplates(): Promise<SessionTemplate[]> {
  return request('/v1/templates');
}

export function getTemplate(id: string): Promise<SessionTemplate> {
  return request(`/v1/templates/${encodeURIComponent(id)}`);
}

export function updateTemplate(id: string, updates: Partial<Parameters<typeof createTemplate>[0]>): Promise<SessionTemplate> {
  return request(`/v1/templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export function deleteTemplate(id: string): Promise<OkResponse> {
  return request(`/v1/templates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ── Audit Trail ──────────────────────────────────────────────────

export interface FetchAuditLogsParams {
  limit?: number;
  cursor?: string;
  actor?: string;
  action?: string;
  sessionId?: string;
  from?: string;
  to?: string;
  reverse?: boolean;
  verify?: boolean;
  signal?: AbortSignal;
}

export type AuditExportFormat = 'csv' | 'ndjson';

export interface ExportAuditLogsParams extends Omit<FetchAuditLogsParams, 'limit' | 'cursor'> {
  format: AuditExportFormat;
}

export interface AuditExportResult {
  filename: string;
  format: AuditExportFormat;
  mimeType: string;
  chain: AuditChainMetadata;
  integrity?: AuditIntegrityMetadata;
}

interface AuditQueryParams extends Omit<FetchAuditLogsParams, 'signal'> {
  format?: 'json' | AuditExportFormat;
}

function buildAuditSearchParams(params: AuditQueryParams): URLSearchParams {
  const searchParams = new URLSearchParams();
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params.cursor) searchParams.set('cursor', params.cursor);
  if (params.actor) searchParams.set('actor', params.actor);
  if (params.action) searchParams.set('action', params.action);
  if (params.sessionId) searchParams.set('sessionId', params.sessionId);
  if (params.from) searchParams.set('from', params.from);
  if (params.to) searchParams.set('to', params.to);
  if (params.reverse !== undefined) searchParams.set('reverse', String(params.reverse));
  if (params.verify !== undefined) searchParams.set('verify', String(params.verify));
  if (params.format) searchParams.set('format', params.format);
  return searchParams;
}

function parseAuditExportFilename(headers: Headers, format: AuditExportFormat): string {
  const disposition = headers.get('Content-Disposition') ?? '';
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }

  const quotedMatch = disposition.match(/filename="([^"]+)"/i);
  if (quotedMatch) return quotedMatch[1];

  const plainMatch = disposition.match(/filename=([^;]+)/i);
  if (plainMatch) return plainMatch[1].trim();

  return `audit-export.${format}`;
}

function parseAuditChainMetadata(headers: Headers): AuditChainMetadata {
  const count = Number.parseInt(headers.get('X-Aegis-Audit-Record-Count') ?? '0', 10);
  return {
    count: Number.isFinite(count) ? count : 0,
    firstHash: headers.get('X-Aegis-Audit-First-Hash'),
    lastHash: headers.get('X-Aegis-Audit-Last-Hash'),
    badgeHash: headers.get('X-Aegis-Audit-Chain-Badge'),
    firstTs: headers.get('X-Aegis-Audit-First-Ts'),
    lastTs: headers.get('X-Aegis-Audit-Last-Ts'),
  };
}

function parseAuditIntegrityMetadata(headers: Headers): AuditIntegrityMetadata | undefined {
  const validHeader = headers.get('X-Aegis-Audit-Integrity-Valid');
  if (validHeader === null) return undefined;

  const brokenAtHeader = headers.get('X-Aegis-Audit-Integrity-Broken-At');
  const brokenAtValue = brokenAtHeader ? Number.parseInt(brokenAtHeader, 10) : undefined;
  const file = headers.get('X-Aegis-Audit-Integrity-File');

  return {
    valid: validHeader === 'true',
    ...(brokenAtValue !== undefined && Number.isFinite(brokenAtValue) ? { brokenAt: brokenAtValue } : {}),
    ...(file ? { file } : {}),
  };
}

function downloadText(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function fetchAuditLogs(params: FetchAuditLogsParams = {}): Promise<AuditPageResponse> {
  const { signal, ...queryParams } = params;
  const searchParams = buildAuditSearchParams({ ...queryParams, format: 'json' });
  const query = searchParams.toString();
  const path = query ? `/v1/audit?${query}` : '/v1/audit';
  return request<AuditPageResponse>(path, {
    signal,
    schema: AuditPageResponseSchema,
    schemaContext: 'fetchAuditLogs',
  });
}

export async function exportAuditLogs(params: ExportAuditLogsParams): Promise<AuditExportResult> {
  const { signal, format, ...queryParams } = params;
  const searchParams = buildAuditSearchParams({
    ...queryParams,
    format,
    verify: queryParams.verify ?? true,
  });
  const query = searchParams.toString();
  const path = query ? `/v1/audit?${query}` : '/v1/audit';
  const accept = format === 'csv' ? 'text/csv' : 'application/x-ndjson';
  const response = await requestResponse(path, {
    signal,
    headers: {
      Accept: accept,
    },
  });
  const content = await response.text();
  const mimeType = response.headers.get('Content-Type') ?? accept;
  const filename = parseAuditExportFilename(response.headers, format);

  downloadText(content, mimeType, filename);

  return {
    filename,
    format,
    mimeType,
    chain: parseAuditChainMetadata(response.headers),
    integrity: parseAuditIntegrityMetadata(response.headers),
  };
}

// ── Users & Session History ─────────────────────────────────────

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

export interface FetchSessionHistoryParams {
  page?: number;
  limit?: number;
  status?: 'active' | 'killed' | 'unknown';
  ownerKeyId?: string;
  nameSearch?: string;
  createdAfter?: number;
  createdBefore?: number;
  sortBy?: 'createdAt' | 'lastSeenAt' | 'status';
  sortOrder?: 'asc' | 'desc';
  signal?: AbortSignal;
}

export function fetchUsers(signal?: AbortSignal): Promise<UsersResponse> {
  return request<UsersResponse>('/v1/users', { signal });
}

export function fetchSessionHistory(params: FetchSessionHistoryParams = {}): Promise<SessionHistoryResponse> {
  const { signal, ...queryParams } = params;
  const searchParams = new URLSearchParams();
  if (queryParams.page !== undefined) searchParams.set('page', String(queryParams.page));
  if (queryParams.limit !== undefined) searchParams.set('limit', String(queryParams.limit));
  if (queryParams.status) searchParams.set('status', queryParams.status);
  if (queryParams.ownerKeyId) searchParams.set('ownerKeyId', queryParams.ownerKeyId);
  if (queryParams.nameSearch) searchParams.set('name', queryParams.nameSearch);
  if (queryParams.createdAfter) searchParams.set('createdAfter', String(queryParams.createdAfter));
  if (queryParams.createdBefore) searchParams.set('createdBefore', String(queryParams.createdBefore));
  if (queryParams.sortBy) searchParams.set('sortBy', queryParams.sortBy);
  if (queryParams.sortOrder) searchParams.set('sortOrder', queryParams.sortOrder);

  const query = searchParams.toString();
  const path = query ? `/v1/sessions/history?${query}` : '/v1/sessions/history';
  return request<SessionHistoryResponse>(path, { signal });
}
