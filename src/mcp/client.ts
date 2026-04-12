/** mcp/client.ts — AegisClient REST client for MCP remote mode. */

import { resolve } from 'node:path';
import { isValidUUID } from '../validation.js';
import type { SessionInfo } from '../session.js';
import type { SessionMetrics, SessionLatency, SessionLatencySummary } from '../metrics.js';
import type { PipelineState, BatchResult } from '../pipeline.js';

export interface ServerHealthResponse {
  status: string;
  version: string;
  platform: NodeJS.Platform;
  uptime: number;
  sessions: { active: number; total: number };
  tmux: { healthy: boolean; [key: string]: unknown };
  timestamp: string;
}

export interface CreateSessionResponse {
  id: string;
  windowName: string;
  workDir: string;
  status: string;
  promptDelivery?: { delivered: boolean; attempts: number };
  reused?: boolean;
  [key: string]: unknown;
}

export interface SendMessageResponse {
  ok: boolean;
  delivered: boolean;
  attempts: number;
  stall?: { stalled: true; types: string[] } | { stalled: false };
}

export interface OkResponse {
  ok: boolean;
}

export interface CapturePaneResponse {
  pane: string;
}

export interface SessionLatencyResponse {
  sessionId: string;
  realtime: SessionLatency | null;
  aggregated: SessionLatencySummary | null;
}

export interface MemoryEntryResponse {
  entry: {
    key: string;
    value: string;
    namespace: string;
    created_at: number;
    updated_at: number;
    expires_at?: number;
  };
}

function normalizeWorkDirForCompare(workDir: string): string {
  const isWindowsLikePath = /^[a-zA-Z]:[\\/]/.test(workDir) || workDir.startsWith('\\\\');
  const normalizedPath = (isWindowsLikePath ? workDir : resolve(workDir))
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  return process.platform === 'win32' || isWindowsLikePath
    ? normalizedPath.toLowerCase()
    : normalizedPath;
}

function isSameOrChildWorkDir(candidate: string, parent: string): boolean {
  const normalizedCandidate = normalizeWorkDirForCompare(candidate);
  const normalizedParent = normalizeWorkDirForCompare(parent);
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`);
}

export class AegisClient {
  /** Cached role resolved from /v1/auth/verify. undefined = not yet resolved. */
  private resolvedRole: string | undefined;

  constructor(private baseUrl: string, private authToken?: string) {}

  private validateSessionId(id: string): void {
    if (!isValidUUID(id)) {
      throw new Error(`Invalid session ID: ${id}`);
    }
  }

  /**
   * Resolve the RBAC role for the configured auth token.
   * Calls POST /v1/auth/verify and caches only successful role resolutions.
   * Returns 'admin' when no auth token is configured (matching server.ts behavior).
   * Returns 'viewer' if role resolution fails or returns invalid data.
   */
  async resolveRole(): Promise<string> {
    if (this.resolvedRole !== undefined) return this.resolvedRole;

    if (!this.authToken) {
      this.resolvedRole = 'admin';
      return this.resolvedRole;
    }

    try {
      const result = await this.request<{ valid: boolean; role?: string }>('/v1/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ token: this.authToken }),
      });
      if (result.valid && (result.role === 'admin' || result.role === 'operator' || result.role === 'viewer')) {
        this.resolvedRole = result.role;
        return this.resolvedRole;
      }
      return 'viewer';
    } catch {
      return 'viewer';
    }
  }

  private async request<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
    const hasBody = opts?.body !== undefined;
    const headers: Record<string, string> = {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
    };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...opts, headers: { ...headers, ...opts?.headers } });
    } catch (e: unknown) {
      const cause = (e as { cause?: { code?: string } }).cause;
      if (cause?.code === 'ECONNREFUSED') {
        throw new Error('Aegis server is not running or not reachable');
      }
      throw new Error(`Network error: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

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

  async getSession(id: string): Promise<Record<string, unknown>> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}`);
  }

  async getHealth(id: string): Promise<Record<string, unknown>> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/health`);
  }

  async getTranscript(id: string): Promise<Record<string, unknown>> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/read`);
  }

  async sendMessage(id: string, text: string): Promise<SendMessageResponse> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/send`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  async createSession(opts: { workDir: string; name?: string; prompt?: string }): Promise<CreateSessionResponse> {
    return this.request('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify(opts),
    });
  }

  async killSession(id: string): Promise<OkResponse> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async approvePermission(id: string): Promise<OkResponse> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    });
  }

  async rejectPermission(id: string): Promise<OkResponse> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
    });
  }

  async getServerHealth(): Promise<ServerHealthResponse> {
    return this.request('/v1/health');
  }

  async escapeSession(id: string): Promise<OkResponse> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/escape`, {
      method: 'POST',
    });
  }

  async interruptSession(id: string): Promise<OkResponse> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/interrupt`, {
      method: 'POST',
    });
  }

  async capturePane(id: string): Promise<CapturePaneResponse> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/pane`);
  }

  async getSessionMetrics(id: string): Promise<SessionMetrics> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/metrics`);
  }

  async getSessionSummary(id: string): Promise<Record<string, unknown>> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/summary`);
  }

  async sendBash(id: string, command: string): Promise<OkResponse> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/bash`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }

  async sendCommand(id: string, command: string): Promise<OkResponse> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/command`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }

  async getSessionLatency(id: string): Promise<SessionLatencyResponse> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/latency`);
  }

  async batchCreateSessions(sessions: Array<{ workDir: string; name?: string; prompt?: string }>): Promise<BatchResult> {
    return this.request('/v1/sessions/batch', {
      method: 'POST',
      body: JSON.stringify({ sessions }),
    });
  }

  async listPipelines(): Promise<PipelineState[]> {
    return this.request('/v1/pipelines');
  }

  async createPipeline(config: { name: string; workDir: string; steps: Array<{ name?: string; prompt: string }> }): Promise<PipelineState> {
    return this.request('/v1/pipelines', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async getSwarm(): Promise<Record<string, unknown>> {
    return this.request('/v1/swarm');
  }

  async setMemory(key: string, value: string, ttlSeconds?: number): Promise<MemoryEntryResponse> {
    return this.request('/v1/memory', {
      method: 'POST',
      body: JSON.stringify({ key, value, ttlSeconds }),
    });
  }

  async getMemory(key: string): Promise<MemoryEntryResponse> {
    return this.request(`/v1/memory/${encodeURIComponent(key)}`);
  }

  async deleteMemory(key: string): Promise<OkResponse> {
    return this.request(`/v1/memory/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
  }
}
