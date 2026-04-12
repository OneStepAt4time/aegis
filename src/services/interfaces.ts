/**
 * services/interfaces.ts — Shared service interfaces for MCP and HTTP layers.
 *
 * These interfaces abstract the Aegis backend so MCP tools can operate
 * in both remote mode (via HTTP/AegisClient) and embedded mode (direct calls).
 */

import type { SessionInfo } from '../session.js';
import type { SessionMetrics, SessionLatencySummary } from '../metrics.js';
import type { PipelineState, BatchResult } from '../pipeline.js';

// ── Response types ──────────────────────────────────────────────────

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
  realtime: {
    hook_latency_ms: number | null;
    state_change_detection_ms: number | null;
    permission_response_ms: number | null;
  } | null;
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

// ── Domain interfaces ───────────────────────────────────────────────

export interface ISessionService {
  listSessions(filter?: { status?: string; workDir?: string }): Promise<SessionInfo[]>;
  getSession(id: string): Promise<Record<string, unknown>>;
  getHealth(id: string): Promise<Record<string, unknown>>;
  getTranscript(id: string): Promise<Record<string, unknown>>;
  createSession(opts: { workDir: string; name?: string; prompt?: string }): Promise<CreateSessionResponse>;
  killSession(id: string): Promise<OkResponse>;
  sendMessage(id: string, text: string): Promise<SendMessageResponse>;
  approvePermission(id: string): Promise<OkResponse>;
  rejectPermission(id: string): Promise<OkResponse>;
  escapeSession(id: string): Promise<OkResponse>;
  interruptSession(id: string): Promise<OkResponse>;
  capturePane(id: string): Promise<CapturePaneResponse>;
  sendBash(id: string, command: string): Promise<OkResponse>;
  sendCommand(id: string, command: string): Promise<OkResponse>;
  getSessionSummary(id: string): Promise<Record<string, unknown>>;
  getSessionMetrics(id: string): Promise<SessionMetrics>;
  getSessionLatency(id: string): Promise<SessionLatencyResponse>;
}

export interface IServerService {
  getServerHealth(): Promise<ServerHealthResponse>;
  getSwarm(): Promise<Record<string, unknown>>;
}

export interface IPipelineService {
  batchCreateSessions(sessions: Array<{ workDir: string; name?: string; prompt?: string }>): Promise<BatchResult>;
  listPipelines(): Promise<PipelineState[]>;
  createPipeline(config: { name: string; workDir: string; steps: Array<{ name?: string; prompt: string }> }): Promise<PipelineState>;
}

export interface IMemoryService {
  setMemory(key: string, value: string, ttlSeconds?: number): Promise<MemoryEntryResponse>;
  getMemory(key: string): Promise<MemoryEntryResponse>;
  deleteMemory(key: string): Promise<OkResponse>;
}

export interface IAuthService {
  resolveRole(): Promise<string>;
}

/** Composite backend interface — everything the MCP layer needs. */
export interface IAegisBackend extends ISessionService, IServerService, IPipelineService, IMemoryService, IAuthService {}
