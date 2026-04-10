/**
 * server.ts — HTTP API server for Aegis.
 *
 * Exposes RESTful endpoints for creating, managing, and interacting
 * with Claude Code sessions running in tmux.
 *
 * Notification channels (Telegram, webhooks, etc.) are pluggable —
 * the server doesn't know which channels are active.
 *
 * Route handlers are decomposed into focused Fastify plugins under
 * src/routes/ — this file wires them together.
 */

import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import fs from 'node:fs/promises';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TmuxManager } from './tmux.js';
import { SessionManager, type SessionInfo } from './session.js';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG } from './monitor.js';
import { JsonlWatcher } from './jsonl-watcher.js';
import {
  ChannelManager,
  TelegramChannel,
  SlackChannel,
  EmailChannel,
  WebhookChannel,
  type InboundCommand,
  type SessionEvent,
  type SessionEventPayload,
} from './channels/index.js';
import { loadConfig, type Config } from './config.js';
import { SessionEventBus } from './events.js';
import { SSEConnectionLimiter } from './sse-limiter.js';
import { PipelineManager } from './pipeline.js';
import { ToolRegistry } from './tool-registry.js';
import { AuthManager, classifyBearerTokenForRoute, type ApiKeyRole } from './auth.js';
import { AuditLogger } from './audit.js';
import { MetricsCollector } from './metrics.js';
import { registerPermissionRoutes } from './permission-routes.js';
import { registerHookRoutes } from './hooks.js';
import { registerWsTerminalRoute } from './ws-terminal.js';
import { registerMemoryRoutes } from './memory-routes.js';
import { SwarmMonitor } from './swarm-monitor.js';
import { killAllSessions } from './signal-cleanup-helper.js';
import { validateWorkDir, isValidUUID, parseIntSafe } from './validation.js';
import { setStructuredLogSink } from './logger.js';
import { MemoryBridge } from './memory-bridge.js';
import { cleanupTerminatedSessionState } from './session-cleanup.js';
import { normalizeApiErrorPayload } from './api-error-envelope.js';
import { listenWithRetry, removePidFile, writePidFile } from './startup.js';
import { AlertManager } from './alerting.js';
import { isWindowsShutdownMessage, parseShutdownTimeoutMs } from './shutdown-utils.js';
import {
  checkIpRateLimit, checkAuthFailRateLimit, recordAuthFailure,
  pruneIpRateLimits, pruneAuthFailLimits,
} from './rate-limit.js';
import type { RouteDeps } from './routes/route-deps.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerEventRoutes } from './routes/events.js';
import { registerPipelineRoutes } from './routes/pipelines.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerDiagnosticRoutes } from './routes/diagnostics.js';

// Preserve public export used by tests and external imports.
export { readParentPid as readPpid } from './process-utils.js';

/** Timing-safe string comparison to prevent timing attacks on secret values. */
function timingSafeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// #1108: Fastify request decoration — type-safe authKeyId
declare module 'fastify' {
  interface FastifyRequest {
    authKeyId?: string | null;
  }
}

// ── Configuration ────────────────────────────────────────────────────

// Issue #349: CSP policy for dashboard responses (shared between static and SPA fallback)
const DASHBOARD_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss: https://registry.npmjs.org";

// Config loaded at startup; env vars override file values
let config: Config;

// These will be initialized after config is loaded
let tmux: TmuxManager;
let sessions: SessionManager;
let monitor: SessionMonitor;
let jsonlWatcher: JsonlWatcher;
const channels = new ChannelManager();
const eventBus = new SessionEventBus();
let memoryBridge: MemoryBridge | null = null;
let sseLimiter: SSEConnectionLimiter;
let pipelines: PipelineManager;
let toolRegistry: ToolRegistry;
let auth: AuthManager;
let metrics: MetricsCollector;
let auditLogger: AuditLogger | undefined;
let swarmMonitor: SwarmMonitor;
let alertManager: AlertManager;

// ── Auth guards (shared with route plugins via RouteDeps) ─────────────

function requireRole(req: FastifyRequest, reply: FastifyReply, ...allowedRoles: ApiKeyRole[]): boolean {
  const keyId = req.authKeyId ?? null;
  const role = auth.getRole(keyId);
  if (!allowedRoles.includes(role)) {
    reply.status(403).send({ error: 'Forbidden: insufficient role' });
    return false;
  }
  return true;
}

function requireOwnership(
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

// ── Inbound command handler ─────────────────────────────────────────

function makePayload(
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

async function handleInbound(cmd: InboundCommand): Promise<void> {
  try {
    switch (cmd.action) {
      case 'approve':
        await sessions.approve(cmd.sessionId);
        break;
      case 'reject':
        await sessions.reject(cmd.sessionId);
        break;
      case 'escape':
        await sessions.escape(cmd.sessionId);
        break;
      case 'kill':
        // #842: killSession first, then notify — avoids race where channels
        // reference a session that is still being destroyed.
        await sessions.killSession(cmd.sessionId);
        await channels.sessionEnded(makePayload('session.ended', cmd.sessionId, 'killed'));
        cleanupTerminatedSessionState(cmd.sessionId, { monitor, metrics, toolRegistry });
        break;
      case 'message':
      case 'command':
        if (cmd.text) await sessions.sendMessage(cmd.sessionId, cmd.text);
        break;
    }
  } catch (e) {
    console.error(`Inbound command error [${cmd.action}]:`, e);
  }
}

// ── HTTP Server ─────────────────────────────────────────────────────

const app = Fastify({
  bodyLimit: 1048576, // 1MB — Issue #349: explicit body size limit
  trustProxy: process.env.TRUST_PROXY === 'true', // #633: Only trust X-Forwarded-For when explicitly enabled
  // Issue #1416: UUID-v4 request IDs for log correlation across components
  requestIdHeader: 'x-request-id',
  genReqId: () => crypto.randomUUID(),
  logger: {
    // #230: Redact auth tokens and hook secrets from request logs
    // #1393: Also redact ?secret= query param used by hook auth fallback
    serializers: {
      req(req) {
        let url = req.url ?? '';
        url = url.replace(/token=[^&]*/g, 'token=[REDACTED]');
        url = url.replace(/secret=[^&]*/g, 'secret=[REDACTED]');
        return {
          method: req.method,
          url,
          // ...rest intentionally omitted — prevents token leakage via headers
        };
      },
    },
  },
});

// #1108: Decorate request with authKeyId — type-safe alternative to unsafe cast
app.decorateRequest('authKeyId', null as unknown as string);

setStructuredLogSink({
  info: (record) => app.log.info(record),
  warn: (record) => app.log.warn(record),
  error: (record) => app.log.error(record),
});

// #227: Security headers on all API responses (skip SSE)
app.addHook('onSend', (req, reply, payload, done) => {
  const contentType = reply.getHeader('content-type');
  if (typeof contentType === 'string' && contentType.includes('text/event-stream')) {
    return done();
  }
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  // E5-2: API versioning — all /v1/ responses include version header
  if (req.url?.startsWith('/v1/')) {
    reply.header('X-Aegis-API-Version', '1');
  }
  // Issue #1416: Return request ID in response header for client-side correlation
  reply.header('X-Request-Id', req.id);
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=()');
  const normalizedPayload = normalizeApiErrorPayload({
    payload,
    statusCode: reply.statusCode,
    requestId: req.id,
    contentType: typeof contentType === 'string' ? contentType : undefined,
  });
  done(null, normalizedPayload);
});

// Auth middleware setup (Issue #39: multi-key auth with rate limiting)
function setupAuth(authManager: AuthManager): void {
  app.addHook('onRequest', async (req, reply) => {
    // Skip auth for health endpoint and dashboard (Issue #349: exact path matching)
    // #126: Dashboard is served as public static files; API endpoints are protected
    const urlPath = req.url?.split('?')[0] ?? '';
    if (urlPath === '/health' || urlPath === '/v1/health') return;
    // Auth verification is a public bootstrap endpoint for dashboard login.
    if (urlPath === '/v1/auth/verify') return;
    if (urlPath === '/dashboard' || urlPath.startsWith('/dashboard/')) return;
    // Hook routes — exact match: /v1/hooks/{eventName} (alpha only, no path traversal)
    // Issue #394: Require valid X-Session-Id for known sessions instead of blanket bypass.
    // Issue #580: Validate UUID format before getSession lookup.
    // Issue #629: Validate per-session hook secret to prevent replay with known session ID.
    // CC hooks run from localhost and always include the session ID they were started with.
    const hookMatch = /^\/v1\/hooks\/[A-Za-z]+$/.exec(urlPath);
    if (hookMatch) {
      const hookSessionId = (req.headers['x-session-id'] as string)
        || (req.query as Record<string, string>)?.sessionId;
      if (hookSessionId && !isValidUUID(hookSessionId)) {
        return reply.status(400).send({ error: 'Invalid session ID — must be a UUID' });
      }
      if (hookSessionId) {
        const session = sessions.getSession(hookSessionId);
        if (session) {
          // Issue #629/#1131: Validate hook secret from X-Hook-Secret header (query param fallback)
          const hookSecret = (req.headers['x-hook-secret'] as string)
            || (req.query as Record<string, string>)?.secret;
          if (!hookSecret || !timingSafeEqual(hookSecret, session.hookSecret)) {
            return reply.status(401).send({ error: 'Unauthorized — invalid hook secret' });
          }
          return; // valid session + secret — allow
        }
      }
      // No valid session context — reject even when auth is disabled
      return reply.status(401).send({ error: 'Unauthorized — hook endpoint requires valid session ID' });
    }
    // #303: WS terminal routes have their own preHandler for auth (supports ?token=)
    // Exact match: /v1/sessions/{id}/terminal
    if (/^\/v1\/sessions\/[^/]+\/terminal$/.test(urlPath)) return;

    // Issue #1557: /metrics requires authentication. When a dedicated metrics token
    // is configured (AEGIS_METRICS_TOKEN), accept either that or the primary auth token.
    // This runs before the general no-auth-localhost bypass so that /metrics is always
    // protected when a metrics token is set, even in dev mode.
    if (urlPath === '/metrics') {
      const metricsToken = config.metricsToken;
      const bearer = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : undefined;
      if (metricsToken) {
        // Dedicated metrics token configured — require it or the primary token
        if (bearer && (timingSafeEqual(bearer, metricsToken) || authManager.validate(bearer).valid)) {
          return; // authenticated
        }
        return reply.status(401).send({ error: 'Unauthorized — valid Bearer token or metrics token required' });
      }
      // No dedicated metrics token — fall through to normal auth flow below
    }

    // #1080: Only bypass auth if no credentials are configured AND server is bound to localhost.
    // When binding to a non-localhost interface (0.0.0.0, public IP) with no auth configured,
    // do NOT bypass — let validate() reject the request (it returns valid:false in this case).
    if (!authManager.authEnabled && authManager.isLocalhostBinding) return;

    // #124/#125: Accept token from Authorization header; ?token= query param
    // only on SSE routes where EventSource cannot set headers.
    // #297: SSE routes also accept short-lived SSE tokens via ?token=.
    // SSE routes: /v1/events and /v1/sessions/:id/events
    const isSSERoute = /^\/v1\/events$|^\/v1\/sessions\/[^/]+\/events$/.test(urlPath);
    let token: string | undefined;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      token = header.slice(7);
    } else if (isSSERoute) {
      token = (req.query as Record<string, string>).token;
    }

    if (!token) {
      return reply.status(401).send({ error: 'Unauthorized — Bearer token required' });
    }

    // #633: Only use req.ip — trustProxy controls whether X-Forwarded-For is considered
    const clientIp = req.ip ?? 'unknown';
    // #632: Block IPs that exceeded auth failure rate limit (5 attempts/min)
    if (checkAuthFailRateLimit(clientIp)) {
      return reply.status(429).send({ error: 'Too many auth failures — try again later' });
    }

    const tokenMode = classifyBearerTokenForRoute(token, !!isSSERoute);

    // #408: SSE endpoints require short-lived single-use SSE tokens.
    // Do not fall back to validating long-lived bearer/master tokens on /events.
    if (tokenMode === 'sse') {
      if (await authManager.validateSSEToken(token)) {
        return; // authenticated via short-lived SSE token
      }
      recordAuthFailure(clientIp);
      return reply.status(401).send({ error: 'Unauthorized — SSE token invalid or expired' });
    }

    if (tokenMode === 'reject') {
      recordAuthFailure(clientIp);
      return reply.status(401).send({ error: 'Unauthorized — SSE token required for event streams' });
    }

    const result = authManager.validate(token);

    if (!result.valid) {
      recordAuthFailure(clientIp);
      // Issue #1403: Distinguish expired keys from invalid keys
      if (result.reason === 'expired') {
        return reply.status(401).send({ error: 'Unauthorized — API key has expired', code: 'KEY_EXPIRED' });
      }
      return reply.status(401).send({ error: 'Unauthorized — invalid API key' });
    }

    if (result.rateLimited) {
      return reply.status(429).send({ error: 'Rate limit exceeded — 100 req/min per key' });
    }

    // #583: Store keyId for batch rate limiting
    // #634: Store validated keyId for SSE token endpoint to reuse
    requestKeyMap.set(req.id, result.keyId ?? 'anonymous');
    req.authKeyId = result.keyId;

    // #1419: Audit authenticated API calls (fire-and-forget, non-blocking)
    if (typeof auditLogger !== 'undefined') {
      void auditLogger.log(result.keyId ?? 'anonymous', 'api.authenticated', `${req.method} ${req.url?.split('?')[0] ?? req.url}`);
    }

    // #228: Per-IP rate limiting (applies to all authenticated requests)
    // #633: Only use req.ip — trustProxy controls whether X-Forwarded-For is considered
    const isMaster = result.keyId === 'master';
    if (checkIpRateLimit(clientIp, isMaster)) {
      return reply.status(429).send({ error: 'Rate limit exceeded — IP throttled' });
    }
  });
}

/** #583: Track keyId per request for batch rate limiting. */
const requestKeyMap = new Map<string, string>();

// #839: Clean up requestKeyMap entries after response to prevent unbounded memory leak.
app.addHook('onResponse', (req, _reply, done) => {
  requestKeyMap.delete(req.id);
  done();
});

// ── Start ────────────────────────────────────────────────────────────

/** Register notification channels from config */
function registerChannels(cfg: Config): void {
  // Telegram (optional)
  if (cfg.tgBotToken && cfg.tgGroupId) {
    channels.register(new TelegramChannel({
      botToken: cfg.tgBotToken,
      groupChatId: cfg.tgGroupId,
      allowedUserIds: cfg.tgAllowedUsers,
      topicTtlMs: cfg.tgTopicTtlMs,
    }));
  }

  // Webhooks (optional)
  if (cfg.webhooks.length > 0) {
    const webhookChannel = new WebhookChannel({
      endpoints: cfg.webhooks.map(url => ({ url })),
    });
    channels.register(webhookChannel);
  }

  // Slack (optional)
  const slackChannel = SlackChannel.fromEnv();
  if (slackChannel) {
    channels.register(slackChannel);
  }

  // Email (optional)
  const emailChannel = EmailChannel.fromEnv();
  if (emailChannel) {
    channels.register(emailChannel);
  }
}

// ── Session Reaper ──────────────────────────────────────────────────

async function reapStaleSessions(maxAgeMs: number): Promise<void> {
  const now = Date.now();
  // Snapshot list before iterating — killSession() modifies the sessions map
  const snapshot = [...sessions.listSessions()];
  for (const session of snapshot) {
    // Guard: session may have been deleted by DELETE handler between snapshot and here
    if (!sessions.getSession(session.id)) continue;
    const age = now - session.createdAt;
    if (age > maxAgeMs) {
    const ageMin = Math.round(age / 60000);
      console.log(
        `Reaper: killing session ${session.windowName} (${session.id.slice(0, 8)}) — age ${ageMin}min`,
      );
      try {
        // #842: killSession first, then notify — avoids race where channels
        // reference a session that is still being destroyed.
        await sessions.killSession(session.id);
        eventBus.cleanupSession(session.id);
        await channels.sessionEnded({
          event: 'session.ended',
          timestamp: new Date().toISOString(),
          session: { id: session.id, name: session.windowName, workDir: session.workDir },
          detail: `Auto-killed: exceeded ${maxAgeMs / 3600000}h time limit`,
        });
        cleanupTerminatedSessionState(session.id, { monitor, metrics, toolRegistry });
      } catch (e) {
        console.error(`Reaper: failed to kill session ${session.id}:`, e);
      }
    }
  }
}

// ── Zombie Reaper (Issue #283) ──────────────────────────────────────

const ZOMBIE_REAP_DELAY_MS = parseIntSafe(process.env.ZOMBIE_REAP_DELAY_MS, 60000);
const ZOMBIE_REAP_INTERVAL_MS = parseIntSafe(process.env.ZOMBIE_REAP_INTERVAL_MS, 60000);

async function reapZombieSessions(): Promise<void> {
  const now = Date.now();
  // Snapshot list before iterating — killSession() modifies the sessions map
  const snapshot = [...sessions.listSessions()];
  for (const session of snapshot) {
    // Guard: session may have been deleted between snapshot and here
    if (!sessions.getSession(session.id)) continue;
    if (!session.lastDeadAt) continue;
    const deadDuration = now - session.lastDeadAt;
    if (deadDuration < ZOMBIE_REAP_DELAY_MS) continue;

    console.log(`Reaper: removing zombie session ${session.windowName} (${session.id.slice(0, 8)})`);
    try {
      eventBus.cleanupSession(session.id);
      await sessions.killSession(session.id);
      cleanupTerminatedSessionState(session.id, { monitor, metrics, toolRegistry });
      await channels.sessionEnded({
        event: 'session.ended',
        timestamp: new Date().toISOString(),
        session: { id: session.id, name: session.windowName, workDir: session.workDir },
        detail: `Zombie reaped: dead for ${Math.round(deadDuration / 1000)}s`,
      });
    } catch (e) {
      console.error(`Reaper: failed to reap zombie session ${session.id}:`, e);
    }
  }
}

async function main(): Promise<void> {
  // Load configuration
  config = await loadConfig();

  // Initialize core components with config
  tmux = new TmuxManager(config.tmuxSession);
  sessions = new SessionManager(tmux, config);

  // Memory bridge (Issue #783)
  if (config.memoryBridge?.enabled) {
    const persistPath = config.memoryBridge.persistPath ?? path.join(config.stateDir, 'memory.json');
    memoryBridge = new MemoryBridge(persistPath, config.memoryBridge.reaperIntervalMs);
    await memoryBridge.load();
    memoryBridge.startReaper();
    registerMemoryRoutes(app, memoryBridge);
    console.error(`Memory bridge enabled, persisted at: ${persistPath}`);
  }

  sseLimiter = new SSEConnectionLimiter({ maxConnections: config.sseMaxConnections, maxPerIp: config.sseMaxPerIp });
  monitor = new SessionMonitor(sessions, channels, { ...DEFAULT_MONITOR_CONFIG, pollIntervalMs: 5000 });

  // Register channels
  registerChannels(config);

  // Setup auth (Issue #39: multi-key + backward compat)
  auth = new AuthManager(path.join(config.stateDir, 'keys.json'), config.authToken);
  auth.setHost(config.host);  // #1080: needed for auth bypass security check
  await auth.load();

  // #1419: Initialize audit logger and wire into auth
  auditLogger = new AuditLogger(path.join(config.stateDir, 'audit'));
  await auditLogger.init();
  auth.setAuditLogger(auditLogger);

  setupAuth(auth);

  // Register WebSocket plugin for live terminal streaming (Issue #108)
  await app.register(fastifyWebsocket);
  registerWsTerminalRoute(app, sessions, tmux, auth);

  // #217: CORS configuration — restrictive by default
  // #413: Reject wildcard CORS_ORIGIN — * is insecure and allows any origin
  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin === '*') {
    throw new Error('CORS_ORIGIN=* wildcard is not allowed. Specify explicit origins (comma-separated) or leave unset to disable CORS.');
  }
  await app.register(fastifyCors, {
    origin: corsOrigin ? corsOrigin.split(',').map(s => s.trim()) : false,
  });

  // Load persisted sessions
  await sessions.load();
  await tmux.ensureSession();

  // Initialize channels
  await channels.init(handleInbound);

  // Wire SSE event bus (Issue #32)
  monitor.setEventBus(eventBus);

  // Issue #397: Wire TmuxManager for tmux health monitoring
  monitor.setTmuxManager(tmux);

  // Issue #1418: Wire AlertManager for production alerting
  alertManager = new AlertManager(config.alerting);
  monitor.setAlertManager(alertManager);

  // Issue #84: Wire JSONL watcher for fs.watch-based message detection
  jsonlWatcher = new JsonlWatcher();
  monitor.setJsonlWatcher(jsonlWatcher);

  // Issue #488: Accumulate token usage from JSONL events into per-session metrics.
  jsonlWatcher.onEntries((event) => {
    const { tokenUsageDelta } = event;
    if (tokenUsageDelta.inputTokens > 0 || tokenUsageDelta.outputTokens > 0) {
      if (metrics) {
        const model = sessions.getSession(event.sessionId)?.model;
        metrics.recordTokenUsage(event.sessionId, tokenUsageDelta, model);
      }
    }
  });

  // Start watching JSONL files for already-discovered sessions
  for (const session of sessions.listSessions()) {
    if (session.jsonlPath) {
      jsonlWatcher.watch(session.id, session.jsonlPath, session.monitorOffset);
    }
  }

  // Register HTTP hook receiver (Issue #169, Issue #87: pass metrics for latency tracking)
  registerHookRoutes(app, { sessions, eventBus, metrics });

  // Initialize pipeline manager (Issue #36, #1424)
  pipelines = new PipelineManager(sessions, eventBus, config.stateDir);
  await pipelines.hydrate(config.stateDir);

  // Initialize metrics (Issue #40)
  metrics = new MetricsCollector(path.join(config.stateDir, 'metrics.json'));
  await metrics.load();

  // Issue #1418: Initialize production alerting
  if (config.alerting.webhooks.length > 0) {
    console.log(`Alerting enabled: ${config.alerting.webhooks.length} webhook(s), threshold=${config.alerting.failureThreshold}`);
  }

  // ── Register route plugins ─────────────────────────────────────────
  // Order matters: auth middleware and hooks are registered above;
  // these route plugins register their specific endpoints.

  const validateWorkDirWithConfig = (workDir: string) => validateWorkDir(workDir, config.allowedWorkDirs);

  const routeDeps: RouteDeps = {
    config,
    app,
    tmux,
    sessions,
    monitor,
    eventBus,
    channels,
    pipelines,
    toolRegistry,
    auth,
    metrics,
    sseLimiter,
    swarmMonitor: new SwarmMonitor(sessions), // placeholder — replaced below
    memoryBridge,
    auditLogger,
    alertManager,
    requestKeyMap,
    validateWorkDir: validateWorkDirWithConfig,
    makePayload,
    cleanupTerminatedSessionState,
    requireRole,
    requireOwnership,
  };

  // #412: Reject non-UUID session IDs at the routing layer
  app.addHook('onRequest', async (req, reply) => {
    const id = (req.params as Record<string, string | undefined>).id;
    if (id !== undefined && !isValidUUID(id)) {
      return reply.status(400).send({ error: 'Invalid session ID — must be a UUID' });
    }
  });

  // Register route plugins in the same order as the original inline routes
  registerHealthRoutes(app, routeDeps);
  registerAuthRoutes(app, routeDeps);
  registerSessionRoutes(app, routeDeps);
  registerEventRoutes(app, routeDeps);
  registerPipelineRoutes(app, routeDeps);
  registerTemplateRoutes(app, routeDeps);
  registerDiagnosticRoutes(app, routeDeps);

  // Register permission routes (already extracted — just needs deps)
  registerPermissionRoutes(
    app,
    {
      approve: async (id: string) => sessions.approve(id),
      reject: async (id: string) => sessions.reject(id),
      getLatencyMetrics: (id: string) => sessions.getLatencyMetrics(id),
      getSession: (id: string) => sessions.getSession(id),
    },
    {
      recordPermissionResponse: (id: string, latencyMs: number) => metrics.recordPermissionResponse(id, latencyMs),
    },
    auditLogger ?? null,
  );

  // Issue #361: Store interval refs so graceful shutdown can clear them
  const reaperInterval = setInterval(() => reapStaleSessions(config.maxSessionAgeMs), config.reaperIntervalMs);
  const zombieReaperInterval = setInterval(() => reapZombieSessions(), ZOMBIE_REAP_INTERVAL_MS);
  const metricsSaveInterval = setInterval(() => { void metrics.save(); }, 5 * 60 * 1000);
  // #357: Prune stale IP rate-limit entries every minute
  const ipPruneInterval = setInterval(pruneIpRateLimits, 60_000);
  // #632: Prune stale auth failure rate-limit buckets every minute
  const authFailPruneInterval = setInterval(pruneAuthFailLimits, 60_000);
  // #398: Sweep stale API key rate limit buckets every 5 minutes
  const authSweepInterval = setInterval(() => auth.sweepStaleRateLimits(), 5 * 60 * 1000);
  let pidFilePath = '';

  // Issue #361: Graceful shutdown handler
  // Issue #415: Reentrance guard at handler level prevents double execution on rapid SIGINT
  let shuttingDown = false;
  const shutdownTimeoutMs = parseShutdownTimeoutMs(process.env.AEGIS_SHUTDOWN_TIMEOUT_MS);
  async function gracefulShutdown(signal: string): Promise<void> {
    console.log(`${signal} received, shutting down gracefully...`);

    const forceExitTimer = setTimeout(() => {
      console.error(`Graceful shutdown timed out after ${shutdownTimeoutMs}ms — forcing process exit`);
      process.exit(1);
    }, shutdownTimeoutMs);
    forceExitTimer.unref?.();

    try {

      // 1. Stop accepting new requests
      try { await app.close(); } catch (e) { console.error('Error closing server:', e); }

      // 2. Stop background monitors and intervals
      monitor.stop();
      await swarmMonitor.stop();
      clearInterval(reaperInterval);
      clearInterval(zombieReaperInterval);
      clearInterval(metricsSaveInterval);
      clearInterval(ipPruneInterval);
      clearInterval(authFailPruneInterval);
      clearInterval(authSweepInterval);

      // 3. Close file watchers, pipelines, and reaper
      try { jsonlWatcher.destroy(); } catch (e) { console.error('Error destroying jsonlWatcher:', e); }
      try { await pipelines.destroy(); } catch (e) { console.error('Error destroying pipelines:', e); }
      if (memoryBridge) { try { memoryBridge.stopReaper(); } catch (e) { console.error('Error stopping memoryBridge reaper:', e); } }

      // Issue #569: Kill all CC sessions and tmux windows before exit
      try { await killAllSessions(sessions, tmux, { monitor, metrics, toolRegistry }); } catch (e) { console.error('Error killing sessions:', e); }

      // 4. Destroy channels (awaits Telegram poll loop)
      try { await channels.destroy(); } catch (e) { console.error('Error destroying channels:', e); }

      // 5. Save session state
      try { await sessions.save(); } catch (e) { console.error('Error saving sessions:', e); }

      // 6. Save metrics
      try { await metrics.save(); } catch (e) { console.error('Error saving metrics:', e); }

      // 7. Cleanup PID file
      removePidFile(pidFilePath);

      console.log('Graceful shutdown complete');
      process.exit(0);
    } finally {
      clearTimeout(forceExitTimer);
    }
  }

  process.on('SIGTERM', () => { if (!shuttingDown) { shuttingDown = true; void gracefulShutdown('SIGTERM'); } });
  process.on('SIGINT', () => { if (!shuttingDown) { shuttingDown = true; void gracefulShutdown('SIGINT'); } });
  if (process.platform === 'win32') {
    process.on('message', (message: unknown) => {
      if (!shuttingDown && isWindowsShutdownMessage(message)) {
        shuttingDown = true;
        void gracefulShutdown('WINMSG');
      }
    });
  }
  process.on('unhandledRejection', (reason) => {
    console.error('unhandledRejection:', reason);
  });

  // Start monitor
  monitor.start();

  // Issue #81: Start swarm monitor for agent swarm awareness
  swarmMonitor = new SwarmMonitor(sessions);
  toolRegistry = new ToolRegistry();
  routeDeps.swarmMonitor = swarmMonitor;

  swarmMonitor.onEvent((event) => {
    if (!event.swarm.parentSession) return;
    const parentId = event.swarm.parentSession.id;
    const teammate = event.teammate;

    if (event.type === 'teammate_spawned') {
      const detail = `🔧 Teammate ${teammate.windowName} spawned`;
      eventBus.emit(parentId, {
        event: 'subagent_start',
        sessionId: parentId,
        timestamp: new Date().toISOString(),
        data: { teammate: teammate.windowName, windowId: teammate.windowId },
      });
      void channels.swarmEvent(makePayload('swarm.teammate_spawned', parentId, detail, {
        teammateName: teammate.windowName,
        teammateWindowId: teammate.windowId,
        teammateCwd: teammate.cwd,
      }));
    } else if (event.type === 'teammate_finished') {
      const detail = `✅ Teammate ${teammate.windowName} finished`;
      eventBus.emit(parentId, {
        event: 'subagent_stop',
        sessionId: parentId,
        timestamp: new Date().toISOString(),
        data: { teammate: teammate.windowName },
      });
      void channels.swarmEvent(makePayload('swarm.teammate_finished', parentId, detail, {
        teammateName: teammate.windowName,
      }));
    }
  });
  swarmMonitor.start();

  // Issue #71: Wire swarm monitor into Telegram channel for /swarm command
  for (const ch of channels.getChannels()) {
    if ('setSwarmMonitor' in ch && typeof (ch as { setSwarmMonitor: unknown }).setSwarmMonitor === 'function') {
      (ch as TelegramChannel).setSwarmMonitor(swarmMonitor);
    }
  }

  // Start reaper (intervals already created above with stored refs for graceful shutdown)
  console.log(
    `Session reaper active: max age ${config.maxSessionAgeMs / 3600000}h, check every ${config.reaperIntervalMs / 60000}min`,
  );

  // Start zombie reaper (Issue #283)
  console.log(
    `Zombie reaper active: grace period ${ZOMBIE_REAP_DELAY_MS / 1000}s, check every ${ZOMBIE_REAP_INTERVAL_MS / 1000}s`,
  );


  // #127: Serve dashboard static files (Issue #105) — graceful if missing
  // Issue #539: Dashboard is copied into dist/dashboard/ during build
  const dashboardRoot = path.join(__dirname, "dashboard");
  let dashboardAvailable = false;
  try {
    await fs.access(dashboardRoot);
    dashboardAvailable = true;
  } catch {
    console.warn("Dashboard directory not found — skipping dashboard serving. Run 'npm run build:dashboard' to enable.");
  }

  if (dashboardAvailable) {
    await app.register(fastifyStatic, {
      root: dashboardRoot,
      prefix: "/dashboard/",
      // #146: Cache hashed assets aggressively, no-cache for index.html
      setHeaders: (reply, pathname) => {
        // Security headers (#145)
        reply.setHeader('X-Frame-Options', 'DENY');
        reply.setHeader('X-Content-Type-Options', 'nosniff');
        reply.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        // Issue #349: Content-Security-Policy for dashboard
        reply.setHeader('Content-Security-Policy', DASHBOARD_CSP);
        // Cache control (#146)
        if (pathname === '/index.html' || pathname === '/') {
          reply.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else {
          reply.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        }
      },
    });
  }

  // SPA fallback for dashboard routes (Issue #105)
  app.setNotFoundHandler(async (req, reply) => {
    if (dashboardAvailable && (req.url === "/dashboard" || req.url?.startsWith("/dashboard/") || req.url?.startsWith("/dashboard?"))) {
      // Issue #349: CSP header for SPA dashboard responses
      reply.header('Content-Security-Policy', DASHBOARD_CSP);
      return reply.sendFile("index.html", dashboardRoot);
    }
    return reply.status(404).send({ error: "Not found" });
  });
  await listenWithRetry(app, config.port, config.host, config.stateDir);
  pidFilePath = writePidFile(config.stateDir);
  console.log(`Aegis running on http://${config.host}:${config.port}`);
  console.log(`Channels: ${channels.count} registered`);
  console.log(`State dir: ${config.stateDir}`);
  console.log(`Claude projects dir: ${config.claudeProjectsDir}`);
  if (config.authToken) console.log('Auth: Bearer token required');
}

main().catch(err => {
  console.error('Failed to start Aegis:', err);
  process.exit(1);
});
