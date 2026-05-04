/**
 * server.ts — HTTP API server for Aegis.
 *
 * Exposes RESTful endpoints for creating, managing, and interacting
 * with Claude Code sessions running in tmux.
 *
 * Notification channels (Telegram, webhooks, etc.) are pluggable —
 * the server doesn't know which channels are active.
 */

import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import fs from 'node:fs/promises';
import { statSync, watch, type FSWatcher } from 'node:fs';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import crypto from 'node:crypto';
import { timingSafeStringEqual } from './crypto-utils.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TmuxManager } from './tmux.js';
import { SessionManager } from './session.js';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG } from './monitor.js';
import { JsonlWatcher } from './jsonl-watcher.js';
import {
  ChannelManager,
  TelegramChannel,
  SlackChannel,
  EmailChannel,
  WebhookChannel,
  type InboundCommand,
} from './channels/index.js';
import { loadConfig, reloadAllowedWorkDirs, findConfigFilePath, type Config } from './config.js';
import type { StateStore } from './services/state/state-store.js';

import { validateWorkDir, parseIntSafe, isValidUUID } from './validation.js';
import { SessionEventBus } from './events.js';

import { SSEConnectionLimiter } from './sse-limiter.js';
import { PipelineManager } from './pipeline.js';
import { ToolRegistry } from './tool-registry.js';
import {
  AuthManager,
  RateLimiter,
  classifyBearerTokenForRoute,
  type ApiKeyPermission,
  type ApiKeyRole,
} from './services/auth/index.js';
import { AuditLogger } from './audit.js';
import { MetricsCollector } from './metrics.js';

import { registerHookRoutes } from './hooks.js';
import { registerWsTerminalRoute } from './ws-terminal.js';
import { registerMemoryRoutes } from './memory-routes.js';

import { SwarmMonitor } from './swarm-monitor.js';
import { killAllSessions } from './signal-cleanup-helper.js';

import { logger, setStructuredLogSink } from './logger.js';
import { initTracing, shutdownTracing, loadTracingConfig } from './tracing.js';
import { MemoryBridge } from './memory-bridge.js';
import { cleanupTerminatedSessionState } from './session-cleanup.js';
import { QuotaManager } from './services/auth/QuotaManager.js';
import { MeteringService } from './metering.js';
import { MetricsCache, JsonFileBackend } from './services/metrics-cache.js';
import { normalizeApiErrorPayload } from './api-error-envelope.js';
import { listenWithRetry, removePidFile, writePidFile } from './startup.js';
import { AlertManager } from './alerting.js';
import { isWindowsShutdownMessage, parseShutdownTimeoutMs } from './shutdown-utils.js';
import { ServiceContainer } from './container.js';
import {
  registerHealthRoutes,
  registerAuthRoutes,
  registerAuditRoutes,
  registerSessionRoutes,
  registerSessionActionRoutes,
  registerSessionDataRoutes,
  registerEventRoutes,
  registerTemplateRoutes,
  registerPipelineRoutes,
  registerAnalyticsRoutes,
  registerOidcAuthRoutes,
  registerUsageRoutes,
  registerOpenApiSpec,
  registerOpenApiRoute,
  type RouteContext,
} from './routes/index.js';
import { makePayload as makePayloadFromCtx } from './routes/context.js';
import { registerDeviceAuthRoutes } from './routes/device-auth.js';
import {
  createDashboardOidcManagerFromEnv,
  DashboardSessionStore,
  type DashboardOIDCManager,
} from './services/auth/OIDCManager.js';
import { authenticateDashboardSessionCookie } from './dashboard-session-auth.js';




const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// #1108: Fastify request decoration — type-safe authKeyId
declare module 'fastify' {
  interface FastifyRequest {
    authKeyId?: string | null;
    matchedPermission?: ApiKeyPermission | null;
    authRole?: ApiKeyRole | null;
    authPermissions?: ApiKeyPermission[] | null;
    authActor?: string | null;
    /** Issue #1944: Tenant ID from the authenticated API key (undefined for admin/master). */
    tenantId?: string;
  }
}

// ── Configuration ────────────────────────────────────────────────────

// Issue #349 / #1924: CSP policy for dashboard responses (shared between static and SPA fallback).
// Tightened in #1924: adds frame-ancestors, base-uri, form-action, object-src.
// 'unsafe-inline' remains on style-src because Tailwind / xterm inject inline styles;
// script-src deliberately excludes 'unsafe-inline' and 'unsafe-eval'.
const DASHBOARD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: https://registry.npmjs.org",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "worker-src blob 'self'",
].join('; ');

const DASHBOARD_RESPONSE_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': DASHBOARD_CSP,
} as const;

function applyDashboardResponseHeaders(reply: FastifyReply): void {
  for (const [header, value] of Object.entries(DASHBOARD_RESPONSE_HEADERS)) {
    reply.header(header, value);
  }
}

function normalizeDashboardStaticPath(dashboardRoot: string, pathname: string): string {
  const urlLike = pathname.replace(/\\/g, '/');
  if (urlLike === '/' || urlLike === '/index.html' || urlLike.startsWith('/dashboard/') || urlLike.startsWith('/assets/')) {
    return urlLike.replace(/^\/(?:dashboard\/)?/, '');
  }
  const normalized = path.normalize(pathname);
  const relative = path.isAbsolute(normalized)
    ? path.relative(dashboardRoot, normalized)
    : normalized.replace(/^[\\/]+/, '');
  return relative.split(path.sep).join('/');
}

function dashboardCacheControl(dashboardRoot: string, pathname: string): string {
  const relative = normalizeDashboardStaticPath(dashboardRoot, pathname);
  const basename = path.posix.basename(relative);
  if (relative === '' || relative === 'index.html' || basename.endsWith('.html')) {
    return 'no-cache, no-store, must-revalidate';
  }
  if (relative.startsWith('assets/') && /-[A-Za-z0-9_-]{6,}\.[A-Za-z0-9]+$/.test(basename)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=0, must-revalidate';
}

// Config loaded at startup; env vars override file values
let config: Config;

// These will be initialized after config is loaded
let tmux: TmuxManager;
let sessions: SessionManager;
let sessionStore: StateStore;
let monitor: SessionMonitor;
let jsonlWatcher: JsonlWatcher;
const channels = new ChannelManager();
const eventBus = new SessionEventBus();
let memoryBridge: MemoryBridge | null = null;
let sseLimiter: SSEConnectionLimiter;let pipelines: PipelineManager;
let toolRegistry: ToolRegistry;
let auth: AuthManager;
let metrics: MetricsCollector;
let auditLogger: AuditLogger | undefined;
let swarmMonitor: SwarmMonitor;
let alertManager: AlertManager;
let dashboardOidc: DashboardOIDCManager | null = null;
let dashboardTokenSessions = new DashboardSessionStore();
let configWatcher: FSWatcher | null = null;

// ── Inbound command handler ─────────────────────────────────────────

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
        await channels.sessionEnded(makePayloadFromCtx(sessions, 'session.ended', cmd.sessionId, 'killed'));
        cleanupTerminatedSessionState(cmd.sessionId, { monitor, metrics, toolRegistry });
        break;
      case 'message':
      case 'command':
        if (cmd.text) await sessions.sendMessage(cmd.sessionId, cmd.text);
        break;
    }
  } catch (e) {
    logger.error({
      component: 'server',
      operation: 'handle_inbound',
      errorCode: 'INBOUND_COMMAND_ERROR',
      attributes: {
        action: cmd.action,
        error: e instanceof Error ? e.message : String(e),
      },
    });
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

const GLOBAL_RATE_LIMIT_CONFIG = {
  global: true,
  keyGenerator: (req: FastifyRequest) => req.ip ?? 'unknown',
  max: 600,
  timeWindow: '1 minute',
} as const;

app.register(fastifyRateLimit, GLOBAL_RATE_LIMIT_CONFIG);

// #1108: Decorate request with authKeyId — type-safe alternative to unsafe cast
app.decorateRequest('authKeyId', null as unknown as string);
app.decorateRequest('matchedPermission', null as unknown as ApiKeyPermission);
app.decorateRequest('authRole', null as unknown as ApiKeyRole);
app.decorateRequest('authPermissions', null as unknown as ApiKeyPermission[]);
app.decorateRequest('authActor', null as unknown as string);
// Issue #1944: Tenant ID from authenticated API key
app.decorateRequest('tenantId', undefined as unknown as string);

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
const rateLimiter = new RateLimiter();

function checkIpRateLimit(ip: string, isMaster: boolean, keyId?: string): boolean {
  return rateLimiter.checkIpRateLimit(ip, isMaster, keyId);
}

function checkIpRateLimitUnauth(ip: string): boolean {
  return rateLimiter.checkIpRateLimitUnauth(ip);
}

function checkAuthFailRateLimit(ip: string): boolean {
  return rateLimiter.checkAuthFailRateLimit(ip);
}

function recordAuthFailure(ip: string): void {
  rateLimiter.recordAuthFailure(ip);
}

const recordedAuthFailures = new Set<string>();

function recordAuthFailureOnce(req: FastifyRequest, ip: string): void {
  if (recordedAuthFailures.has(req.id)) return;
  recordedAuthFailures.add(req.id);
  recordAuthFailure(ip);
}

function pruneAuthFailLimits(): void {
  rateLimiter.pruneAuthFailLimits();
}

function pruneIpRateLimits(): void {
  rateLimiter.pruneIpRateLimits();
}

/** #583: Track keyId per request for batch rate limiting. */
const requestKeyMap = new Map<string, string>();


// #839: Clean up requestKeyMap entries after response to prevent unbounded memory leak.
app.addHook('onResponse', (req, _reply, done) => {
  requestKeyMap.delete(req.id);
  recordedAuthFailures.delete(req.id);
  done();
});

function setupAuth(authManager: AuthManager): void {
  app.addHook('onRequest', async (req, reply) => {
    // Skip auth for health endpoint and dashboard (Issue #349: exact path matching)
    // #126: Dashboard is served as public static files; API endpoints are protected
    const urlPath = req.url?.split('?')[0] ?? '';
    if (urlPath === '/health' || urlPath === '/v1/health') return;
    // Auth verification is a public bootstrap endpoint for dashboard login.
    if (urlPath === '/v1/auth/verify') return;
    // Issue #1943: Device auth endpoints are public (they proxy to the IdP).
    if (urlPath === '/v1/auth/device/authorize' || urlPath === '/v1/auth/device/token') return;
    // Issue #1942: Dashboard OIDC endpoints authenticate with HttpOnly cookies.
    if (urlPath === '/auth/login' || urlPath === '/auth/callback' || urlPath === '/auth/session' || urlPath === '/auth/logout') return;
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
          const queryHookSecret = (req.query as Record<string, string>)?.secret;
          if (config.hookSecretHeaderOnly && queryHookSecret !== undefined) {
            return reply.status(401).send({ error: 'Unauthorized — hook secret must be sent via X-Hook-Secret header' });
          }
          const hookSecret = (req.headers['x-hook-secret'] as string) || queryHookSecret;
          if (!hookSecret || !timingSafeStringEqual(hookSecret, session.hookSecret)) {
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
        if (bearer && (timingSafeStringEqual(bearer, metricsToken) || authManager.validate(bearer).valid)) {
          return; // authenticated
        }
        return reply.status(401).send({ error: 'Unauthorized — valid Bearer token or metrics token required' });
      }
      // No dedicated metrics token — fall through to normal auth flow below
    }

    // #124/#125: Accept token from Authorization header; ?token= query param
    // only on SSE routes where EventSource cannot set headers.
    // #297: SSE routes also accept short-lived SSE tokens via ?token=.
    // SSE routes: /v1/events, /v1/sessions/:id/events, /v1/sessions/:id/stream (#2461)
    const isSSERoute = /^\/v1\/events$|^\/v1\/sessions\/[^/]+\/(events|stream)$/.test(urlPath);
    let token: string | undefined;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      token = header.slice(7);
    } else if (isSSERoute) {
      token = (req.query as Record<string, string>).token;
    }

    // #633: Only use req.ip — trustProxy controls whether X-Forwarded-For is considered
    const clientIp = req.ip ?? 'unknown';

    // Issue #1942: Same-origin dashboard calls use an HttpOnly opaque session
    // cookie. This only fills request-scoped auth context; it never mints or
    // accepts a reusable bearer API key.
    if (!token && urlPath.startsWith('/v1/')) {
      const dashboardAuthContext = authenticateDashboardSessionCookie(req, {
        getSession: (sessionId: string | undefined) =>
          dashboardTokenSessions.get(sessionId) ?? dashboardOidc?.getSession(sessionId) ?? null,
      });
      if (dashboardAuthContext) {
        requestKeyMap.set(req.id, dashboardAuthContext.keyId);
        if (auditLogger) {
          void auditLogger.log(
            dashboardAuthContext.actor,
            'api.authenticated',
            `${req.method} ${req.url?.split('?')[0] ?? req.url}`,
            undefined,
            dashboardAuthContext.tenantId,
          );
        }
        // #2456: Pass keyId so dashboard auth uses its own bucket
        if (checkIpRateLimit(clientIp, false, dashboardAuthContext.keyId)) {
          return reply.status(429).send({ error: 'Rate limit exceeded — IP throttled' });
        }
        return;
      }
    }

    // #1080: Only bypass auth if no credentials are configured AND server is bound to localhost.
    // When binding to a non-localhost interface (0.0.0.0, public IP) with no auth configured,
    // do NOT bypass — let validate() reject the request (it returns valid:false in this case).
    // #2532: Even in localhost no-auth mode, apply per-IP rate limiting to prevent flooding.
    const isNoAuthLocalhost = !authManager.authEnabled && authManager.isLocalhostBinding;
    if (isNoAuthLocalhost) {
      if (checkIpRateLimit(clientIp, false)) {
        return reply.status(429).send({ error: 'Rate limit exceeded — IP throttled' });
      }
      return;
    }

    if (!token) {
      // #2456: Rate-limit no-token requests via the IP-only (unauth) bucket so they
      // cannot exhaust the per-key authenticated IP bucket for valid callers.
      if (checkIpRateLimit(clientIp, false)) {
        return reply.status(429).send({ error: 'Rate limit exceeded — too many unauthenticated requests' });
      }
      return reply.status(401).send({ error: 'Unauthorized — Bearer token required' });
    }

    const tokenMode = classifyBearerTokenForRoute(token, !!isSSERoute);

    // #408: SSE endpoints require short-lived single-use SSE tokens.
    // Do not fall back to validating long-lived bearer/master tokens on /events.
    if (tokenMode === 'sse') {
      if (await authManager.validateSSEToken(token)) {
        return; // authenticated via short-lived SSE token
      }
      // #2456: Check auth-fail rate limit only after confirming the token is bad,
      // so a valid token from the same IP is never blocked by prior failures.
      // #632: Block IPs that exceeded auth failure rate limit (5 attempts/min)
      if (checkAuthFailRateLimit(clientIp)) {
        return reply.status(429).send({ error: 'Too many auth failures — try again later' });
      }
      recordAuthFailureOnce(req, clientIp);
      return reply.status(401).send({ error: 'Unauthorized — SSE token invalid or expired' });
    }

    if (tokenMode === 'reject') {
      // #2456: Same pattern — check auth-fail rate limit inside the failure branch.
      if (checkAuthFailRateLimit(clientIp)) {
        return reply.status(429).send({ error: 'Too many auth failures — try again later' });
      }
      recordAuthFailureOnce(req, clientIp);
      return reply.status(401).send({ error: 'Unauthorized — SSE token required for event streams' });
    }

    const result = authManager.validate(token);

    if (!result.valid) {
      // #2456: Check auth-fail rate limit only for invalid tokens so valid tokens
      // from the same IP are never blocked by unauth-triggered rate limits.
      // #632: Block IPs that exceeded auth failure rate limit (5 attempts/min)
      if (checkAuthFailRateLimit(clientIp)) {
        return reply.status(429).send({ error: 'Too many auth failures — try again later' });
      }
      recordAuthFailureOnce(req, clientIp);
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
    req.authRole = authManager.getRole(result.keyId);
    req.authPermissions = authManager.getPermissions(result.keyId);
    req.authActor = authManager.getAuditActor(result.keyId, result.keyId ?? 'anonymous');
    // Issue #2267: Propagate tenant ID from the validated key.
    // Admin/master keys get SYSTEM_TENANT — they see all resources.
    req.tenantId = result.tenantId;

    // #1419: Audit authenticated API calls (fire-and-forget, non-blocking)
    // #1640: Guard with simple truthiness check — auditLogger can be undefined
    if (auditLogger) {
      void auditLogger.log(result.keyId ?? 'anonymous', 'api.authenticated', `${req.method} ${req.url?.split('?')[0] ?? req.url}`, undefined, result.tenantId);
    }

    // #228: Per-IP rate limiting (applies to all authenticated requests)
    // #633: Only use req.ip — trustProxy controls whether X-Forwarded-For is considered
    // #2456: Pass keyId so authenticated requests get a dedicated bucket per API key
    const isMaster = result.keyId === 'master';
    if (checkIpRateLimit(clientIp, isMaster, result.keyId ?? undefined)) {
      return reply.status(429).send({ error: 'Rate limit exceeded — IP throttled' });
    }
  });
}

// ── v1 API Routes ───────────────────────────────────────────────────

// #412: Reject non-UUID session IDs at the routing layer
app.addHook('onRequest', async (req, reply) => {
  const id = (req.params as Record<string, string | undefined>).id;
  if (id !== undefined && !isValidUUID(id)) {
    return reply.status(400).send({ error: 'Invalid session ID — must be a UUID' });
  }
});

// Route handlers are registered in main() via route modules (src/routes/*).


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
      logger.info({
        component: 'server',
        operation: 'reap_stale_sessions',
        sessionId: session.id,
        attributes: {
          windowName: session.windowName,
          ageMinutes: ageMin,
        },
      });
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
        logger.error({
          component: 'server',
          operation: 'reap_stale_sessions',
          sessionId: session.id,
          errorCode: 'REAPER_KILL_FAILED',
          attributes: {
            error: e instanceof Error ? e.message : String(e),
          },
        });
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

    logger.info({
      component: 'server',
      operation: 'reap_zombie_sessions',
      sessionId: session.id,
      attributes: {
        windowName: session.windowName,
      },
    });
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
      logger.error({
        component: 'server',
        operation: 'reap_zombie_sessions',
        sessionId: session.id,
        errorCode: 'ZOMBIE_REAP_FAILED',
        attributes: {
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }
  }
}

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
      topicAutoDelete: cfg.tgTopicAutoDelete,
      hookTimeoutMs: cfg.hookTimeoutMs,
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

// Preserve public export used by tests and external imports.
export { readParentPid as readPpid } from './process-utils.js';

// ── Config hot-reload (Issue #1753) ───────────────────────────────────

/** Debounce timer for config file change events. */
let configReloadTimer: ReturnType<typeof setTimeout> | null = null;

/** Set up fs.watch on the active config file and a SIGHUP handler for manual reload.
 *  Only allowedWorkDirs is hot-reloaded — other config changes still require a restart. */
let watchedConfigPath: string | null = null;

function setupConfigWatcher(): void {
  const configPath = findConfigFilePath();
  if (!configPath) return; // No config file to watch
  watchedConfigPath = configPath;

  // SIGHUP handler for manual reload
  process.on('SIGHUP', () => {
    void handleConfigReload('SIGHUP');
  });

  // fs.watch for automatic detection
  try {
    configWatcher = watch(configPath, (eventType) => {
      if (eventType === 'change') {
        // Debounce: FS events can fire multiple times for one save
        if (configReloadTimer) clearTimeout(configReloadTimer);
        configReloadTimer = setTimeout(() => {
          void handleConfigReload('file-change');
        }, 300);
      }
    });
    configWatcher.on('error', () => {
      // Watcher failed (file deleted, permissions) — disable gracefully
      configWatcher?.close();
      configWatcher = null;
    });
    logger.info({
      component: 'server',
      operation: 'config_watcher_started',
      attributes: { configPath },
    });
  } catch {
    // watch() can throw if file is inaccessible — just skip
  }
}

/** Reload allowedWorkDirs from config file and update the live config object. */
async function handleConfigReload(source: string): Promise<void> {
  try {
    const newDirs = await reloadAllowedWorkDirs(watchedConfigPath ?? undefined);
    if (newDirs === null) return; // Config file gone/invalid
    const oldDirs = config.allowedWorkDirs;
    const changed = newDirs.length !== oldDirs.length
      || newDirs.some((d, i) => d !== oldDirs[i]);
    if (changed) {
      config.allowedWorkDirs = newDirs;
      logger.info({
        component: 'server',
        operation: 'config_hot_reload',
        attributes: {
          source,
          field: 'allowedWorkDirs',
          count: newDirs.length,
        },
      });
    }
  } catch (e) {
    logger.warn({
      component: 'server',
      operation: 'config_hot_reload_failed',
      attributes: { source, error: e instanceof Error ? e.message : String(e) },
    });
  }
}

async function main(): Promise<void> {
  // Load configuration
  config = await loadConfig();
  dashboardTokenSessions = new DashboardSessionStore();
  dashboardOidc = await createDashboardOidcManagerFromEnv(config);

  // Initialize OpenTelemetry tracing before any instrumented modules load.
  // Must be called before Fastify starts so auto-instrumentation can patch HTTP.
  await initTracing(loadTracingConfig());

  // Issue #1753: Watch config file for changes and hot-reload allowedWorkDirs
  setupConfigWatcher();

  // Initialize core components with config
  tmux = new TmuxManager(config.tmuxSession);

  // Issue #1937: Create pluggable session store based on config.
  const { createStateStore } = await import('./services/state/store-factory.js');
  sessionStore = await createStateStore(config);
  await sessionStore.start();

  sessions = new SessionManager(tmux, config, sessionStore);
  const container = new ServiceContainer();
  // #1644: Derive hook-secret encryption key from master auth token (non-empty only)
  if (config.authToken) {
    sessions.setEncryptionKey(config.authToken);
  }

  // Memory bridge (Issue #783)
  if (config.memoryBridge?.enabled) {
    const persistPath = config.memoryBridge.persistPath ?? path.join(config.stateDir, 'memory.json');
    memoryBridge = new MemoryBridge(persistPath, config.memoryBridge.reaperIntervalMs);
    await memoryBridge.load();
    memoryBridge.startReaper();
    registerMemoryRoutes(app, memoryBridge);
    logger.info({
      component: 'server',
      operation: 'memory_bridge_enabled',
      attributes: { persistPath },
    });
  }

  sseLimiter = new SSEConnectionLimiter({ maxConnections: config.sseMaxConnections, maxPerIp: config.sseMaxPerIp });
  monitor = new SessionMonitor(sessions, channels, { ...DEFAULT_MONITOR_CONFIG, pollIntervalMs: 5000 });

  // Register channels
  registerChannels(config);

  // Setup auth (Issue #39: multi-key + backward compat)
  auth = new AuthManager(path.join(config.stateDir, 'keys.json'), config.authToken, config.defaultTenantId);
  auth.setHost(config.host);  // #1080: needed for auth bypass security check

  // #1419: Initialize audit logger and wire into auth
  auditLogger = new AuditLogger(path.join(config.stateDir, 'audit'));
  await auditLogger.init();
  auth.setAuditLogger(auditLogger);

  // Issue #1418: Initialize production alerting
  alertManager = new AlertManager({ ...config.alerting, hookTimeoutMs: config.hookTimeoutMs });
  if (config.alerting.webhooks.length > 0) {
    logger.info({
      component: 'server',
      operation: 'alerting_enabled',
      attributes: {
        webhooks: config.alerting.webhooks.length,
        failureThreshold: config.alerting.failureThreshold,
      },
    });
  }

  // Wire monitor dependencies before lifecycle startup.
  monitor.setEventBus(eventBus);
  monitor.setTmuxManager(tmux);
  monitor.setAlertManager(alertManager);
  jsonlWatcher = new JsonlWatcher();
  monitor.setMetrics(metrics);
  monitor.setJsonlWatcher(jsonlWatcher);

  container.register('tmuxManager', tmux, {
    start: async () => {
      await tmux.ensureSession();
    },
    stop: async () => {},
    health: async () => {
      const tmuxHealth = await tmux.isServerHealthy();
      return { healthy: tmuxHealth.healthy, details: tmuxHealth.error ?? undefined };
    },
  });
  container.register('sessionManager', sessions, {
    start: async () => {
      await sessions.load();
    },
    stop: async () => {
      await sessions.save();
    },
    health: async () => ({ healthy: true, details: `sessions=${sessions.listSessions().length}` }),
  }, ['tmuxManager']);
  container.register('authManager', auth, {
    start: async () => {
      await auth.load();
    },
    stop: async () => {},
    health: async () => ({ healthy: true }),
  });
  container.register('channelManager', channels, {
    start: async () => {
      await channels.init(handleInbound);
    },
    stop: async () => {
      await channels.destroy();
    },
    health: async () => ({ healthy: true, details: `channels=${channels.count}` }),
  }, ['sessionManager']);
  container.register('sessionMonitor', monitor, {
    start: async () => {
      monitor.start();
    },
    stop: async () => {
      monitor.stop();
    },
    health: async () => ({
      healthy: monitor.isRunning,
      details: monitor.isRunning ? 'running' : 'not running',
    }),
  }, ['sessionManager', 'channelManager', 'tmuxManager']);

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
  await container.start(['tmuxManager', 'sessionManager', 'authManager', 'channelManager']);

  // Issue #488: Accumulate token usage from JSONL events into per-session metrics.
  // Issue #2536: Also count messages and tool calls from JSONL events.
  jsonlWatcher.onEntries((event) => {
    if (metrics) {
      const { tokenUsageDelta } = event;
      if (tokenUsageDelta.inputTokens > 0 || tokenUsageDelta.outputTokens > 0) {
        const model = sessions.getSession(event.sessionId)?.model;
        metrics.recordTokenUsage(event.sessionId, tokenUsageDelta, model);
      }
      // Issue #2536: Count messages and tool calls from parsed entries.
      for (const msg of event.messages) {
        metrics.messageReceived(event.sessionId);
        if (msg.contentType === 'tool_use') {
          metrics.toolCallReceived(event.sessionId);
        }
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
  registerHookRoutes(app, { sessions, eventBus, metrics, hookSecretHeaderOnly: config.hookSecretHeaderOnly });

  // Issue #2144: GET /v1/hooks/:id/deliveries — webhook delivery history
  app.get<{ Params: { id: string } }>('/v1/hooks/:id/deliveries', async (req, reply) => {
    const { id } = req.params;
    const webhookChannels = channels.getChannels().filter(ch => ch.name === 'webhook') as WebhookChannel[];
    if (webhookChannels.length === 0) {
      return reply.status(404).send({ error: 'No webhook channel configured' });
    }
    const wh = webhookChannels[0];
    // Look up endpoint URL by index-based ID
    const endpoints = wh.getEndpoints();
    const ep = endpoints.find(e => e.id === id);
    if (!ep) {
      return reply.status(404).send({ error: `Endpoint not found: ${id}` });
    }
    const deliveries = wh.getDeliveryLog(ep.url);
    return reply.send(deliveries);
  });

  // Initialize pipeline manager (Issue #36, #1424, #1938)
  pipelines = new PipelineManager(sessions, eventBus, sessionStore, config.pipelineStageTimeoutMs);
  await pipelines.hydrate();

  // Initialize batch rate limiter (Issue #583)

  // Initialize metrics (Issue #40)
  metrics = new MetricsCollector(path.join(config.stateDir, 'metrics.json'));
  await metrics.load();

  // Issue #2250: Initialize analytics cache with JSON file persistence
  const metricsCache = new MetricsCache(
    sessions,
    metrics,
    auth,
    new JsonFileBackend(path.join(config.stateDir, 'analytics-cache.json')),
    eventBus,
  );
  await metricsCache.start();

  // ── Register extracted route modules (ARC-2) ──────────────────────
  /** Validate workDir — delegates to validation.ts (Issue #435). */
  const validateWorkDirWithConfig = (workDir: string) => validateWorkDir(workDir, config.allowedWorkDirs);

  // Initialize early — route modules reference these
  swarmMonitor = new SwarmMonitor(sessions);
  toolRegistry = new ToolRegistry();

  const serverState = { draining: false };

  const routeCtx: RouteContext = {
    sessions, tmux, auth, config, metrics, monitor, eventBus, channels,
    jsonlWatcher, pipelines, toolRegistry, getAuditLogger: () => auditLogger,
    alertManager, swarmMonitor, sseLimiter, memoryBridge, requestKeyMap,
    validateWorkDir: validateWorkDirWithConfig,
    serverState,
    quotas: new QuotaManager(),
    metering: new MeteringService(eventBus, (sid) => sessions.getSession(sid)?.ownerKeyId, path.join(config.stateDir, 'metering.jsonl')),
    metricsCache,
    dashboardOidc,
    dashboardTokenSessions,
  };
  registerHealthRoutes(app, routeCtx);
  registerAuthRoutes(app, routeCtx);
  registerOidcAuthRoutes(app, routeCtx);
  // Issue #1943: OAuth2 device authorization grant endpoints (RFC 8628)
  registerDeviceAuthRoutes(app);
  registerAuditRoutes(app, routeCtx);
  registerSessionRoutes(app, routeCtx);
  registerSessionActionRoutes(app, routeCtx);
  registerSessionDataRoutes(app, routeCtx);
  registerEventRoutes(app, routeCtx);
  registerTemplateRoutes(app, routeCtx);
  registerPipelineRoutes(app, routeCtx);
  registerAnalyticsRoutes(app, routeCtx);
  registerUsageRoutes(app, routeCtx);

  // OpenAPI spec registration and route (issue #1909)
  registerOpenApiSpec();
  registerOpenApiRoute(app);

  // Issue #361: Store interval refs so graceful shutdown can clear them
  const reaperInterval = setInterval(() => reapStaleSessions(config.maxSessionAgeMs), config.reaperIntervalMs);
  const zombieReaperInterval = setInterval(() => reapZombieSessions(), ZOMBIE_REAP_INTERVAL_MS);
  const metricsSaveInterval = setInterval(() => { void metrics.save(); }, 5 * 60 * 1000);
  // #357: Prune stale IP rate-limit entries every minute
  const ipPruneInterval = setInterval(pruneIpRateLimits, 60_000);
  // #632: Prune stale auth failure rate-limit buckets every minute
  const authFailPruneInterval = setInterval(pruneAuthFailLimits, 60_000);
  // #398: Sweep stale API key rate limit buckets every 5 minutes
  const authSweepInterval = setInterval(() => auth.sweepStaleRateLimits(), 5 * 60_000);
  // #2452: Sweep expired quota usage entries every 5 minutes to prevent unbounded growth
  const quotaSweepInterval = setInterval(() => routeCtx.quotas.sweep(), 5 * 60_000);
  let pidFilePath = '';

  // Issue #361: Graceful shutdown handler
  // Issue #415: Reentrance guard at handler level prevents double execution on rapid SIGINT
  let shuttingDown = false;
  // Issue #1911: use config values for shutdown timeouts; fall back to legacy env var for compat.
  const shutdownTimeoutMs = config.shutdownHardMs > 0
    ? config.shutdownHardMs
    : parseShutdownTimeoutMs(process.env.AEGIS_SHUTDOWN_TIMEOUT_MS);
  async function gracefulShutdown(signal: string): Promise<void> {
    logger.info({
      component: 'server',
      operation: 'graceful_shutdown_start',
      attributes: { signal },
    });

    const forceExitTimer = setTimeout(() => {
      logger.error({
        component: 'server',
        operation: 'graceful_shutdown_timeout',
        errorCode: 'SHUTDOWN_TIMEOUT',
        attributes: { signal, timeoutMs: shutdownTimeoutMs },
      });
      process.exit(1);
    }, shutdownTimeoutMs);
    forceExitTimer.unref?.();

    try {

      // 1. Flip health to draining and broadcast shutdown SSE frame
      serverState.draining = true;
      eventBus.emitShutdown();

      // 2. Stop accepting new requests (waits up to shutdownGraceMs for in-flight requests)
      try {
        await Promise.race([
          app.close(),
          new Promise<void>(resolve => setTimeout(resolve, config.shutdownGraceMs)),
        ]);
      } catch (e) {
        logger.error({
          component: 'server',
          operation: 'graceful_shutdown_close_server',
          errorCode: 'SHUTDOWN_CLOSE_SERVER_FAILED',
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }

      // 2. Stop background monitors and intervals
      monitor.stop();
      await swarmMonitor.stop();
      // Issue #1937: Stop session store
      try {
        await sessionStore.stop(AbortSignal.timeout(5000));
      } catch (e) {
        logger.error({
          component: 'server',
          operation: 'graceful_shutdown_stop_store',
          errorCode: 'SHUTDOWN_STOP_STORE_FAILED',
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }
      // #1753: Close config file watcher
      configWatcher?.close();
      configWatcher = null;
      if (configReloadTimer) { clearTimeout(configReloadTimer); configReloadTimer = null; }
      clearInterval(reaperInterval);
      clearInterval(zombieReaperInterval);
      clearInterval(metricsSaveInterval);
      clearInterval(ipPruneInterval);
      clearInterval(authFailPruneInterval);
      clearInterval(authSweepInterval);
      clearInterval(quotaSweepInterval);
      rateLimiter.dispose();

      // 3. Close file watchers, pipelines, and reaper
      try {
        jsonlWatcher.destroy();
      } catch (e) {
        logger.error({
          component: 'server',
          operation: 'graceful_shutdown_destroy_jsonl_watcher',
          errorCode: 'SHUTDOWN_DESTROY_JSONL_WATCHER_FAILED',
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }
      try {
        await pipelines.destroy();
      } catch (e) {
        logger.error({
          component: 'server',
          operation: 'graceful_shutdown_destroy_pipelines',
          errorCode: 'SHUTDOWN_DESTROY_PIPELINES_FAILED',
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }
      if (memoryBridge) {
        try {
          memoryBridge.stopReaper();
        } catch (e) {
          logger.error({
            component: 'server',
            operation: 'graceful_shutdown_stop_memory_bridge_reaper',
            errorCode: 'SHUTDOWN_STOP_MEMORY_BRIDGE_REAPER_FAILED',
            attributes: { error: e instanceof Error ? e.message : String(e) },
          });
        }
      }

      // Issue #569: Kill all CC sessions and tmux windows before exit
      try {
        await killAllSessions(sessions, tmux, { monitor, metrics, toolRegistry });
      } catch (e) {
        logger.error({
          component: 'server',
          operation: 'graceful_shutdown_kill_all_sessions',
          errorCode: 'SHUTDOWN_KILL_SESSIONS_FAILED',
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }

      // 4. Stop managed services in reverse dependency order with timeout safety
      const serviceStopTimeoutMs = Math.max(1_000, Math.floor(shutdownTimeoutMs / 5));
      const serviceStops = await container.stopAll({ timeoutMs: serviceStopTimeoutMs });
      for (const stopResult of serviceStops) {
        if (stopResult.status === 'timeout') {
          logger.error({
            component: 'server',
            operation: 'graceful_shutdown_stop_service',
            errorCode: 'SERVICE_SHUTDOWN_TIMEOUT',
            attributes: { service: stopResult.name },
          });
        } else if (stopResult.status === 'error') {
          logger.error({
            component: 'server',
            operation: 'graceful_shutdown_stop_service',
            errorCode: 'SERVICE_SHUTDOWN_FAILED',
            attributes: {
              service: stopResult.name,
              error: stopResult.error instanceof Error ? stopResult.error.message : String(stopResult.error),
            },
          });
        }
      }

      // 6. Save metrics
      try {
        await metrics.save();
      } catch (e) {
        logger.error({
          component: 'server',
          operation: 'graceful_shutdown_save_metrics',
          errorCode: 'SHUTDOWN_SAVE_METRICS_FAILED',
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }

      // 6b. Issue #2250: Flush analytics cache
      try {
        await metricsCache.stop();
      } catch (e) {
        logger.error({
          component: 'server',
          operation: 'graceful_shutdown_flush_metrics_cache',
          errorCode: 'SHUTDOWN_FLUSH_METRICS_CACHE_FAILED',
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }

      // 7. Cleanup PID file
      removePidFile(pidFilePath);

      // 8. Issue #1911: Flush pending audit log writes with a hard cap of shutdownHardMs
      try {
        const auditFlushMs = Math.max(0, shutdownTimeoutMs - 1_000);
        await Promise.race([
          auditLogger?.flush() ?? Promise.resolve(),
          new Promise<void>(resolve => setTimeout(resolve, auditFlushMs)),
        ]);
      } catch (e) {
        logger.error({
          component: 'server',
          operation: 'graceful_shutdown_flush_audit',
          errorCode: 'SHUTDOWN_FLUSH_AUDIT_FAILED',
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }

      // 9. Flush pending OpenTelemetry spans before exit
      try {
        await shutdownTracing();
      } catch (e) {
        logger.error({
          component: 'server',
          operation: 'graceful_shutdown_tracing',
          errorCode: 'SHUTDOWN_TRACING_FAILED',
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }

      logger.info({
        component: 'server',
        operation: 'graceful_shutdown_complete',
        attributes: { signal },
      });
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
    logger.error({
      component: 'server',
      operation: 'unhandled_rejection',
      errorCode: 'UNHANDLED_REJECTION',
      attributes: {
        reason: reason instanceof Error ? reason.message : String(reason),
      },
    });
  });

  // Start monitor via dependency-aware service lifecycle.
  await container.start(['sessionMonitor']);

  // Issue #81: Start swarm monitor for agent swarm awareness
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
      void channels.swarmEvent(makePayloadFromCtx(sessions, 'swarm.teammate_spawned', parentId, detail, {
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
      void channels.swarmEvent(makePayloadFromCtx(sessions, 'swarm.teammate_finished', parentId, detail, {
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
  logger.info({
    component: 'server',
    operation: 'session_reaper_active',
    attributes: {
      maxAgeHours: config.maxSessionAgeMs / 3600000,
      intervalMinutes: config.reaperIntervalMs / 60000,
    },
  });

  // Start zombie reaper (Issue #283)
  logger.info({
    component: 'server',
    operation: 'zombie_reaper_active',
    attributes: {
      gracePeriodSeconds: ZOMBIE_REAP_DELAY_MS / 1000,
      intervalSeconds: ZOMBIE_REAP_INTERVAL_MS / 1000,
    },
  });


  // #127: Serve dashboard static files (Issue #105) — graceful if missing
  // Issue #539: Dashboard is copied into dist/dashboard/ during build
  // Issue #1699: Validates index.html presence for clearer diagnostics
  const dashboardRoot = path.join(__dirname, "dashboard");
  const dashboardEnabled = config.dashboardEnabled !== false;
  let dashboardAvailable = false;
  if (dashboardEnabled) {
    try {
      await fs.access(path.join(dashboardRoot, 'index.html'));
      dashboardAvailable = true;
    } catch {
      logger.warn({
        component: 'server',
        operation: 'dashboard_static_unavailable',
        errorCode: 'DASHBOARD_DIR_MISSING',
        attributes: {
          dashboardRoot,
          hint: 'Run "npm run build" to populate dist/dashboard/',
        },
      });
    }
  }

  if (dashboardAvailable) {
    await app.register(fastifyStatic, {
      root: dashboardRoot,
      prefix: "/dashboard/",
      // #2345: Prevent send() from overwriting our Cache-Control with its own default.
      cacheControl: false,
      // #146: Cache hashed assets aggressively, no-cache for index.html
      setHeaders: (reply, pathname) => {
        for (const [header, value] of Object.entries(DASHBOARD_RESPONSE_HEADERS)) {
          reply.setHeader(header, value);
        }
        reply.setHeader('Cache-Control', dashboardCacheControl(dashboardRoot, pathname));

        // Defensive: ensure Content-Length is present and correct for static assets
        // Only set header when not already provided by the static plugin (avoid interfering with compression plugins).
        try {
          if (!reply.getHeader('Content-Length')) {
            const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
            const full = path.join(dashboardRoot, rel);
            const st = statSync(full);
            reply.setHeader('Content-Length', String(st.size));
          }
        } catch {
          // ignore: let the static plugin handle headers if stat fails
        }
      },
    });
  }

  // SPA fallback for dashboard routes (Issue #105)
  app.setNotFoundHandler(async (req, reply) => {
    if (dashboardAvailable && (req.url === "/dashboard" || req.url?.startsWith("/dashboard/") || req.url?.startsWith("/dashboard?"))) {
      applyDashboardResponseHeaders(reply);
      return reply.sendFile("index.html", dashboardRoot);
    }
    return reply.status(404).send({ error: "Not found" });
  });
  await container.assertHealthy();
  await listenWithRetry(app, config.port, config.host, config.stateDir);
  pidFilePath = await writePidFile(config.stateDir);
  logger.info({
    component: 'server',
    operation: 'startup_listening',
    attributes: {
      host: config.host,
      port: config.port,
      channels: channels.count,
      stateDir: config.stateDir,
      claudeProjectsDir: config.claudeProjectsDir,
    },
  });
  if (auth.authEnabled) {
    logger.info({
      component: 'server',
      operation: 'auth_enabled',
      attributes: {},
    });
  } else {
    logger.warn({
      component: 'server',
      operation: 'auth_not_configured',
      errorCode: 'AUTH_DISABLED',
      attributes: {},
    });
  }
}

main().catch(err => {
  logger.error({
    component: 'server',
    operation: 'startup_failed',
    errorCode: 'STARTUP_FAILED',
    attributes: { error: err instanceof Error ? err.message : String(err) },
  });
  process.exit(1);
});
