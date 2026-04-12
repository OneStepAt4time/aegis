/**
 * routes/context.ts — Shared route context, guards, and helpers.
 *
 * Every route module receives a RouteContext containing the shared
 * service instances needed to handle requests. Guards implement
 * ownership and RBAC checks used across multiple route modules.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { SessionManager, SessionInfo } from '../session.js';
import type { TmuxManager } from '../tmux.js';
import type { AuthManager, ApiKeyRole } from '../services/auth/index.js';
import type { Config } from '../config.js';
import type { MetricsCollector } from '../metrics.js';
import type { SessionMonitor } from '../monitor.js';
import type { SessionEventBus } from '../events.js';
import type { ChannelManager, SessionEvent, SessionEventPayload } from '../channels/index.js';
import type { JsonlWatcher } from '../jsonl-watcher.js';
import type { PipelineManager } from '../pipeline.js';
import type { ToolRegistry } from '../tool-registry.js';
import type { AuditLogger } from '../audit.js';
import type { AlertManager } from '../alerting.js';
import type { SwarmMonitor } from '../swarm-monitor.js';
import type { SSEConnectionLimiter } from '../sse-limiter.js';
import type { MemoryBridge } from '../memory-bridge.js';

/** Shared route handler types */
export type IdParams = { Params: { id: string } };
export type IdRequest = FastifyRequest<IdParams>;

/** All shared service instances that route modules need. */
export interface RouteContext {
  sessions: SessionManager;
  tmux: TmuxManager;
  auth: AuthManager;
  config: Config;
  metrics: MetricsCollector;
  monitor: SessionMonitor;
  eventBus: SessionEventBus;
  channels: ChannelManager;
  jsonlWatcher: JsonlWatcher;
  pipelines: PipelineManager;
  toolRegistry: ToolRegistry;
  getAuditLogger: () => AuditLogger | undefined;
  alertManager: AlertManager;
  swarmMonitor: SwarmMonitor;
  sseLimiter: SSEConnectionLimiter;
  memoryBridge: MemoryBridge | null;
  /** Key→reqId map for batch rate limiting (#583) */
  requestKeyMap: Map<string, string>;
  /** Validate workDir against allowed dirs config */
  validateWorkDir: (workDir: string) => Promise<string | { error: string; code: string }>;
}

/**
 * RBAC guard — checks if the authenticated key has one of the allowed roles.
 * Sends 401/403 on failure and returns false; returns true on success.
 */
export function requireRole(
  auth: AuthManager,
  req: FastifyRequest,
  reply: FastifyReply,
  ...allowedRoles: ApiKeyRole[]
): boolean {
  if (auth.authEnabled && (req.authKeyId === null || req.authKeyId === undefined)) {
    reply.status(401).send({ error: 'Unauthorized — Bearer token required' });
    return false;
  }
  const keyId = req.authKeyId ?? null;
  const role = auth.getRole(keyId);
  if (!allowedRoles.includes(role)) {
    reply.status(403).send({ error: 'Forbidden: insufficient role' });
    return false;
  }
  return true;
}

/**
 * Session ownership guard — returns SessionInfo on success, null on failure.
 * Sends 404/403 on denial.
 */
export function requireOwnership(
  sessions: SessionManager,
  sessionId: string,
  reply: FastifyReply,
  keyId: string | null | undefined,
): SessionInfo | null {
  const session = sessions.getSession(sessionId);
  if (!session) {
    reply.status(404).send({ error: 'Session not found' });
    return null;
  }
  if (keyId === 'master' || keyId === null || keyId === undefined) return session;
  if (!session.ownerKeyId) return session;
  if (session.ownerKeyId !== keyId) {
    reply.status(403).send({ error: 'Forbidden: session owned by another API key' });
    return null;
  }
  return session;
}

/** Issue #20: Add actionHints to session response for interactive states. */
export function addActionHints(
  session: SessionInfo,
  sessions?: SessionManager,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    ...session,
    activeSubagents: session.activeSubagents ? [...session.activeSubagents] : undefined,
  };
  if (session.status === 'permission_prompt' || session.status === 'bash_approval') {
    result.actionHints = {
      approve: { method: 'POST', url: `/v1/sessions/${session.id}/approve`, description: 'Approve the pending permission' },
      reject: { method: 'POST', url: `/v1/sessions/${session.id}/reject`, description: 'Reject the pending permission' },
    };
  }
  if (session.status === 'ask_question' && sessions) {
    const info = sessions.getPendingQuestionInfo(session.id);
    if (info) {
      result.pendingQuestion = {
        toolUseId: info.toolUseId,
        content: info.question,
        options: extractQuestionOptions(info.question),
        since: info.timestamp,
      };
    }
  }
  return result;
}

/** #599: Extract selectable options from AskUserQuestion text. */
export function extractQuestionOptions(text: string): string[] | null {
  const numberedRegex = /^\s*(\d+)\.\s+(.+)$/gm;
  const options: string[] = [];
  let m;
  while ((m = numberedRegex.exec(text)) !== null) {
    options.push(m[2].trim());
  }
  if (options.length >= 2) return options.slice(0, 4);
  return null;
}

/** Create a channel event payload with session context. */
export function makePayload(
  sessions: SessionManager,
  event: SessionEvent,
  sessionId: string,
  detail: string,
  meta?: Record<string, unknown>,
): SessionEventPayload {
  const session = sessions.getSession(sessionId);
  return {
    event,
    timestamp: new Date().toISOString(),
    session: {
      id: sessionId,
      name: session?.windowName || 'unknown',
      workDir: session?.workDir || '',
    },
    detail,
    ...(meta && { meta }),
  };
}
