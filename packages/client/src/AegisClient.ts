/**
 * AegisClient.ts — Official TypeScript client for Aegis Bridge.
 *
 * HTTP API client for orchestrating Claude Code sessions.
 * Works in Node.js and browser environments.
 *
 * @example
 * import { AegisClient } from '@aegis/client';
 *
 * const client = new AegisClient('http://localhost:18792', process.env.AEGIS_AUTH_TOKEN);
 *
 * // List all sessions
 * const sessions = await client.listSessions();
 *
 * // Create a new session
 * const session = await client.createSession({ workDir: '/path/to/project' });
 *
 * // Send a message
 * await client.sendMessage(session.id, 'Hello, Claude!');
 */

import type {
  SessionInfo,
  CreateSessionRequest,
  OkResponse,
  SendResponse,
  SessionHealth,
  PaneResponse,
  SessionLatency,
  SessionMetrics,
  SessionSummary,
  MessagesResponse,
  BatchResult,
  PipelineState,
  MemoryEntryResponse,
  HealthResponse,
  SessionsListResponse,
  AuditPageResponse,
  GlobalMetrics,
} from './types.js';

// ── UUID validation ─────────────────────────────────────────────────

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function isSameOrChildWorkDir(sessionWorkDir: string, filterWorkDir: string): boolean {
  return sessionWorkDir === filterWorkDir || sessionWorkDir.startsWith(filterWorkDir + '/');
}

// ── Client ─────────────────────────────────────────────────────────

export interface AegisClientOptions {
  /** Base URL of the Aegis server. Defaults to localhost:18792. */
  baseUrl?: string;
  /** Bearer token for authentication. */
  authToken?: string;
  /** Default request timeout in milliseconds. */
  timeoutMs?: number;
}

export class AegisClient {
  private readonly baseUrl: string;
  private readonly authToken?: string;
  private readonly timeoutMs: number;

  constructor(authToken: string, options?: AegisClientOptions);
  constructor(baseUrl: string, authToken?: string, options?: AegisClientOptions);
  constructor(baseUrlOrToken: string, authTokenOrOptions?: string | AegisClientOptions, maybeOptions?: AegisClientOptions) {
    if (typeof authTokenOrOptions === 'string') {
      // Overload 2: (baseUrl, authToken, options?)
      this.baseUrl = baseUrlOrToken;
      this.authToken = authTokenOrOptions;
      this.timeoutMs = maybeOptions?.timeoutMs ?? 30000;
    } else {
      // Overload 1: (authToken, options?) — defaults baseUrl to localhost
      this.baseUrl = baseUrlOrToken ?? 'http://localhost:18792';
      this.authToken = authTokenOrOptions?.authToken;
      this.timeoutMs = authTokenOrOptions?.timeoutMs ?? 30000;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────

  private validateSessionId(id: string): void {
    if (!isValidUUID(id)) {
      throw new Error(`Invalid session ID: ${id}`);
    }
  }

  private async request<T = unknown>(path: string, opts?: RequestInit & { timeoutMs?: number }): Promise<T> {
    const hasBody = opts?.body !== undefined;
    const headers: Record<string, string> = {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
      'X-Aegis-API-Version': '1',
    };
    const timeout = opts?.timeoutMs ?? this.timeoutMs;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...opts,
        headers: { ...headers, ...opts?.headers },
        signal: timeout > 0 ? AbortSignal.timeout(timeout) : undefined,
      });
    } catch (e: unknown) {
      const cause = (e as { cause?: { code?: string } }).cause;
      if (cause?.code === 'ECONNREFUSED') {
        throw new Error('Aegis server is not running or not reachable');
      }
      if (e instanceof Error && e.name === 'TimeoutError') {
        throw new Error(`Request timed out after ${timeout}ms: ${path}`);
      }
      throw new Error(`Network error: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  // ── Sessions ────────────────────────────────────────────────────

  /**
   * List all sessions, optionally filtered by status or workDir.
   */
  async listSessions(filter?: { status?: string; workDir?: string }): Promise<SessionInfo[]> {
    const response = await this.request<{ sessions: SessionInfo[]; total: number }>('/v1/sessions');
    let sessions = response.sessions;
    if (filter?.status) {
      sessions = sessions.filter((s) => s.status === filter.status);
    }
    if (filter?.workDir) {
      sessions = sessions.filter((s) => isSameOrChildWorkDir(s.workDir, filter.workDir!));
    }
    return sessions;
  }

  /**
   * Get detailed info for a single session.
   */
  async getSession(id: string): Promise<SessionInfo> {
    this.validateSessionId(id);
    return this.request<SessionInfo>(`/v1/sessions/${encodeURIComponent(id)}`);
  }

  /**
   * Get session health and liveness data.
   */
  async getHealth(id: string): Promise<SessionHealth> {
    this.validateSessionId(id);
    return this.request<SessionHealth>(`/v1/sessions/${encodeURIComponent(id)}/health`);
  }

  /**
   * Read the full message transcript for a session.
   */
  async getTranscript(id: string): Promise<MessagesResponse> {
    this.validateSessionId(id);
    return this.request<MessagesResponse>(`/v1/sessions/${encodeURIComponent(id)}/read`);
  }

  /**
   * Send a text message to a session.
   */
  async sendMessage(id: string, text: string): Promise<SendResponse> {
    this.validateSessionId(id);
    return this.request<SendResponse>(`/v1/sessions/${encodeURIComponent(id)}/send`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  /**
   * Create a new Claude Code session.
   */
  async createSession(opts: CreateSessionRequest): Promise<{ id: string; name?: string }> {
    return this.request<{ id: string; name?: string }>('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify(opts),
    });
  }

  /**
   * Kill (terminate) a session.
   */
  async killSession(id: string): Promise<OkResponse> {
    this.validateSessionId(id);
    return this.request<OkResponse>(`/v1/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Approve a pending permission prompt in a session.
   */
  async approvePermission(id: string): Promise<OkResponse> {
    this.validateSessionId(id);
    return this.request<OkResponse>(`/v1/sessions/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    });
  }

  /**
   * Reject a pending permission prompt in a session.
   */
  async rejectPermission(id: string): Promise<OkResponse> {
    this.validateSessionId(id);
    return this.request<OkResponse>(`/v1/sessions/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
    });
  }

  /**
   * Escape from ask_question mode (resume control).
   */
  async escapeSession(id: string): Promise<OkResponse> {
    this.validateSessionId(id);
    return this.request<OkResponse>(`/v1/sessions/${encodeURIComponent(id)}/escape`, {
      method: 'POST',
    });
  }

  /**
   * Interrupt the running Claude Code session.
   */
  async interruptSession(id: string): Promise<OkResponse> {
    this.validateSessionId(id);
    return this.request<OkResponse>(`/v1/sessions/${encodeURIComponent(id)}/interrupt`, {
      method: 'POST',
    });
  }

  /**
   * Capture the current terminal pane content.
   */
  async capturePane(id: string): Promise<PaneResponse> {
    this.validateSessionId(id);
    return this.request<PaneResponse>(`/v1/sessions/${encodeURIComponent(id)}/pane`);
  }

  /**
   * Get session metrics (token usage, duration, tool calls, etc.).
   */
  async getSessionMetrics(id: string): Promise<SessionMetrics> {
    this.validateSessionId(id);
    return this.request<SessionMetrics>(`/v1/sessions/${encodeURIComponent(id)}/metrics`);
  }

  /**
   * Get a summary of the session.
   */
  async getSessionSummary(id: string): Promise<SessionSummary> {
    this.validateSessionId(id);
    return this.request<SessionSummary>(`/v1/sessions/${encodeURIComponent(id)}/summary`);
  }

  /**
   * Execute a bash command in the session (requires auto-approve or approval).
   */
  async sendBash(id: string, command: string): Promise<OkResponse> {
    this.validateSessionId(id);
    return this.request<OkResponse>(`/v1/sessions/${encodeURIComponent(id)}/bash`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }

  /**
   * Send a Claude Code command (e.g. /exit).
   */
  async sendCommand(id: string, command: string): Promise<OkResponse> {
    this.validateSessionId(id);
    return this.request<OkResponse>(`/v1/sessions/${encodeURIComponent(id)}/command`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }

  /**
   * Get latency metrics for a session.
   */
  async getSessionLatency(id: string): Promise<SessionLatency> {
    this.validateSessionId(id);
    return this.request<SessionLatency>(`/v1/sessions/${encodeURIComponent(id)}/latency`);
  }

  /**
   * Bulk-create multiple sessions at once.
   */
  async batchCreateSessions(sessions: Array<{ workDir: string; name?: string; prompt?: string }>): Promise<BatchResult> {
    return this.request<BatchResult>('/v1/sessions/batch', {
      method: 'POST',
      body: JSON.stringify({ sessions }),
    });
  }

  // ── Server ──────────────────────────────────────────────────────

  /**
   * Get server health and version info.
   */
  async getServerHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/v1/health');
  }

  /**
   * Get global metrics across all sessions.
   */
  async getGlobalMetrics(): Promise<GlobalMetrics> {
    return this.request<GlobalMetrics>('/v1/metrics');
  }

  /**
   * Get session statistics.
   */
  async getSessionStats(): Promise<{ active: number; byStatus: Record<string, number>; totalCreated: number; totalCompleted: number; totalFailed: number }> {
    return this.request('/v1/stats');
  }

  // ── Pipelines ───────────────────────────────────────────────────

  /**
   * List all pipelines.
   */
  async listPipelines(): Promise<PipelineState[]> {
    return this.request<PipelineState[]>('/v1/pipelines');
  }

  /**
   * Create a new pipeline.
   */
  async createPipeline(config: { name: string; workDir: string; steps: Array<{ name?: string; prompt: string }> }): Promise<PipelineState> {
    return this.request<PipelineState>('/v1/pipelines', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  // ── Swarm ───────────────────────────────────────────────────────

  /**
   * Get swarm status (multi-agent coordination state).
   */
  async getSwarm(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/v1/swarm');
  }

  // ── Memory ─────────────────────────────────────────────────────

  /**
   * Store a value in the Aegis memory store.
   */
  async setMemory(key: string, value: string, ttlSeconds?: number): Promise<MemoryEntryResponse> {
    return this.request<MemoryEntryResponse>('/v1/memory', {
      method: 'POST',
      body: JSON.stringify({ key, value, ttlSeconds }),
    });
  }

  /**
   * Retrieve a value from the Aegis memory store.
   */
  async getMemory(key: string): Promise<MemoryEntryResponse> {
    return this.request<MemoryEntryResponse>(`/v1/memory/${encodeURIComponent(key)}`);
  }

  /**
   * Delete a value from the Aegis memory store.
   */
  async deleteMemory(key: string): Promise<OkResponse> {
    return this.request<OkResponse>(`/v1/memory/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
  }

  // ── Audit ──────────────────────────────────────────────────────

  /**
   * List audit records with pagination and filters.
   */
  async getAuditLogs(params?: {
    page?: number;
    pageSize?: number;
    actor?: string;
    action?: string;
    sessionId?: string;
  }): Promise<AuditPageResponse> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.actor) qs.set('actor', params.actor);
    if (params?.action) qs.set('action', params.action);
    if (params?.sessionId) qs.set('sessionId', params.sessionId);
    const query = qs.toString();
    return this.request<AuditPageResponse>(`/v1/audit${query ? `?${query}` : ''}`);
  }
}

// ── Re-exported types (convenience) ─────────────────────────────────

export type { SessionHealth } from './types.js';

export default AegisClient;
