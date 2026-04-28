/**
 * routes/context.ts — Shared route context, guards, middleware helpers.
 *
 * Every route module receives a RouteContext containing the shared
 * service instances needed to handle requests. Guards implement
 * ownership and RBAC checks used across multiple route modules.
 *
 * Middleware helpers (ARC-5):
 *   - registerWithLegacy() — register both /v1/ and legacy paths in one call
 *   - withValidation()     — wrap Zod body parsing into a handler decorator
 *   - withOwnership()      — wrap ownership check, passes session to handler
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { z } from 'zod';
import type { SessionManager, SessionInfo } from '../session.js';
import type { TmuxManager } from '../tmux.js';
import type { AuthManager, ApiKeyPermission, ApiKeyRole } from '../services/auth/index.js';
import type { QuotaManager } from '../services/auth/QuotaManager.js';
import type { Config } from '../config.js';
import { SYSTEM_TENANT } from '../config.js';
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
import type { MeteringService } from '../metering.js';
import type { MetricsCache } from '../services/metrics-cache.js';

/** Shared route handler types */
export type IdParams = { Params: { id: string } };
export type IdRequest = FastifyRequest<IdParams>;

/** All shared service instances that route modules need. */
export interface RouteContext {
  sessions: SessionManager;
  tmux: TmuxManager;
  auth: AuthManager;
  quotas: QuotaManager;
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
  /** Issue #1911: Mutable server draining state — flipped to true before app.close() during graceful shutdown. */
  serverState: { draining: boolean };
  /** Issue #1954: Billing/metering service. */
  metering: MeteringService;
  /** Issue #2250: Persistent analytics cache. */
  metricsCache: MetricsCache;
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
  if (!auth.authEnabled) return true;
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

export function requirePermission(
  auth: AuthManager,
  req: FastifyRequest,
  reply: FastifyReply,
  permission: ApiKeyPermission,
): boolean {
  if (!auth.authEnabled) {
    req.matchedPermission = permission;
    return true;
  }
  if (req.authKeyId === null || req.authKeyId === undefined) {
    reply.status(401).send({ error: 'Unauthorized — Bearer token required' });
    return false;
  }
  if (!auth.hasPermission(req.authKeyId, permission)) {
    reply.status(403).send({ error: `Forbidden: missing ${permission} permission` });
    return false;
  }
  req.matchedPermission = permission;
  return true;
}

export function resolveAuditActor(
  auth: { getAuditActor?: (keyId: string | null | undefined, fallbackActor?: string) => string },
  keyId: string | null | undefined,
  fallbackActor: string,
): string {
  if (typeof auth.getAuditActor === 'function') {
    return auth.getAuditActor(keyId, fallbackActor);
  }
  if (keyId === null || keyId === undefined) return fallbackActor;
  return keyId === 'master' ? 'master' : 'api-key';
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
  tenantId?: string,
): SessionInfo | null {
  const session = sessions.getSession(sessionId);
  if (!session) {
    reply.status(404).send({ error: 'Session not found' });
    return null;
  }
  if (keyId === 'master' || keyId === null || keyId === undefined) return session;
  if (!session.ownerKeyId) return session;
  // Issue #2267: Tenant scoping — reject cross-tenant access.
  // SYSTEM_TENANT callers bypass scoping. Tenant-scoped callers can only access their own sessions.
  if (tenantId && tenantId !== SYSTEM_TENANT && session.tenantId !== tenantId) {
    reply.status(403).send({ error: 'Forbidden: session belongs to another tenant' });
    return null;
  }
  if (session.ownerKeyId !== keyId) {
    reply.status(403).send({ error: 'Forbidden: session owned by another API key' });
    return null;
  }
  return session;
}

/**
 * Issue #1910: Session ownership authorization for action routes.
 *
 * Checks that the caller is authorized to act on the session:
 *   1. Admin role bypasses ownership check.
 *   2. Caller must be the session owner (ownerKeyId match).
 *   3. Sessions without ownerKeyId (legacy) allow all callers.
 *   4. Master token / null auth bypasses (auth disabled).
 *
 * Controlled by `AEGIS_ENFORCE_SESSION_OWNERSHIP` config flag (default true).
 * Emits audit events for both allowed and denied attempts.
 *
 * Returns SessionInfo on success, null on failure (sends 404/403).
 */
export function requireSessionOwnership(
  ctx: RouteContext,
  sessionId: string,
  req: FastifyRequest,
  reply: FastifyReply,
  actionLabel = 'action',
): SessionInfo | null {
  const { sessions, auth, config, getAuditLogger } = ctx;
  const keyId = req.authKeyId;
  const session = sessions.getSession(sessionId);

  if (!session) {
    reply.status(404).send({ error: 'Session not found' });
    return null;
  }

  // Feature flag: when disabled, fall through to existing ownership guard only
  if (!config.enforceSessionOwnership) {
    return requireOwnership(sessions, sessionId, reply, keyId, req.tenantId);
  }

  // Master token / no-auth always passes
  if (keyId === 'master' || keyId === null || keyId === undefined) {
    return session;
  }

  // Legacy sessions without ownerKeyId allow all
  if (!session.ownerKeyId) {
    // Issue #2267: Still enforce tenant scoping on legacy sessions
    const callerTenantId = req.tenantId;
    if (callerTenantId && callerTenantId !== SYSTEM_TENANT && session.tenantId !== callerTenantId) {
      const audit = getAuditLogger();
      if (audit) void audit.log(resolveAuditActor(auth, keyId, 'api-key'), 'session.action.denied', `Cross-tenant ${actionLabel} denied on session ${sessionId} (tenant: ${session.tenantId})`, sessionId, callerTenantId);
      reply.status(403).send({ error: 'SESSION_FORBIDDEN', message: 'Session belongs to another tenant' });
      return null;
    }
    return session;
  }

  // Admin role bypasses ownership
  const role = auth.getRole(keyId);
  if (role === 'admin') {
    const audit = getAuditLogger();
    if (audit) void audit.log(resolveAuditActor(auth, keyId, 'api-key'), 'session.action.allowed', `Admin bypass for ${actionLabel} on session ${sessionId}`, sessionId);
    return session;
  }

  // Owner match
  if (session.ownerKeyId === keyId) {
    const audit = getAuditLogger();
    if (audit) void audit.log(resolveAuditActor(auth, keyId, 'api-key'), 'session.action.allowed', `Owner ${actionLabel} on session ${sessionId}`, sessionId);
    return session;
  }

  // Denied
  const audit = getAuditLogger();
  if (audit) void audit.log(resolveAuditActor(auth, keyId, 'api-key'), 'session.action.denied', `Non-owner ${actionLabel} denied on session ${sessionId} (owner: ${session.ownerKeyId})`, sessionId);
  reply.status(403).send({ error: 'SESSION_FORBIDDEN', message: 'You do not own this session' });
  return null;
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
    if (sessions) {
      const info = sessions.getPendingPermissionInfo(session.id);
      if (info) {
        result.pendingPermission = info;
      }
    }
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

// ── ARC-5 Middleware Helpers ──────────────────────────────────────

type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

/**
 * Register a route at both `/v1/...` and its legacy alias (without prefix)
 * in a single call. Reduces duplicate route registrations.
 *
 * Legacy alias routes emit `Deprecation` and `Sunset` headers per the
 * API versioning policy (Issue #1956). Consumers must migrate to `/v1/`
 * paths before the sunset date.
 *
 * Accepts the same argument forms as Fastify's shorthand methods:
 *   registerWithLegacy(app, 'get', '/v1/path', handler)
 *   registerWithLegacy(app, 'post', '/v1/path', { config: {...}, handler })
 */
export function registerWithLegacy(
  app: FastifyInstance,
  method: HttpMethod,
  v1Path: string,
  // Fastify's RouteShorthandMethod uses generics that prevent type-safe
  // dynamic dispatch across route schemas; accept unknown and delegate.
  handlerOrOpts: unknown,
): void {
  const legacyPath = v1Path.replace(/^\/v1/, '');
  const register = app[method].bind(app) as (path: string, opts: unknown) => void;
  register(v1Path, handlerOrOpts);

  // Issue #1956: Wrap legacy handler to add Deprecation + Sunset headers.
  // The Sunset date is set to 2027-01-01 — consumers must migrate before then.
  const SUNSET_DATE = 'Thu, 01 Jan 2027 00:00:00 GMT';
  if (legacyPath !== v1Path) {
    const wrappedOpts = wrapWithDeprecationHeaders(handlerOrOpts, v1Path, SUNSET_DATE);
    register(legacyPath, wrappedOpts);
  }
}

/**
 * Issue #1956: Wrap a handler or route options to inject Deprecation + Sunset
 * headers on legacy (unversioned) API paths.
 */
function wrapWithDeprecationHeaders(
  handlerOrOpts: unknown,
  v1Replacement: string,
  sunsetDate: string,
): unknown {
  // Fastify route options object with a handler function
  if (typeof handlerOrOpts === 'object' && handlerOrOpts !== null && 'handler' in handlerOrOpts) {
    const opts = handlerOrOpts as Record<string, unknown>;
    const originalHandler = opts.handler as (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
    return {
      ...opts,
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        addDeprecationHeaders(reply, v1Replacement, sunsetDate);
        return originalHandler(req, reply);
      },
    };
  }

  // Plain handler function
  if (typeof handlerOrOpts === 'function') {
    const originalHandler = handlerOrOpts as (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
    return async (req: FastifyRequest, reply: FastifyReply) => {
      addDeprecationHeaders(reply, v1Replacement, sunsetDate);
      return originalHandler(req, reply);
    };
  }

  // Fallback: return as-is (shouldn't happen in practice)
  return handlerOrOpts;
}

/**
 * Add RFC 8594 Deprecation and Sunset headers to the response.
 * Also adds X-API-Deprecated with the replacement path for easy migration.
 */
function addDeprecationHeaders(reply: FastifyReply, v1Replacement: string, sunsetDate: string): void {
  reply.header('Deprecation', 'true');
  reply.header('Sunset', sunsetDate);
  reply.header('X-API-Deprecated', `Use ${v1Replacement} instead`);
}

type RouteHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;

/**
 * Wrap a Zod schema parse around a route handler. On validation failure,
 * returns 400 with structured error details. On success, passes the
 * parsed data as a third argument to the inner handler.
 */
export function withValidation<T>(
  schema: z.ZodType<T>,
  handler: (req: FastifyRequest, reply: FastifyReply, data: T) => Promise<unknown> | unknown,
): RouteHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }
    return handler(req, reply, parsed.data);
  };
}

/**
 * Wrap an ownership check around a session route handler. Validates that
 * the caller owns the session identified by `req.params.id`, then passes
 * the resolved SessionInfo to the inner handler.
 */
export function withOwnership(
  sessions: SessionManager,
  handler: (req: FastifyRequest, reply: FastifyReply, session: SessionInfo) => Promise<unknown> | unknown,
): RouteHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const id = (req.params as { id: string }).id;
    const session = requireOwnership(sessions, id, reply, req.authKeyId, req.tenantId);
    if (!session) return;
    return handler(req, reply, session);
  };
}

/**
 * Issue #1910: Wrap session ownership authz around a route handler.
 * Uses requireSessionOwnership() which adds admin bypass, audit emission,
 * and AEGIS_ENFORCE_SESSION_OWNERSHIP config flag support.
 */
export function withSessionOwnership(
  ctx: RouteContext,
  handler: (req: FastifyRequest, reply: FastifyReply, session: SessionInfo) => Promise<unknown> | unknown,
  actionLabel?: string,
): RouteHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const id = (req.params as { id: string }).id;
    const session = requireSessionOwnership(ctx, id, req, reply, actionLabel);
    if (!session) return;
    return handler(req, reply, session);
  };
}
