/**
 * AegisClient.ts — Backward-compatible wrapper around the OpenAPI-generated SDK.
 *
 * This class preserves the API of the hand-written v0.3.2-alpha client while
 * delegating all HTTP calls to the generated SDK functions from ./generated/.
 *
 * @example
 * import { AegisClient } from '@onestepat4time/aegis-client';
 *
 * const client = new AegisClient('http://localhost:9100', 'your-token');
 * const sessions = await client.listSessions();
 */

import {
  createClient,
  createConfig,
} from './generated/client/index.js';
import type { Config, ClientOptions as GenClientOptions } from './generated/client/types.gen.js';
import type { ClientOptions as SdkClientOptions } from './generated/types.gen.js';
import * as sdk from './generated/sdk.gen.js';
import type {
  SessionInfo,
  CreateSessionRequest,
  HealthResponse,
  SessionHealth,
  SessionMetrics,
  GetSessionSummaryResponse,
  GetSessionLatencyResponse,
  ListSessionsResponse,
  ReadMessagesResponse,
  CreateSessionResponse,
  BatchCreateSessionsResponse,
  CreatePipelineRequest,
  GetMemoryEntryResponse,
  SetMemoryEntryResponses,
  GlobalMetrics,
  GetSwarmStatusResponse,
  GetSessionStatsResponse,
  ListPipelinesResponse,
  CreatePipelineResponse,
} from './generated/types.gen.js';

export interface AegisClientOptions {
  /** Base URL of the Aegis server. Defaults to http://localhost:9100. */
  baseUrl?: string;
  /** Bearer token for authentication. */
  authToken?: string;
  /** Default request timeout in milliseconds. */
  timeoutMs?: number;
}

/** Extract error message from SDK error. */
function sdkErr(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === 'object' && e !== null) {
    const obj = e as Record<string, unknown>;
    return new Error(typeof obj.error === 'string' ? obj.error : JSON.stringify(e));
  }
  return new Error(String(e));
}

// Re-export key generated types
export type {
  SessionInfo,
  CreateSessionRequest,
  HealthResponse,
  SessionHealth,
  SessionMetrics,
  GlobalMetrics,
  CreatePipelineRequest,
  SessionStatusFilter,
  SessionId,
  ApiKey,
  ApiKeyRole,
  SessionTemplate,
} from './generated/types.gen.js';

// Re-export all SDK functions for advanced usage
export * from './generated/sdk.gen.js';
export type { Options } from './generated/sdk.gen.js';

/**
 * Backward-compatible Aegis client class.
 *
 * Wraps the OpenAPI-generated SDK functions in a class-based API that
 * matches the original hand-written client. New code should prefer
 * importing SDK functions directly.
 */
export class AegisClient {
  private baseUrl: string;
  private bearer: string | undefined;
  private timeoutMs: number;

  /**
   * Create a new Aegis client.
   *
   * @overload
   * @param authToken - Bearer token (uses default baseUrl http://localhost:9100)
   * @param options - Additional options
   *
   * @overload
   * @param baseUrl - Server base URL
   * @param authToken - Bearer token for authentication
   * @param options - Additional options (timeout, etc.)
   */
  constructor(
    baseUrlOrToken: string,
    authTokenOrOptions?: string | AegisClientOptions,
    maybeOptions?: AegisClientOptions,
  ) {
    if (typeof authTokenOrOptions === 'string') {
      // Overload 2: (baseUrl, authToken, options?)
      this.baseUrl = baseUrlOrToken;
      this.bearer = authTokenOrOptions;
      this.timeoutMs = maybeOptions?.timeoutMs ?? 30000;
    } else {
      // Overload 1: (authToken, options?) — defaults baseUrl
      this.baseUrl = 'http://localhost:9100';
      this.bearer = baseUrlOrToken;
      this.timeoutMs = authTokenOrOptions?.timeoutMs ?? 30000;
    }
    createConfig({ baseUrl: this.baseUrl });
  }

  /** Build common SDK options with auth. */
  private opts(): { client: ReturnType<typeof createClient>; auth: string } {
    const client = createClient(
      createConfig<SdkClientOptions>({ baseUrl: this.baseUrl }),
    );
    return {
      client,
      ...(this.bearer ? { auth: this.bearer } : {}),
    } as any;
  }

  // ── Sessions ────────────────────────────────────────────────────

  /** List all sessions, optionally filtered. */
  async listSessions(filter?: { status?: string; workDir?: string }): Promise<SessionInfo[]> {
    const { data, error } = await sdk.listSessions({
      ...this.opts(),
      query: filter as Record<string, unknown>,
    });
    if (error) throw sdkErr(error);
    return (data as ListSessionsResponse)?.sessions ?? [];
  }

  /** Get detailed info for a single session. */
  async getSession(id: string): Promise<SessionInfo> {
    const { data, error } = await sdk.getSession({ ...this.opts(), path: { id } });
    if (error) throw sdkErr(error);
    return data as unknown as SessionInfo;
  }

  /** Get session health and liveness data. */
  async getHealth(id: string): Promise<SessionHealth> {
    const { data, error } = await sdk.getSessionHealth({ ...this.opts(), path: { id } });
    if (error) throw sdkErr(error);
    return data as unknown as SessionHealth;
  }

  /** Read the full message transcript for a session. */
  async getTranscript(id: string) {
    const { data, error } = await sdk.readMessages({ ...this.opts(), path: { id } });
    if (error) throw sdkErr(error);
    return data as ReadMessagesResponse;
  }

  /** Send a text message to a session. */
  async sendMessage(id: string, text: string) {
    const { error } = await sdk.sendMessage({ ...this.opts(), path: { id }, body: { text } });
    if (error) throw sdkErr(error);
    return { ok: true };
  }

  /** Create a new Claude Code session. */
  async createSession(opts: CreateSessionRequest) {
    const { data, error } = await sdk.createSession({ ...this.opts(), body: opts });
    if (error) throw sdkErr(error);
    return data as CreateSessionResponse;
  }

  /** Kill (terminate) a session. */
  async killSession(id: string) {
    const { error } = await sdk.killSession({ ...this.opts(), path: { id } });
    if (error) throw sdkErr(error);
    return { ok: true };
  }

  /** Approve a pending permission prompt. */
  async approvePermission(id: string) {
    const { error } = await sdk.approvePermission({ ...this.opts(), path: { id } });
    if (error) throw sdkErr(error);
    return { ok: true };
  }

  /** Reject a pending permission prompt. */
  async rejectPermission(id: string) {
    const { error } = await sdk.rejectPermission({ ...this.opts(), path: { id } });
    if (error) throw sdkErr(error);
    return { ok: true };
  }

  /** Escape from ask_question mode. */
  async escapeSession(id: string) {
    const { error } = await sdk.sendEscape({ ...this.opts(), path: { id } });
    if (error) throw sdkErr(error);
    return { ok: true };
  }

  /** Interrupt the running session. */
  async interruptSession(id: string) {
    const { error } = await sdk.interruptSession({ ...this.opts(), path: { id } });
    if (error) throw sdkErr(error);
    return { ok: true };
  }

  /** Capture the current terminal pane content. */
  async capturePane(id: string) {
    const { data, error } = await sdk.capturePane({ ...this.opts(), path: { id } });
    if (error) throw sdkErr(error);
    return data;
  }

  /** Get session metrics. */
  async getSessionMetrics(id: string): Promise<SessionMetrics> {
    const { data, error } = await sdk.getSessionMetrics({ ...this.opts(), path: { id } });
    if (error) throw sdkErr(error);
    return data as unknown as SessionMetrics;
  }

  /** Get a session summary. */
  async getSessionSummary(id: string) {
    const { data, error } = await sdk.getSessionSummary({ ...this.opts(), path: { id } });
    if (error) throw sdkErr(error);
    return data as GetSessionSummaryResponse;
  }

  /** Execute a bash command in the session. */
  async sendBash(id: string, command: string) {
    const { error } = await sdk.sendBash({ ...this.opts(), path: { id }, body: { command } });
    if (error) throw sdkErr(error);
    return { ok: true };
  }

  /** Send a Claude Code slash command. */
  async sendCommand(id: string, command: string) {
    const { error } = await sdk.sendCommand({ ...this.opts(), path: { id }, body: { command } });
    if (error) throw sdkErr(error);
    return { ok: true };
  }

  /** Get latency metrics for a session. */
  async getSessionLatency(id: string) {
    const { data, error } = await sdk.getSessionLatency({ ...this.opts(), path: { id } });
    if (error) throw sdkErr(error);
    return data as GetSessionLatencyResponse;
  }

  /** Bulk-create multiple sessions. */
  async batchCreateSessions(sessions: Array<{ workDir: string; name?: string; prompt?: string }>) {
    const { data, error } = await sdk.batchCreateSessions({ ...this.opts(), body: { sessions } });
    if (error) throw sdkErr(error);
    return data as BatchCreateSessionsResponse;
  }

  // ── Server ──────────────────────────────────────────────────────

  /** Get server health and version info. */
  async getServerHealth(): Promise<HealthResponse> {
    const { data, error } = await sdk.getHealth();
    if (error) throw sdkErr(error);
    return data as HealthResponse;
  }

  /** Get global metrics. */
  async getGlobalMetrics(): Promise<GlobalMetrics> {
    const { data, error } = await sdk.getGlobalMetrics({ ...this.opts() });
    if (error) throw sdkErr(error);
    return data as GlobalMetrics;
  }

  /** Get session statistics. */
  async getSessionStats() {
    const { data, error } = await sdk.getSessionStats({ ...this.opts() });
    if (error) throw sdkErr(error);
    return data as GetSessionStatsResponse;
  }

  // ── Pipelines ───────────────────────────────────────────────────

  /** List all pipelines. */
  async listPipelines() {
    const { data, error } = await sdk.listPipelines({ ...this.opts() });
    if (error) throw sdkErr(error);
    return data as ListPipelinesResponse;
  }

  /** Create a new pipeline. */
  async createPipeline(config: CreatePipelineRequest) {
    const { data, error } = await sdk.createPipeline({ ...this.opts(), body: config as any });
    if (error) throw sdkErr(error);
    return data as CreatePipelineResponse;
  }

  // ── Swarm ───────────────────────────────────────────────────────

  /** Get swarm status. */
  async getSwarm() {
    const { data, error } = await sdk.getSwarmStatus({ ...this.opts() });
    if (error) throw sdkErr(error);
    return data as GetSwarmStatusResponse;
  }

  // ── Memory ─────────────────────────────────────────────────────

  /** Store a value in memory. */
  async setMemory(key: string, value: string) {
    const { data, error } = await sdk.setMemoryEntry({ ...this.opts(), body: { key, value } });
    if (error) throw sdkErr(error);
    return data as unknown as SetMemoryEntryResponses;
  }

  /** Retrieve a value from memory. */
  async getMemory(key: string) {
    const { data, error } = await sdk.getMemoryEntry({ ...this.opts(), path: { key } });
    if (error) throw sdkErr(error);
    return data as GetMemoryEntryResponse;
  }

  /** Delete a value from memory. */
  async deleteMemory(key: string) {
    const { error } = await sdk.deleteMemoryEntry({ ...this.opts(), path: { key } });
    if (error) throw sdkErr(error);
    return { ok: true };
  }

  // ── Audit ──────────────────────────────────────────────────────

  /** List audit records with pagination and filters. */
  async getAuditLogs(params?: {
    page?: number;
    pageSize?: number;
    actor?: string;
    action?: string;
    sessionId?: string;
  }) {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.actor) qs.set('actor', params.actor);
    if (params?.action) qs.set('action', params.action);
    if (params?.sessionId) qs.set('sessionId', params.sessionId);
    const query = qs.toString();
    const url = `/v1/audit${query ? `?${query}` : ''}`;
    const headers: Record<string, string> = {
      ...(this.bearer ? { Authorization: `Bearer ${this.bearer}` } : {}),
    };
    const res = await fetch(`${this.baseUrl}${url}`, {
      headers,
      signal: this.timeoutMs > 0 ? AbortSignal.timeout(this.timeoutMs) : undefined,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
    }
    return res.json();
  }
}

export default AegisClient;
