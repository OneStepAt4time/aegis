/**
 * mcp/embedded.ts — In-process IAegisBackend adapter (direct class delegation).
 *
 * Used when the MCP server runs inside the same process as the Aegis HTTP server,
 * avoiding HTTP round-trips. AegisClient remains the remote-mode adapter.
 */

import { isValidUUID } from '../validation.js';
import type { SessionManager, SessionInfo } from '../session.js';
import type { TmuxManager } from '../tmux.js';
import type { MetricsCollector, SessionMetrics } from '../metrics.js';
import type { PipelineManager, PipelineState, BatchResult } from '../pipeline.js';
import type { MemoryBridge } from '../memory-bridge.js';
import type { SwarmMonitor } from '../swarm-monitor.js';
import { isSameOrChildWorkDir } from './client.js';
import type {
  IAegisBackend,
  ServerHealthResponse,
  CreateSessionResponse,
  SendMessageResponse,
  OkResponse,
  CapturePaneResponse,
  SessionLatencyResponse,
  MemoryEntryResponse,
} from '../services/interfaces.js';

export interface EmbeddedBackendDeps {
  sessions: SessionManager;
  tmux: TmuxManager;
  pipelines: PipelineManager;
  metrics: MetricsCollector;
  memory: MemoryBridge | null;
  swarm: SwarmMonitor | null;
  version: string;
}

export class EmbeddedBackend implements IAegisBackend {
  private readonly sessions: SessionManager;
  private readonly tmux: TmuxManager;
  private readonly pipelines: PipelineManager;
  private readonly metrics: MetricsCollector;
  private readonly memory: MemoryBridge | null;
  private readonly swarm: SwarmMonitor | null;
  private readonly version: string;
  private readonly role: string;

  constructor(deps: EmbeddedBackendDeps, role = 'admin') {
    this.sessions = deps.sessions;
    this.tmux = deps.tmux;
    this.pipelines = deps.pipelines;
    this.metrics = deps.metrics;
    this.memory = deps.memory;
    this.swarm = deps.swarm;
    this.version = deps.version;
    this.role = role;
  }

  private requireSession(id: string): SessionInfo {
    if (!isValidUUID(id)) throw new Error(`Invalid session ID: ${id}`);
    const session = this.sessions.getSession(id);
    if (!session) throw new Error('Session not found');
    return session;
  }

  // ── IAuthService ──────────────────────────────────────────────────

  async resolveRole(): Promise<string> {
    return this.role;
  }

  // ── ISessionService ───────────────────────────────────────────────

  async listSessions(filter?: { status?: string; workDir?: string }): Promise<SessionInfo[]> {
    let result = this.sessions.listSessions();
    if (filter?.status) result = result.filter(s => s.status === filter.status);
    if (filter?.workDir) result = result.filter(s => isSameOrChildWorkDir(s.workDir, filter.workDir!));
    return result;
  }

  async getSession(id: string): Promise<Record<string, unknown>> {
    return this.requireSession(id) as unknown as Record<string, unknown>;
  }

  async getHealth(id: string): Promise<Record<string, unknown>> {
    this.requireSession(id);
    const health = await this.sessions.getHealth(id);
    return health as unknown as Record<string, unknown>;
  }

  async getTranscript(id: string): Promise<Record<string, unknown>> {
    this.requireSession(id);
    const messages = await this.sessions.readMessages(id);
    return messages as unknown as Record<string, unknown>;
  }

  async createSession(opts: { workDir: string; name?: string; prompt?: string }): Promise<CreateSessionResponse> {
    // Try idle session reuse (matches HTTP route behavior)
    const idle = await this.sessions.findIdleSessionByWorkDir(opts.workDir);
    if (idle) {
      let promptDelivery: { delivered: boolean; attempts: number } | undefined;
      if (opts.prompt) {
        promptDelivery = await this.sessions.sendInitialPrompt(idle.id, opts.prompt);
      }
      return {
        id: idle.id,
        windowName: idle.windowName,
        workDir: idle.workDir,
        status: idle.status,
        reused: true,
        promptDelivery,
      };
    }

    const session = await this.sessions.createSession({
      workDir: opts.workDir,
      name: opts.name,
    });
    let promptDelivery: { delivered: boolean; attempts: number } | undefined;
    if (opts.prompt) {
      promptDelivery = await this.sessions.sendInitialPrompt(session.id, opts.prompt);
    }
    return {
      id: session.id,
      windowName: session.windowName,
      workDir: session.workDir,
      status: session.status,
      promptDelivery,
    };
  }

  async killSession(id: string): Promise<OkResponse> {
    this.requireSession(id);
    await this.sessions.killSession(id);
    return { ok: true };
  }

  async sendMessage(id: string, text: string): Promise<SendMessageResponse> {
    this.requireSession(id);
    const result = await this.sessions.sendMessage(id, text);
    return { ok: true, ...result };
  }

  async approvePermission(id: string): Promise<OkResponse> {
    this.requireSession(id);
    await this.sessions.approve(id);
    return { ok: true };
  }

  async rejectPermission(id: string): Promise<OkResponse> {
    this.requireSession(id);
    await this.sessions.reject(id);
    return { ok: true };
  }

  async escapeSession(id: string): Promise<OkResponse> {
    this.requireSession(id);
    await this.sessions.escape(id);
    return { ok: true };
  }

  async interruptSession(id: string): Promise<OkResponse> {
    this.requireSession(id);
    await this.sessions.interrupt(id);
    return { ok: true };
  }

  async capturePane(id: string): Promise<CapturePaneResponse> {
    const session = this.requireSession(id);
    const pane = await this.tmux.capturePane(session.windowId);
    return { pane };
  }

  async sendBash(id: string, command: string): Promise<OkResponse> {
    this.requireSession(id);
    const cmd = command.startsWith('!') ? command : `!${command}`;
    await this.sessions.sendMessage(id, cmd);
    return { ok: true };
  }

  async sendCommand(id: string, command: string): Promise<OkResponse> {
    this.requireSession(id);
    const cmd = command.startsWith('/') ? command : `/${command}`;
    await this.sessions.sendMessage(id, cmd);
    return { ok: true };
  }

  async getSessionSummary(id: string): Promise<Record<string, unknown>> {
    this.requireSession(id);
    const summary = await this.sessions.getSummary(id);
    return summary as unknown as Record<string, unknown>;
  }

  async getSessionMetrics(id: string): Promise<SessionMetrics> {
    this.requireSession(id);
    const m = this.metrics.getSessionMetrics(id);
    if (!m) throw new Error('Metrics not found');
    return m;
  }

  async getSessionLatency(id: string): Promise<SessionLatencyResponse> {
    this.requireSession(id);
    return {
      sessionId: id,
      realtime: this.sessions.getLatencyMetrics(id) ?? null,
      aggregated: this.metrics.getSessionLatency(id) ?? null,
    };
  }

  // ── IServerService ────────────────────────────────────────────────

  async getServerHealth(): Promise<ServerHealthResponse> {
    const tmuxHealth = await this.tmux.isServerHealthy();
    return {
      status: tmuxHealth.healthy ? 'ok' : 'degraded',
      version: this.version,
      platform: process.platform,
      uptime: process.uptime(),
      sessions: {
        active: this.sessions.listSessions().length,
        total: this.metrics.getTotalSessionsCreated(),
      },
      tmux: tmuxHealth,
      timestamp: new Date().toISOString(),
    };
  }

  async getSwarm(): Promise<Record<string, unknown>> {
    if (!this.swarm) return {};
    const result = this.swarm.getLastResult();
    return (result ?? {}) as Record<string, unknown>;
  }

  // ── IPipelineService ──────────────────────────────────────────────

  async batchCreateSessions(sessions: Array<{ workDir: string; name?: string; prompt?: string }>): Promise<BatchResult> {
    return this.pipelines.batchCreate(sessions);
  }

  async listPipelines(): Promise<PipelineState[]> {
    return this.pipelines.listPipelines();
  }

  async createPipeline(config: { name: string; workDir: string; steps: Array<{ name?: string; prompt: string }> }): Promise<PipelineState> {
    return this.pipelines.createPipeline({
      name: config.name,
      workDir: config.workDir,
      stages: config.steps.map((s, i) => ({ name: s.name ?? `step-${i + 1}`, prompt: s.prompt })),
    });
  }

  // ── IMemoryService ────────────────────────────────────────────────

  async setMemory(key: string, value: string, ttlSeconds?: number): Promise<MemoryEntryResponse> {
    if (!this.memory) throw new Error('Memory bridge not available');
    const entry = this.memory.set(key, value, ttlSeconds);
    return { entry };
  }

  async getMemory(key: string): Promise<MemoryEntryResponse> {
    if (!this.memory) throw new Error('Memory bridge not available');
    const entry = this.memory.get(key);
    if (!entry) throw new Error(`Memory key not found: ${key}`);
    return { entry };
  }

  async deleteMemory(key: string): Promise<OkResponse> {
    if (!this.memory) throw new Error('Memory bridge not available');
    this.memory.delete(key);
    return { ok: true };
  }
}
