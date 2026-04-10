/**
 * route-deps.ts — Shared dependency bag for route plugins.
 *
 * All route plugins receive a RouteDeps object containing references to
 * the shared state and services initialized in server.ts main().
 */

import type { FastifyInstance } from 'fastify';
import type { TmuxManager } from '../tmux.js';
import type { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';
import type { SessionMonitor } from '../monitor.js';
import type { SessionEventBus } from '../events.js';
import type { ChannelManager } from '../channels/index.js';
import type { SessionEvent } from '../channels/index.js';
import type { SessionEventPayload } from '../channels/index.js';
import type { PipelineManager } from '../pipeline.js';
import type { ToolRegistry } from '../tool-registry.js';
import type { AuthManager } from '../auth.js';
import type { MetricsCollector } from '../metrics.js';
import type { SSEConnectionLimiter } from '../sse-limiter.js';
import type { SwarmMonitor } from '../swarm-monitor.js';
import type { MemoryBridge } from '../memory-bridge.js';
import type { AuditLogger } from '../audit.js';
import type { AlertManager } from '../alerting.js';
import type { Config } from '../config.js';

export interface RouteDeps {
  config: Config;
  app: FastifyInstance;
  tmux: TmuxManager;
  sessions: SessionManager;
  monitor: SessionMonitor;
  eventBus: SessionEventBus;
  channels: ChannelManager;
  pipelines: PipelineManager;
  toolRegistry: ToolRegistry;
  auth: AuthManager;
  metrics: MetricsCollector;
  sseLimiter: SSEConnectionLimiter;
  swarmMonitor: SwarmMonitor;
  memoryBridge: MemoryBridge | null;
  auditLogger: AuditLogger | undefined;
  alertManager: AlertManager;
  requestKeyMap: Map<string, string>;
  validateWorkDir: (workDir: string) => Promise<string | { error: string; code?: string }>;
  makePayload: (event: SessionEvent, sessionId: string, detail: string, meta?: Record<string, unknown>) => SessionEventPayload;
  cleanupTerminatedSessionState: (sessionId: string, deps: { monitor: SessionMonitor; metrics: MetricsCollector; toolRegistry: ToolRegistry }) => void;
  requireRole: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, ...allowedRoles: import('../auth.js').ApiKeyRole[]) => boolean;
  requireOwnership: (sessionId: string, reply: import('fastify').FastifyReply, keyId: string | null | undefined) => SessionInfo | null;
}
