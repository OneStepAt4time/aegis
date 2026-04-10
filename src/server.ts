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
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { z } from 'zod';
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
import { captureScreenshot, isPlaywrightAvailable } from './screenshot.js';
import { validateScreenshotUrl, resolveAndCheckIp, buildHostResolverRule } from './ssrf.js';
import { validateWorkDir, permissionRuleSchema, type PermissionPolicy } from './validation.js';
import { SessionEventBus, type SessionSSEEvent, type GlobalSSEEvent } from './events.js';
import { runVerification } from './verification.js';
import { SSEWriter } from './sse-writer.js';
import { SSEConnectionLimiter } from './sse-limiter.js';
import { PipelineManager } from './pipeline.js';
import { ToolRegistry } from './tool-registry.js';
import { AuthManager, RateLimiter, classifyBearerTokenForRoute, type ApiKeyRole } from './services/auth/index.js';
import { AuditLogger, type AuditAction } from './audit.js';
import { MetricsCollector } from './metrics.js';
import { promRegistry, METRICS_CONTENT_TYPE } from './prometheus.js';
import { registerPermissionRoutes } from './permission-routes.js';
import { registerHookRoutes } from './hooks.js';
import { registerWsTerminalRoute } from './ws-terminal.js';
import { registerMemoryRoutes } from './memory-routes.js';
import { readNewEntries } from './transcript.js';
import * as templateStore from './template-store.js';
import { SwarmMonitor } from './swarm-monitor.js';
import { killAllSessions } from './signal-cleanup-helper.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { negotiate, type HandshakeRequest } from './handshake.js';
import { diagnosticsBus } from './diagnostics.js';
import { setStructuredLogSink } from './logger.js';
import { MemoryBridge } from './memory-bridge.js';
import { cleanupTerminatedSessionState } from './session-cleanup.js';
import { normalizeApiErrorPayload } from './api-error-envelope.js';
import { listenWithRetry, removePidFile, writePidFile } from './startup.js';
import { AlertManager, type AlertType } from './alerting.js';
import { isWindowsShutdownMessage, parseShutdownTimeoutMs } from './shutdown-utils.js';
import { ServiceContainer } from './container.js';
import {
  authKeySchema, sendMessageSchema, commandSchema, bashSchema,
  screenshotSchema, permissionHookSchema, stopHookSchema,
  batchSessionSchema, pipelineSchema, handshakeRequestSchema, parseIntSafe, isValidUUID,
  compareSemver, extractCCVersion, MIN_CC_VERSION,
  permissionProfileSchema, type PermissionProfile,
} from './validation.js';



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

// ── Shared route handler types ────────────────────────────────────────
type IdParams = { Params: { id: string } };

// #1108: Fastify request decoration — type-safe authKeyId
declare module 'fastify' {
  interface FastifyRequest {
    authKeyId?: string | null;
  }
}

type IdRequest = FastifyRequest<IdParams>;

/**
 * Role-based access control guard (Issue #1432, #1570).
 *
 * Checks whether the authenticated API key has one of the allowed roles.
 * On failure, sends a 403 response and returns `false`.
 * On success, returns `true`.
 *
 * Usage: `if (!requireRole(req, reply, 'admin')) return;`
 *
 * @param req - Fastify request (reads `req.authKeyId`)
 * @param reply - Fastify reply (sends 403 on denial)
 * @param allowedRoles - One or more roles that are permitted
 */
function requireRole(req: FastifyRequest, reply: FastifyReply, ...allowedRoles: ApiKeyRole[]): boolean {
  const keyId = req.authKeyId ?? null;
  const role = auth.getRole(keyId);
  if (!allowedRoles.includes(role)) {
    reply.status(403).send({ error: 'Forbidden: insufficient role' });
    return false;
  }
  return true;
}

/**
 * Session ownership guard (Issue #1429, #1570).
 *
 * Rejects with 403 if the caller's keyId does not match the session owner.
 * Master key and no-auth mode (null/undefined keyId) bypass ownership.
 * Legacy sessions without ownerKeyId allow all access (backward compat).
 * On failure, sends an appropriate error response and returns `null`.
 * On success, returns the `SessionInfo`.
 *
 * Usage: `const session = requireOwnership(id, reply, req.authKeyId); if (!session) return;`
 *
 * @param sessionId - UUID of the target session
 * @param reply - Fastify reply (sends 404/403 on denial)
 * @param keyId - Authenticated key ID (from `req.authKeyId`)
 */
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
  // Master key and no-auth mode bypass ownership checks
  if (keyId === 'master' || keyId === null || keyId === undefined) return session;
  // Legacy sessions without ownerKeyId allow all access
  if (!session.ownerKeyId) return session;
  if (session.ownerKeyId !== keyId) {
    reply.status(403).send({ error: 'Forbidden: session owned by another API key' });
    return null;
  }
  return session;
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
let sseLimiter: SSEConnectionLimiter;let pipelines: PipelineManager;
let toolRegistry: ToolRegistry;
let auth: AuthManager;
let metrics: MetricsCollector;
let auditLogger: AuditLogger | undefined;
let swarmMonitor: SwarmMonitor;
let alertManager: AlertManager;

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

const RATE_LIMIT_WINDOW = '1 minute';
const RATE_LIMITS = {
  global: { max: 600, timeWindow: RATE_LIMIT_WINDOW },
  health: { max: 240, timeWindow: RATE_LIMIT_WINDOW },
  metrics: { max: 240, timeWindow: RATE_LIMIT_WINDOW },
  adminAction: { max: 60, timeWindow: RATE_LIMIT_WINDOW },
  authVerify: { max: 60, timeWindow: RATE_LIMIT_WINDOW },
  authKeyWrite: { max: 60, timeWindow: RATE_LIMIT_WINDOW },
  audit: { max: 120, timeWindow: RATE_LIMIT_WINDOW },
  sessionCreate: { max: 120, timeWindow: RATE_LIMIT_WINDOW },
  expensiveRead: { max: 120, timeWindow: RATE_LIMIT_WINDOW },
} as const;

app.register(fastifyRateLimit, {
  global: true,
  keyGenerator: (req) => req.ip ?? 'unknown',
  ...RATE_LIMITS.global,
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
const rateLimiter = new RateLimiter();

function checkIpRateLimit(ip: string, isMaster: boolean): boolean {
  return rateLimiter.checkIpRateLimit(ip, isMaster);
}

function checkAuthFailRateLimit(ip: string): boolean {
  return rateLimiter.checkAuthFailRateLimit(ip);
}

function recordAuthFailure(ip: string): void {
  rateLimiter.recordAuthFailure(ip);
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

// ── v1 API Routes ───────────────────────────────────────────────────

// #412: Reject non-UUID session IDs at the routing layer
app.addHook('onRequest', async (req, reply) => {
  const id = (req.params as Record<string, string | undefined>).id;
  if (id !== undefined && !isValidUUID(id)) {
    return reply.status(400).send({ error: 'Invalid session ID — must be a UUID' });
  }
});

// #1393: claudeCommand must not contain shell metacharacters — it is sent to a shell
// via tmux send-keys, so arbitrary metacharacters enable RCE for any authenticated caller.
const SAFE_COMMAND_RE = /^[a-zA-Z0-9_./@:= -]+$/;

// #226: Zod schema for session creation
const createSessionSchema = z.object({
  workDir: z.string().min(1),
  name: z.string().max(200).optional(),
  prompt: z.string().max(100_000).optional(),
  prd: z.string().max(100_000).optional(),
  resumeSessionId: z.string().uuid().optional(),
  claudeCommand: z.string().max(500).regex(SAFE_COMMAND_RE).optional(),
  env: z.record(z.string(), z.string()).optional(),
  stallThresholdMs: z.number().int().positive().max(3_600_000).optional(),
  permissionMode: z.enum(['default', 'bypassPermissions', 'plan', 'acceptEdits', 'dontAsk', 'auto']).optional(),
  autoApprove: z.boolean().optional(),
  parentId: z.string().uuid().optional(),
  memoryKeys: z.array(z.string()).max(50).optional(),
}).strict();

// Health — Issue #397: includes tmux server health check
async function healthHandler(): Promise<Record<string, unknown>> {
  const pkg = await import('../package.json', { with: { type: 'json' } });
  const activeCount = sessions.listSessions().length;
  const totalCount = metrics.getTotalSessionsCreated();
  const tmuxHealth = await tmux.isServerHealthy();
  const status = tmuxHealth.healthy ? 'ok' : 'degraded';
  return {
    status,
    version: pkg.default.version,
    platform: process.platform,
    uptime: process.uptime(),
    sessions: { active: activeCount, total: totalCount },
    tmux: tmuxHealth,
    timestamp: new Date().toISOString(),
  };
}
app.get('/v1/health', { config: { rateLimit: RATE_LIMITS.health } }, healthHandler);
app.get('/health', { config: { rateLimit: RATE_LIMITS.health } }, healthHandler);

// Issue #1412: Prometheus metrics scrape endpoint — text/plain; version=0.0.4
app.get('/metrics', { config: { rateLimit: RATE_LIMITS.metrics } }, async (req, reply) => {
  try {
    const metrics = await promRegistry.metrics();
    return reply
      .header('Content-Type', METRICS_CONTENT_TYPE)
      .send(metrics);
  } catch (err) {
    req.log.error({ err }, 'Prometheus /metrics endpoint error');
    return reply.status(500).send({ error: 'Failed to collect metrics' });
  }
});

// Issue #1418: Alert webhook validation and stats
app.post('/v1/alerts/test', { config: { rateLimit: RATE_LIMITS.adminAction } }, async (req, reply) => {
  if (!requireRole(req, reply, 'admin', 'operator')) return;
  try {
    const result = await alertManager.fireTestAlert();
    if (!result.sent) {
      return reply.status(200).send({ sent: false, message: 'No alert webhooks configured (set AEGIS_ALERT_WEBHOOKS)' });
    }
    return reply.status(200).send(result);
  } catch (e: unknown) {
    return reply.status(502).send({ error: `Alert delivery failed: ${e instanceof Error ? e.message : String(e)}` });
  }
});

app.get('/v1/alerts/stats', async () => alertManager.getStats());

app.post<{ Body: HandshakeRequest }>('/v1/handshake', async (req, reply) => {
  const parsed = handshakeRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({ error: 'Invalid handshake request', details: parsed.error.issues });
  }
  const result = negotiate(parsed.data);
  return reply.status(result.compatible ? 200 : 409).send(result);
});

// Issue #81: Swarm awareness

// Issue #81: Swarm awareness — list all detected CC swarms and their teammates
app.get('/v1/swarm', { config: { rateLimit: RATE_LIMITS.expensiveRead } }, async () => {
  const result = await swarmMonitor.scan();
  return result;
});

// API key management (Issue #39)
// Security: reject all auth key operations when auth is not enabled
const verifyTokenSchema = z.object({
  token: z.string().min(1),
}).strict();

app.post('/v1/auth/verify', { config: { rateLimit: RATE_LIMITS.authVerify } }, async (req, reply) => {
  const parsed = verifyTokenSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
  }

  if (!auth.authEnabled) {
    return { valid: true, role: 'admin' };
  }

  // Public bootstrap endpoint: apply failed-auth IP throttling like the main auth hook.
  const clientIp = req.ip ?? 'unknown';
  if (checkAuthFailRateLimit(clientIp)) {
    return reply.status(429).send({ valid: false });
  }

  const result = auth.validate(parsed.data.token);
  if (result.rateLimited) {
    return reply.status(429).send({ valid: false });
  }
  if (!result.valid) {
    recordAuthFailure(clientIp);
    return reply.status(401).send({ valid: false });
  }

  return { valid: true, role: auth.getRole(result.keyId) };
});

app.post('/v1/auth/keys', { config: { rateLimit: RATE_LIMITS.authKeyWrite } }, async (req, reply) => {
  if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
  // Issue #1432: Only admin keys can create new API keys
  if (!requireRole(req, reply, 'admin')) return;
  const parsed = authKeySchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
  const { name, rateLimit, ttlDays, role = 'viewer' } = parsed.data;
  const result = await auth.createKey(name, rateLimit, ttlDays, role);
  return reply.status(201).send(result);
});

app.get('/v1/auth/keys', async (req, reply) => {
  if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
  if (!requireRole(req, reply, 'admin')) return;
  return auth.listKeys();
});

app.delete<{ Params: { id: string } }>('/v1/auth/keys/:id', async (req, reply) => {
  if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
  // Issue #1432: Only admin keys can revoke API keys
  if (!requireRole(req, reply, 'admin')) return;
  const revoked = await auth.revokeKey(req.params.id);
  if (!revoked) return reply.status(404).send({ error: 'Key not found' });
  return { ok: true };
});

// Issue #1403: Rotate an API key — replaces the key hash while preserving metadata
const rotateKeySchema = z.object({
  ttlDays: z.number().int().positive().optional(),
}).strict();

app.post<{ Params: { id: string } }>('/v1/auth/keys/:id/rotate', async (req, reply) => {
  if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
  if (!requireRole(req, reply, 'admin')) return;
  const parsed = rotateKeySchema.safeParse(req.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
  const rotated = await auth.rotateKey(req.params.id, parsed.data.ttlDays);
  if (!rotated) return reply.status(404).send({ error: 'Key not found' });
  return reply.status(200).send(rotated);
});

// #297: SSE token endpoint — generates short-lived, single-use token
// to avoid exposing long-lived bearer tokens in SSE URL query params.
// Issue #634: Reuse keyId from auth middleware result to avoid double-increment.
// of rate limit counter.
app.post('/v1/auth/sse-token', async (req, reply) => {
  // This route goes through the onRequest auth hook, so the caller is
  // already authenticated. Reuse stored keyId to avoid calling auth.validate() again.
  const storedKeyId = req.authKeyId;
  const keyId = (typeof storedKeyId === 'string' ? storedKeyId : 'anonymous');

  try {
    const sseToken = await auth.generateSSEToken(keyId);
    return reply.status(201).send(sseToken);
  } catch (e: unknown) {
    return reply.status(429).send({ error: e instanceof Error ? e.message : 'SSE token limit reached' });
  }
});

// #1419: Audit log endpoint — admin only
const auditQuerySchema = z.object({
  actor: z.string().optional(),
  action: z.string().optional(),
  sessionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  reverse: z.coerce.boolean().optional(),
  verify: z.coerce.boolean().optional(),
});

app.get('/v1/audit', { config: { rateLimit: RATE_LIMITS.audit } }, async (req, reply) => {
  if (!requireRole(req, reply, 'admin')) return;

  const parsed = auditQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.issues });
  }

  const { verify: verifyChain, action, ...rest } = parsed.data;
  const queryOpts = { ...rest, action: action as AuditAction | undefined };

  if (verifyChain) {
    const result = await auditLogger!.verify();
    return { integrity: result, records: await auditLogger!.query(queryOpts) };
  }

  const records = await auditLogger!.query(queryOpts);
  return { count: records.length, records };
});

const diagnosticsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// Global metrics (Issue #40)
app.get('/v1/metrics', async () => metrics.getGlobalMetrics(sessions.listSessions().length));

// Bounded no-PII diagnostics channel (Issue #881)
app.get('/v1/diagnostics', async (req, reply) => {
  const parsed = diagnosticsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: 'Invalid diagnostics query params',
      details: parsed.error.issues,
    });
  }

  const limit = parsed.data.limit ?? 50;
  const events = diagnosticsBus.getRecent(limit);
  return { count: events.length, events };
});

// Per-session metrics (Issue #40)
app.get<{ Params: { id: string } }>('/v1/sessions/:id/metrics', async (req, reply) => {
  const session = requireOwnership(req.params.id, reply, req.authKeyId);
  if (!session) return;
  const m = metrics.getSessionMetrics(req.params.id);
  if (!m) return reply.status(404).send({ error: 'No metrics for this session' });
  return m;
});


// Issue #704: Tool usage endpoints
app.get<IdParams>('/v1/sessions/:id/tools', async (req, reply) => {
  const sessionId = (req.params as { id: string }).id;
  const session = requireOwnership(sessionId, reply, req.authKeyId);
  if (!session) return;
  // Parse JSONL on-demand for tool usage
  if (session.jsonlPath) {
    try {
      const result = await readNewEntries(session.jsonlPath, 0);
      const entries = result.entries;
      toolRegistry.processEntries(req.params.id, entries);
    } catch { /* JSONL not available */ }
  }
  const tools = toolRegistry.getSessionTools(req.params.id);
  return { sessionId: req.params.id, tools, totalCalls: tools.reduce((sum, t) => sum + t.count, 0) };
});

app.get('/v1/tools', async () => {
  const definitions = toolRegistry.getToolDefinitions();
  const categories = [...new Set(definitions.map(t => t.category))];
  return { tools: definitions, categories, totalTools: definitions.length };
});

// Issue #89 L14: Webhook dead letter queue
app.get('/v1/webhooks/dead-letter', async () => {
  for (const ch of channels.getChannels()) {
    if (ch.name === 'webhook' && typeof ch.getDeadLetterQueue === 'function') {
      return ch.getDeadLetterQueue();
    }
  }
  return [];
});

// Issue #89 L15: Per-channel health reporting
app.get('/v1/channels/health', async () => {
  return channels.getChannels().map(ch => {
    const health = ch.getHealth?.();
    if (health) return health;
    return { channel: ch.name, healthy: true, lastSuccess: null, lastError: null, pendingCount: 0 };
  });
});

// Issue #87: Per-session latency metrics
app.get<{ Params: { id: string } }>('/v1/sessions/:id/latency', async (req, reply) => {
  const sessionId = (req.params as { id: string }).id;
  const session = requireOwnership(sessionId, reply, req.authKeyId);
  if (!session) return;

  const realtimeLatency = sessions.getLatencyMetrics(req.params.id);
  const aggregatedLatency = metrics.getSessionLatency(req.params.id);

  return {
    sessionId: req.params.id,
    realtime: realtimeLatency,
    aggregated: aggregatedLatency,
  };
});

// Global SSE event stream — aggregates events from ALL active sessions
app.get('/v1/events', async (req, reply) => {
  const clientIp = req.ip;
  const acquireResult = sseLimiter.acquire(clientIp);
  if (!acquireResult.allowed) {
    const status = acquireResult.reason === 'per_ip_limit' ? 429 : 503;
    return reply.status(status).send({
      error: acquireResult.reason === 'per_ip_limit'
        ? `Per-IP connection limit reached (${acquireResult.current}/${acquireResult.limit})`
        : `Global connection limit reached (${acquireResult.current}/${acquireResult.limit})`,
      reason: acquireResult.reason,
    });
  }

  // Issue #505: Subscribe BEFORE writing response headers so that if
  // subscription fails, we can still return a proper HTTP error.
  let unsubscribe: (() => void) | undefined;
  const connectionId = acquireResult.connectionId;
  let writer: SSEWriter;

  // Queue events that arrive between subscription and writer creation
  const pendingEvents: GlobalSSEEvent[] = [];
  let subscriptionReady = false;

  const handler = (event: GlobalSSEEvent): void => {
    if (!subscriptionReady) {
      pendingEvents.push(event);
      return;
    }
    const id = event.id != null ? `id: ${event.id}\n` : '';
    writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    unsubscribe = eventBus.subscribeGlobal(handler);
  } catch (err) {
    req.log.error({ err }, 'Global SSE subscription failed');
    sseLimiter.release(connectionId);
    return reply.status(500).send({ error: 'Failed to create SSE subscription' });
  }

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  writer = new SSEWriter(reply.raw, req.raw, () => {
    unsubscribe?.();
    sseLimiter.release(connectionId);
  });

  // Now safe to deliver events — flush any queued during setup
  subscriptionReady = true;
  for (const event of pendingEvents) {
    const id = event.id != null ? `id: ${event.id}\n` : '';
    writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
  }

  writer.write(`data: ${JSON.stringify({
    event: 'connected',
    timestamp: new Date().toISOString(),
    data: { activeSessions: sessions.listSessions().length },
  })}\n\n`);

  // Issue #301: Replay missed global events if client sends Last-Event-ID
  const lastEventId = req.headers['last-event-id'];
  if (lastEventId) {
    const missed = eventBus.getGlobalEventsSince(parseInt(lastEventId as string, 10) || 0);
    for (const { id, event: globalEvent } of missed) {
      writer.write(`id: ${id}\ndata: ${JSON.stringify(globalEvent)}\n\n`);
    }
  }
  writer.startHeartbeat(30_000, 90_000, () =>
    `data: ${JSON.stringify({ event: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`
  );

  await reply;
});

// List sessions (with pagination, status filter, and project filter)
app.get<{
  Querystring: { page?: string; limit?: string; status?: string; project?: string };
}>('/v1/sessions', async (req) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
  const statusFilter = req.query.status;
  const projectFilter = req.query.project;

  let all = sessions.listSessions();
  // Issue #1429: Scope sessions to owner for non-master keys
  const callerKeyId = req.authKeyId;
  if (callerKeyId !== 'master' && callerKeyId !== null && callerKeyId !== undefined) {
    all = all.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);
  }
  if (statusFilter) {
    all = all.filter(s => s.status === statusFilter);
  }
  // Issue #754: filter by project (workDir prefix/substring match)
  if (projectFilter) {
    const lower = projectFilter.toLowerCase();
    all = all.filter(s => s.workDir.toLowerCase().includes(lower));
  }

  // Sort by createdAt descending (newest first)
  all.sort((a, b) => b.createdAt - a.createdAt);

  const total = all.length;
  const start = (page - 1) * limit;
  const items = all.slice(start, start + limit);

  const totalPages = Math.ceil(total / limit);

  return {
    sessions: items,
    pagination: { page, limit, total, totalPages },
  };
});

// Issue #754: Session statistics endpoint
app.get('/v1/sessions/stats', async (req) => {
  let all = sessions.listSessions();
  const callerKeyId = req.authKeyId;
  if (callerKeyId !== 'master' && callerKeyId !== null && callerKeyId !== undefined) {
    all = all.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);
  }
  const byStatus: Partial<Record<string, number>> = {};
  for (const s of all) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  }
  const global = metrics.getGlobalMetrics(all.length);
  return {
    active: all.length,
    byStatus,
    totalCreated: global.sessions.total_created,
    totalCompleted: global.sessions.completed,
    totalFailed: global.sessions.failed,
  };
});

// Issue #754: Bulk-delete sessions by IDs and/or status
const batchDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).max(100).optional(),
  status: z.enum([
    'idle', 'working', 'compacting', 'context_warning', 'waiting_for_input',
    'permission_prompt', 'plan_mode', 'ask_question', 'bash_approval',
    'settings', 'error', 'unknown',
  ]).optional(),
}).refine(d => d.ids !== undefined || d.status !== undefined, {
  message: 'At least one of "ids" or "status" is required',
});

app.delete('/v1/sessions/batch', async (req, reply) => {
  const parsed = batchDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
  }
  const { ids, status } = parsed.data;

  // Collect target session IDs
  const targets = new Set<string>(ids ?? []);
  if (status) {
    for (const s of sessions.listSessions()) {
      if (s.status === status) targets.add(s.id);
    }
  }

  let deleted = 0;
  const notFound: string[] = [];
  const errors: string[] = [];

  for (const id of targets) {
    const session = sessions.getSession(id);
    // Issue #1429: Enforce ownership in batch delete
    if (!session) {
      notFound.push(id);
      continue;
    }
    // Skip sessions owned by another key (unless master/no-auth)
    const callerKeyId = req.authKeyId;
    if (session.ownerKeyId && callerKeyId !== 'master' && callerKeyId !== null && callerKeyId !== undefined && session.ownerKeyId !== callerKeyId) {
      continue;
    }
    try {
      await sessions.killSession(id);
      eventBus.emitEnded(id, 'killed');
      void channels.sessionEnded(makePayload('session.ended', id, 'killed'));
      cleanupTerminatedSessionState(id, { monitor, metrics, toolRegistry });
      deleted++;
    } catch (e: unknown) {
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return reply.status(200).send({ deleted, notFound, errors });
});

// Issue #1096: async version of execFile for non-blocking version check
const execFileAsync = promisify(execFile);

// Backwards compat: /sessions (no prefix) returns raw array
app.get('/sessions', async () => sessions.listSessions());

/** Validate workDir — delegates to validation.ts (Issue #435). */
const validateWorkDirWithConfig = (workDir: string) => validateWorkDir(workDir, config.allowedWorkDirs);


// Create session (Issue #607: reuse idle session for same workDir)
async function createSessionHandler(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
  }
  const { workDir, name, prompt, prd, resumeSessionId, claudeCommand, env, stallThresholdMs, permissionMode, autoApprove, parentId, memoryKeys } = parsed.data;
  if (!workDir) return reply.status(400).send({ error: 'workDir is required' });

  // Issue #564: Validate installed Claude Code version
  try {
    const { stdout: raw } = await execFileAsync('claude', ['--version'], { encoding: 'utf-8', timeout: 5000 });
    const ccVer = extractCCVersion(raw);
    if (ccVer !== null && compareSemver(ccVer, MIN_CC_VERSION) < 0) {
      return reply.status(422).send({
        error: `Claude Code version ${ccVer} is below minimum supported version ${MIN_CC_VERSION}. Please upgrade.`,
        code: 'CC_VERSION_TOO_OLD',
        upgrade: 'Run: claude update  or  npm install -g @anthropic-ai/claude-code@latest',
      });
    }
  } catch {
    // claude CLI not found or timed out — skip version check (fails open)
  }

  const safeWorkDir = await validateWorkDirWithConfig(workDir);
  if (typeof safeWorkDir === 'object') return reply.status(400).send({ error: safeWorkDir.error, code: safeWorkDir.code });

  // Issue #607: Check for an existing idle session with the same workDir
  const existing = await sessions.findIdleSessionByWorkDir(safeWorkDir);
  if (existing) {
    try {
      // Send prompt to the existing session if provided
      let promptDelivery: { delivered: boolean; attempts: number } | undefined;
      if (prompt) {
        let finalPrompt = prompt;
        if (memoryKeys && memoryKeys.length > 0 && memoryBridge) {
          const resolved = memoryBridge.resolveKeys(memoryKeys);
          if (resolved.size > 0) {
            const lines = ['[Memory context]'];
            for (const [k, v] of resolved) lines.push(`${k}: ${v}`);
            lines.push('', prompt);
            finalPrompt = lines.join('\n');
          }
        }
        promptDelivery = await sessions.sendInitialPrompt(existing.id, finalPrompt);
        metrics.promptSent(promptDelivery.delivered);
      }
      return reply.status(200).send({ ...existing, reused: true, promptDelivery });
    } finally {
      sessions.releaseSessionClaim(existing.id);
    }
  }

  console.time("POST_CREATE_SESSION");
  const session = await sessions.createSession({ workDir: safeWorkDir, name, prd, resumeSessionId, claudeCommand, env, stallThresholdMs, permissionMode, autoApprove, parentId, ownerKeyId: req.authKeyId });
  console.timeEnd("POST_CREATE_SESSION"); console.time("POST_CHANNEL_CREATED");

  // Issue #625: Track session in metrics so sessionsCreated counter is accurate
  metrics.sessionCreated(session.id);

  // #1419: Audit session creation
  if (auditLogger) void auditLogger.log(req.authKeyId ?? 'system', 'session.create', `Session created: ${session.windowName} in ${safeWorkDir}`, session.id);

  // Issue #46: Create Telegram topic BEFORE sending prompt.
  // The monitor starts polling immediately after createSession().
  // If we wait for sendInitialPrompt (up to 15s), the monitor may find
  // new messages but can't forward them because no topic exists yet.
  // Those messages are lost forever (monitorOffset advances past them).
  await channels.sessionCreated({
    event: 'session.created',
    timestamp: new Date().toISOString(),
    session: { id: session.id, name: session.windowName, workDir },
    detail: `Session created: ${session.windowName}`,
    meta: prompt ? { prompt: prompt.slice(0, 200), permissionMode: permissionMode ?? (autoApprove ? 'bypassPermissions' : undefined) } : undefined,
  });
  console.timeEnd("POST_CHANNEL_CREATED"); console.time("POST_SEND_INITIAL_PROMPT");

  // Now send the prompt (topic exists, monitor can forward messages)
  let promptDelivery: { delivered: boolean; attempts: number } | undefined;
  if (prompt) {
    // Issue #783: Inject resolved memory values into prompt
    let finalPrompt = prompt;
    if (memoryKeys && memoryKeys.length > 0 && memoryBridge) {
      const resolved = memoryBridge.resolveKeys(memoryKeys);
      if (resolved.size > 0) {
        const lines = ['[Memory context]'];
        for (const [k, v] of resolved) lines.push(`${k}: ${v}`);
        lines.push('', prompt);
        finalPrompt = lines.join('\n');
      }
    }
    promptDelivery = await sessions.sendInitialPrompt(session.id, finalPrompt);
    console.timeEnd("POST_SEND_INITIAL_PROMPT");
    metrics.promptSent(promptDelivery.delivered);
  } else {
    console.timeEnd("POST_SEND_INITIAL_PROMPT");
  }

  return reply.status(201).send({ ...session, promptDelivery });
}
app.post('/v1/sessions', { config: { rateLimit: RATE_LIMITS.sessionCreate } }, createSessionHandler);
app.post('/sessions', { config: { rateLimit: RATE_LIMITS.sessionCreate } }, createSessionHandler);

// Get session (Issue #20: includes actionHints for interactive states)
async function getSessionHandler(req: IdRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
  const sessionId = (req.params as { id: string }).id;
  const session = requireOwnership(sessionId, reply, req.authKeyId);
  if (!session) return reply as unknown as Record<string, unknown>;
  return addActionHints(session, sessions);
}
app.get<IdParams>('/v1/sessions/:id', getSessionHandler);
app.get<IdParams>('/sessions/:id', getSessionHandler);

// #128: Bulk health check — returns health for all sessions in one request
app.get('/v1/sessions/health', async (req) => {
  const callerKeyId = req.authKeyId;
  const callerRole = auth.getRole(callerKeyId ?? null);
  const allSessions = sessions.listSessions();
  const visibleSessions = callerRole === 'admin' || callerKeyId === null || callerKeyId === undefined
    ? allSessions
    : allSessions.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);
  const results: Record<string, {
    alive: boolean;
    windowExists: boolean;
    claudeRunning: boolean;
    paneCommand: string | null;
    status: string;
    hasTranscript: boolean;
    lastActivity: number;
    lastActivityAgo: number;
    sessionAge: number;
    details: string;
  }> = {};
  await Promise.all(visibleSessions.map(async (s) => {
    try {
      results[s.id] = await sessions.getHealth(s.id);
    } catch { /* health check failed — report error state */
      results[s.id] = {
        alive: false, windowExists: false, claudeRunning: false,
        paneCommand: null, status: 'unknown', hasTranscript: false,
        lastActivity: 0, lastActivityAgo: 0, sessionAge: 0,
        details: 'Error fetching health',
      };
    }
  }));
  return results;
});

// Session health check (Issue #2)
async function sessionHealthHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
  if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
  try {
    return await sessions.getHealth(req.params.id);
  } catch (e: unknown) {
    return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
  }
}
app.get<IdParams>('/v1/sessions/:id/health', sessionHealthHandler);
app.get<IdParams>('/sessions/:id/health', sessionHealthHandler);

// Send message (with delivery verification — Issue #1)
async function sendMessageHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
  if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
  const { text } = parsed.data;
  try {
    const stallInfo = monitor.getStallInfo(req.params.id);
    const result = await sessions.sendMessage(req.params.id, text, stallInfo);
    await channels.message({
      event: 'message.user',
      timestamp: new Date().toISOString(),
      session: { id: req.params.id, name: '', workDir: '' },
      detail: text,
    });
    const response: Record<string, unknown> = { ok: true, delivered: result.delivered, attempts: result.attempts };
    if (result.stall) response.stall = result.stall;
    return response;
  } catch (e: unknown) {
    return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
  }
}
app.post<IdParams>('/v1/sessions/:id/send', sendMessageHandler);
app.post<IdParams>('/sessions/:id/send', sendMessageHandler);

// Issue #702: GET children sessions
async function getChildrenHandler(req: IdRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
  const sessionId = (req.params as { id: string }).id;
  const session = requireOwnership(sessionId, reply, req.authKeyId);
  if (!session) return reply as unknown as Record<string, unknown>;
  const children = (session.children ?? []).map(id => {
    const child = sessions.getSession(id);
    if (!child) return null;
    return { id: child.id, windowName: child.windowName, status: child.status, createdAt: child.createdAt };
  }).filter(Boolean);
  return { children };
}
app.get<IdParams>('/v1/sessions/:id/children', getChildrenHandler);
app.get<IdParams>('/sessions/:id/children', getChildrenHandler);

// Issue #702: Spawn child session
interface SpawnBody { name?: string; prompt?: string; workDir?: string; permissionMode?: string; }
type SpawnRequest = FastifyRequest<{ Params: { id: string }; Body: SpawnBody | undefined }>;
async function spawnChildHandler(req: SpawnRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
  const parentId = req.params.id;
  const parent = requireOwnership(parentId, reply, req.authKeyId);
  if (!parent) return reply as unknown as Record<string, unknown>;
  const { name, prompt, workDir, permissionMode } = req.body ?? {};
  const childName = name ?? `${parent.windowName ?? 'session'}-child`;
  const requestedWorkDir = workDir ?? parent.workDir;
  const safeChildWorkDir = await validateWorkDirWithConfig(requestedWorkDir);
  if (typeof safeChildWorkDir === 'object') {
    return reply.status(400).send({ error: `Invalid workDir: ${safeChildWorkDir.error}`, code: safeChildWorkDir.code });
  }
  const childPermMode = permissionMode ?? parent.permissionMode ?? 'default';
  const childSession = await sessions.createSession({ workDir: safeChildWorkDir, name: childName, parentId, permissionMode: childPermMode, ownerKeyId: req.authKeyId });
  let promptDelivery: { delivered: boolean; attempts: number } | undefined;
  if (prompt) { promptDelivery = await sessions.sendInitialPrompt(childSession.id, prompt); }
  return reply.status(201).send({ ...childSession, promptDelivery });
}
app.post('/v1/sessions/:id/spawn', spawnChildHandler);
app.post('/sessions/:id/spawn', spawnChildHandler);

// Issue #468: Fork session — create independent session inheriting environment
interface ForkBody { name?: string; prompt?: string; clearPanes?: boolean; }
type ForkRequest = FastifyRequest<{ Params: { id: string }; Body: ForkBody | undefined }>;
async function forkSessionHandler(req: ForkRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
  const parentId = req.params.id;
  const parent = requireOwnership(parentId, reply, req.authKeyId);
  if (!parent) return reply as unknown as Record<string, unknown>;
  const { name, prompt } = req.body ?? {};
  const forkName = name ?? `${parent.windowName ?? 'session'}-fork`;
  // Inherit: workDir, permissionMode, env (collect from parent's env vars if stored)
  // Note: Parent's env vars are passed during creation but not stored in SessionInfo
  // For now, we inherit structural settings (workDir, permissionMode)
  const forkedSession = await sessions.createSession({
    workDir: parent.workDir,
    name: forkName,
    permissionMode: parent.permissionMode,
    ownerKeyId: req.authKeyId,
  });
  let promptDelivery: { delivered: boolean; attempts: number } | undefined;
  if (prompt) { promptDelivery = await sessions.sendInitialPrompt(forkedSession.id, prompt); }
  await channels.sessionCreated({
    event: 'session.created',
    timestamp: new Date().toISOString(),
    session: { id: forkedSession.id, name: forkedSession.windowName, workDir: parent.workDir },
    detail: `Session forked from ${parentId}`,
  });
  return reply.status(201).send({ ...forkedSession, forkedFrom: parentId, promptDelivery });
}
app.post('/v1/sessions/:id/fork', forkSessionHandler);
app.post('/sessions/:id/fork', forkSessionHandler);

// Issue #700: Permission policy endpoints
type PermissionRequest = FastifyRequest<{ Params: { id: string }; Body: PermissionPolicy | undefined }>;
async function getPermissionPolicyHandler(req: IdRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
  const sessionId = (req.params as { id: string }).id;
  const session = requireOwnership(sessionId, reply, req.authKeyId);
  if (!session) return reply as unknown as Record<string, unknown>;
  return { permissionPolicy: session.permissionPolicy ?? [] };
}
async function updatePermissionPolicyHandler(req: PermissionRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
  const sessionId = (req.params as { id: string }).id;
  const session = requireOwnership(sessionId, reply, req.authKeyId);
  if (!session) return reply as unknown as Record<string, unknown>;
  const policy = req.body ?? [];
  const result = permissionRuleSchema.array().safeParse(policy);
  if (!result.success) return reply.status(400).send({ error: 'Invalid permission policy', details: result.error.issues });
  session.permissionPolicy = policy;
  await sessions.save();
  return { permissionPolicy: policy };
}
app.get<IdParams>('/v1/sessions/:id/permissions', getPermissionPolicyHandler);
app.put('/v1/sessions/:id/permissions', updatePermissionPolicyHandler);
app.get<IdParams>('/sessions/:id/permissions', getPermissionPolicyHandler);
app.put('/sessions/:id/permissions', updatePermissionPolicyHandler);

type PermissionProfileRequest = FastifyRequest<{ Params: { id: string }; Body: PermissionProfile | undefined }>;
async function getPermissionProfileHandler(req: IdRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
  const sessionId = (req.params as { id: string }).id;
  const session = requireOwnership(sessionId, reply, req.authKeyId);
  if (!session) return reply as unknown as Record<string, unknown>;
  return { permissionProfile: session.permissionProfile ?? null };
}
async function updatePermissionProfileHandler(req: PermissionProfileRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
  const sessionId = (req.params as { id: string }).id;
  const session = requireOwnership(sessionId, reply, req.authKeyId);
  if (!session) return reply as unknown as Record<string, unknown>;
  const parsed = permissionProfileSchema.safeParse(req.body ?? {});
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid permission profile', details: parsed.error.issues });
  session.permissionProfile = parsed.data;
  await sessions.save();
  return { permissionProfile: parsed.data };
}
app.get<IdParams>('/v1/sessions/:id/permission-profile', getPermissionProfileHandler);
app.put('/v1/sessions/:id/permission-profile', updatePermissionProfileHandler);
app.get<IdParams>('/sessions/:id/permission-profile', getPermissionProfileHandler);
app.put('/sessions/:id/permission-profile', updatePermissionProfileHandler);

// Read messages
async function readMessagesHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
  if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
  try {
    return await sessions.readMessages(req.params.id);
  } catch (e: unknown) {
    return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
  }
}
app.get<IdParams>('/v1/sessions/:id/read', readMessagesHandler);
app.get<IdParams>('/sessions/:id/read', readMessagesHandler);

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

// Issue #336: Answer pending AskUserQuestion
app.post<{
  Params: { id: string };
  Body: { questionId?: string; answer?: string };
}>('/v1/sessions/:id/answer', async (req, reply) => {
  const { questionId, answer } = req.body || {};
  if (!questionId || answer === undefined || answer === null) {
    return reply.status(400).send({ error: 'questionId and answer are required' });
  }
  const sessionId = (req.params as { id: string }).id;
  const session = requireOwnership(sessionId, reply, req.authKeyId);
  if (!session) return;
  const resolved = sessions.submitAnswer(req.params.id, questionId, answer);
  if (!resolved) {
    return reply.status(409).send({ error: 'No pending question matching this questionId' });
  }
  return { ok: true };
});

// Escape
async function escapeHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
  if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
  try {
    await sessions.escape(req.params.id);
    return { ok: true };
  } catch (e: unknown) {
    return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
  }
}
app.post<IdParams>('/v1/sessions/:id/escape', escapeHandler);
app.post<IdParams>('/sessions/:id/escape', escapeHandler);

// Interrupt (Ctrl+C)
async function interruptHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
  if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
  try {
    await sessions.interrupt(req.params.id);
    return { ok: true };
  } catch (e: unknown) {
    return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
  }
}
app.post<IdParams>('/v1/sessions/:id/interrupt', interruptHandler);
app.post<IdParams>('/sessions/:id/interrupt', interruptHandler);

// Kill session
async function killSessionHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
  // Issue #1432: Admin or operator can kill sessions
  if (!requireRole(req, reply, 'admin', 'operator')) return;
  if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
  try {
    // #842: killSession first, then notify — avoids race where channels
    // reference a session that is still being destroyed.
    await sessions.killSession(req.params.id);
    eventBus.emitEnded(req.params.id, 'killed');
    // #1419: Audit session kill
    if (auditLogger) void auditLogger.log(req.authKeyId ?? 'system', 'session.kill', `Session killed: ${req.params.id}`, req.params.id);
    await channels.sessionEnded(makePayload('session.ended', req.params.id, 'killed'));
    cleanupTerminatedSessionState(req.params.id, { monitor, metrics, toolRegistry });
    return { ok: true };
  } catch (e: unknown) {
    return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
  }
}
app.delete<IdParams>('/v1/sessions/:id', killSessionHandler);
app.delete<IdParams>('/sessions/:id', killSessionHandler);

// Capture raw pane
async function capturePaneHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
  const sessionId = (req.params as { id: string }).id;
  const session = requireOwnership(sessionId, reply, req.authKeyId);
  if (!session) return;
  const pane = await tmux.capturePane(session.windowId);
  return { pane };
}
app.get<IdParams>('/v1/sessions/:id/pane', capturePaneHandler);
app.get<IdParams>('/sessions/:id/pane', capturePaneHandler);

// Slash command
async function commandHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
  const parsed = commandSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
  if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
  const { command } = parsed.data;
  try {
    const cmd = command.startsWith('/') ? command : `/${command}`;
    await sessions.sendMessage(req.params.id, cmd);
    return { ok: true };
  } catch (e: unknown) {
    return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
  }
}
app.post<IdParams>('/v1/sessions/:id/command', commandHandler);
app.post<IdParams>('/sessions/:id/command', commandHandler);

// Bash mode
async function bashHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
  const parsed = bashSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
  if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
  const { command } = parsed.data;
  try {
    const cmd = command.startsWith('!') ? command : `!${command}`;
    await sessions.sendMessage(req.params.id, cmd);
    return { ok: true };
  } catch (e: unknown) {
    return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
  }
}
app.post<IdParams>('/v1/sessions/:id/bash', bashHandler);
app.post<IdParams>('/sessions/:id/bash', bashHandler);

// Session summary (Issue #35)
async function summaryHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
  if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
  try {
    return await sessions.getSummary(req.params.id);
  } catch (e: unknown) {
    return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
  }
}
app.get<IdParams>('/v1/sessions/:id/summary', summaryHandler);
app.get<IdParams>('/sessions/:id/summary', summaryHandler);

// Paginated transcript read
app.get<{
  Params: { id: string };
  Querystring: { page?: string; limit?: string; role?: string };
}>('/v1/sessions/:id/transcript', async (req, reply) => {
  if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
    const allowedRoles = new Set(['user', 'assistant', 'system']);
    const roleFilter = req.query.role as string | undefined;
    if (roleFilter && !allowedRoles.has(roleFilter)) {
      return reply.status(400).send({ error: `Invalid role filter: ${roleFilter}. Allowed values: user, assistant, system` });
    }
    return await sessions.readTranscript(req.params.id, page, limit, roleFilter as 'user' | 'assistant' | 'system' | undefined);
  } catch (e: unknown) {
    return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Cursor-based transcript replay (Issue #883): stable pagination under concurrent appends.
// GET /v1/sessions/:id/transcript/cursor?before_id=N&limit=50&role=user|assistant|system
app.get<{
  Params: { id: string };
  Querystring: { before_id?: string; limit?: string; role?: string };
}>('/v1/sessions/:id/transcript/cursor', async (req, reply) => {
  if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
  try {
    const rawBeforeId = req.query.before_id;
    const beforeId = rawBeforeId !== undefined ? parseInt(rawBeforeId, 10) : undefined;
    if (beforeId !== undefined && (!Number.isInteger(beforeId) || beforeId < 1)) {
      return reply.status(400).send({ error: 'before_id must be a positive integer' });
    }
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
    const allowedRoles = new Set(['user', 'assistant', 'system']);
    const roleFilter = req.query.role as string | undefined;
    if (roleFilter && !allowedRoles.has(roleFilter)) {
      return reply.status(400).send({ error: `Invalid role filter: ${roleFilter}. Allowed values: user, assistant, system` });
    }
    return await sessions.readTranscriptCursor(
      req.params.id,
      beforeId,
      limit,
      roleFilter as 'user' | 'assistant' | 'system' | undefined,
    );
  } catch (e: unknown) {
    return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Screenshot capture (Issue #22)
async function screenshotHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
  const parsed = screenshotSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
  const { url, fullPage, width, height } = parsed.data;

  const urlError = validateScreenshotUrl(url);
  if (urlError) return reply.status(400).send({ error: urlError });

  // DNS-resolution check: resolve hostname and reject private IPs.
  // Returns the resolved IP so we can pin it via --host-resolver-rules to prevent
  // DNS rebinding (TOCTOU) between validation and page.goto().
  const hostname = new URL(url).hostname;
  const dnsResult = await resolveAndCheckIp(hostname);
  if (dnsResult.error) return reply.status(400).send({ error: dnsResult.error });

  // Validate session exists and caller owns it
  const sessionId = (req.params as { id: string }).id;
  const session = requireOwnership(sessionId, reply, req.authKeyId);
  if (!session) return;

  if (!isPlaywrightAvailable()) {
    return reply.status(501).send({
      error: 'Playwright is not installed',
      message: 'Install Playwright to enable screenshots: npx playwright install chromium && npm install -D playwright',
    });
  }

  try {
    // Pin the validated IP via host-resolver-rules to prevent DNS rebinding
    const hostResolverRule = dnsResult.resolvedIp
      ? buildHostResolverRule(hostname, dnsResult.resolvedIp)
      : undefined;
    const result = await captureScreenshot({ url, fullPage, width, height, hostResolverRule });
    return reply.status(200).send(result);
  } catch (e: unknown) {
    return reply.status(500).send({ error: `Screenshot failed: ${e instanceof Error ? e.message : String(e)}` });
  }
}
app.post<IdParams>('/v1/sessions/:id/screenshot', screenshotHandler);
app.post<IdParams>('/sessions/:id/screenshot', screenshotHandler);

// SSE event stream (Issue #32)
app.get<{ Params: { id: string } }>('/v1/sessions/:id/events', async (req, reply) => {
  const sessionId = (req.params as { id: string }).id;
  const session = requireOwnership(sessionId, reply, req.authKeyId);
  if (!session) return;

  const clientIp = req.ip;
  const acquireResult = sseLimiter.acquire(clientIp);
  if (!acquireResult.allowed) {
    const status = acquireResult.reason === 'per_ip_limit' ? 429 : 503;
    return reply.status(status).send({
      error: acquireResult.reason === 'per_ip_limit'
        ? `Per-IP connection limit reached (${acquireResult.current}/${acquireResult.limit})`
        : `Global connection limit reached (${acquireResult.current}/${acquireResult.limit})`,
      reason: acquireResult.reason,
    });
  }

  // Issue #505: Subscribe BEFORE writing response headers so that if
  // subscription fails, we can still return a proper HTTP error.
  let unsubscribe: (() => void) | undefined;
  const connectionId = acquireResult.connectionId;
  let writer: SSEWriter;

  // Queue events that arrive between subscription and writer creation
  const pendingEvents: SessionSSEEvent[] = [];
  let subscriptionReady = false;

  try {
    const handler = (event: SessionSSEEvent): void => {
      if (!subscriptionReady) {
        pendingEvents.push(event);
        return;
      }
      const id = event.id != null ? `id: ${event.id}\n` : '';
      writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
    };
    unsubscribe = eventBus.subscribe(req.params.id, handler);
  } catch (err) {
    req.log.error({ err, sessionId: req.params.id }, 'SSE subscription failed — unable to create event listener');
    sseLimiter.release(connectionId);
    return reply.status(500).send({ error: 'Failed to create SSE subscription' });
  }

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  writer = new SSEWriter(reply.raw, req.raw, () => {
    unsubscribe?.();
    sseLimiter.release(connectionId);
  });

  // Now safe to deliver events — flush any queued during setup
  subscriptionReady = true;
  for (const event of pendingEvents) {
    const id = event.id != null ? `id: ${event.id}\n` : '';
    writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
  }

  // Send initial connected event
  writer.write(`data: ${JSON.stringify({ event: 'connected', sessionId: session.id, timestamp: new Date().toISOString() })}\n\n`);

  // Issue #308: Replay missed events if client sends Last-Event-ID
  const lastEventId = req.headers['last-event-id'];
  if (lastEventId) {
    const missed = eventBus.getEventsSince(req.params.id, parseInt(lastEventId as string, 10) || 0);
    for (const event of missed) {
      const id = event.id != null ? `id: ${event.id}\n` : '';
      writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
    }
  }

  writer.startHeartbeat(30_000, 90_000, () =>
    `data: ${JSON.stringify({ event: 'heartbeat', sessionId: session.id, timestamp: new Date().toISOString() })}\n\n`
  );

  // Don't let Fastify auto-send (we manage the response manually)
  await reply;
});
// ── Claude Code Hook Endpoints (Issue #161) ─────────────────────────

// POST /v1/sessions/:id/hooks/permission — PermissionRequest hook from CC
app.post<{
  Params: { id: string };
  Body: {
    session_id?: string;
    tool_name?: string;
    tool_input?: unknown;
    permission_mode?: string;
    hook_event_name?: string;
  };
}>('/v1/sessions/:id/hooks/permission', async (req, reply) => {
  const sessionId = (req.params as { id: string }).id;
  const session = sessions.getSession(sessionId);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  const parsed = permissionHookSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
  const { tool_name, tool_input, permission_mode } = parsed.data;

  // Update session status
  session.status = 'permission_prompt';
  session.lastActivity = Date.now();
  await sessions.save();

  // Notify channels and SSE
  const detail = tool_name
    ? `Permission request: ${tool_name}${permission_mode ? ` (${permission_mode})` : ''}`
    : 'Permission requested';
  await channels.statusChange({
    event: 'status.permission',
    timestamp: new Date().toISOString(),
    session: { id: session.id, name: session.windowName, workDir: session.workDir },
    detail,
    meta: { tool_name, tool_input, permission_mode },
  });
  eventBus.emitApproval(session.id, detail);

  return reply.status(200).send({});
});

// POST /v1/sessions/:id/hooks/stop — Stop hook from CC
app.post<{
  Params: { id: string };
  Body: {
    session_id?: string;
    stop_reason?: string;
    hook_event_name?: string;
  };
}>('/v1/sessions/:id/hooks/stop', async (req, reply) => {
  const sessionId = (req.params as { id: string }).id;
  const session = sessions.getSession(sessionId);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  const parsed = stopHookSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
  const { stop_reason } = parsed.data;

  // Update session status
  session.status = 'idle';
  session.lastActivity = Date.now();
  await sessions.save();

  // Notify channels and SSE
  const detail = stop_reason
    ? `Claude Code stopped: ${stop_reason}`
    : 'Claude Code session ended normally';
  await channels.statusChange({
    event: 'status.idle',
    timestamp: new Date().toISOString(),
    session: { id: session.id, name: session.windowName, workDir: session.workDir },
    detail,
    meta: { stop_reason },
  });
  eventBus.emitStatus(session.id, 'idle', detail);

  return reply.status(200).send({});
});

// Batch create (Issue #36, #583: per-key batch rate limit + global session cap)
const MAX_CONCURRENT_SESSIONS = 200;
app.post('/v1/sessions/batch', async (req, reply) => {
  const parsed = batchSessionSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
  const specs = parsed.data.sessions;

  // #583: Per-key batch rate limit (max 1 batch per 5 seconds)
  const keyId = requestKeyMap.get(req.id) ?? 'anonymous';
  if (auth.checkBatchRateLimit(keyId)) {
    return reply.status(429).send({ error: 'Batch rate limit exceeded — 1 batch per 5 seconds per key' });
  }

  // #583: Global concurrent session cap
  const currentCount = sessions.listSessions().length;
  if (currentCount + specs.length > MAX_CONCURRENT_SESSIONS) {
    return reply.status(429).send({ error: `Session cap exceeded — ${currentCount} active, max ${MAX_CONCURRENT_SESSIONS}` });
  }

  for (const spec of specs) {
    const safeWorkDir = await validateWorkDirWithConfig(spec.workDir);
    if (typeof safeWorkDir === 'object') {
      return reply.status(400).send({ error: `Invalid workDir "${spec.workDir}": ${safeWorkDir.error}`, code: safeWorkDir.code });
    }
    spec.workDir = safeWorkDir;
    // Issue #1429: Stamp owner on batch-created sessions
    if (req.authKeyId) (spec as Record<string, unknown>).ownerKeyId = req.authKeyId;
  }
  const result = await pipelines.batchCreate(specs);
  return reply.status(201).send(result);
});

// Issue #740: Verification Protocol — run quality gate (tsc + build + test) on a session's workDir
app.post('/v1/sessions/:id/verify', async (req, reply) => {
  const sessionId = (req.params as { id: string }).id;
  const session = requireOwnership(sessionId, reply, req.authKeyId);
  if (!session) return;

  const { workDir } = session;
  if (!workDir) return reply.status(400).send({ error: 'Session has no workDir' });

  const criticalOnly = (config as { verificationProtocol?: { criticalOnly?: boolean } }).verificationProtocol?.criticalOnly ?? false;
  eventBus.emitStatus(sessionId, 'working', `Running verification (criticalOnly=${criticalOnly})…`);

  try {
    const result = await runVerification(workDir, criticalOnly);
    eventBus.emitVerification(sessionId, result);
    const httpStatus = result.ok ? 200 : 422;
    return reply.status(httpStatus).send(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return reply.status(500).send({ ok: false, summary: `Verification error: ${msg}` });
  }
});


// Pipeline create (Issue #36)
app.post('/v1/pipelines', async (req, reply) => {
  const parsed = pipelineSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
  const pipeConfig = parsed.data;
  const safeWorkDir = await validateWorkDirWithConfig(pipeConfig.workDir);
  if (typeof safeWorkDir === 'object') {
    return reply.status(400).send({ error: `Invalid workDir: ${safeWorkDir.error}`, code: safeWorkDir.code });
  }
  pipeConfig.workDir = safeWorkDir;
  // Validate per-stage workDir overrides for path traversal (#631)
  for (const stage of pipeConfig.stages) {
    if (stage.workDir) {
      const safeStageWorkDir = await validateWorkDirWithConfig(stage.workDir);
      if (typeof safeStageWorkDir === 'object') {
        return reply.status(400).send({ error: `Invalid workDir for stage "${stage.name}": ${safeStageWorkDir.error}`, code: safeStageWorkDir.code });
      }
      stage.workDir = safeStageWorkDir;
    }
  }
  try {
    const pipeline = await pipelines.createPipeline(pipeConfig);
    return reply.status(201).send(pipeline);
  } catch (e: unknown) {
    return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Pipeline status
app.get<{ Params: { id: string } }>('/v1/pipelines/:id', async (req, reply) => {
  const pipeline = pipelines.getPipeline(req.params.id);
  if (!pipeline) return reply.status(404).send({ error: 'Pipeline not found' });
  return pipeline;
});

// List pipelines
app.get('/v1/pipelines', async () => pipelines.listPipelines());

// ── Session Templates (Issue #467) ──────────────────────────────────

interface CreateTemplateRequest {
  name: string;
  description?: string;
  sessionId?: string; // optional: if provided, copy session fields
  workDir?: string;
  prompt?: string;
  claudeCommand?: string;
  env?: Record<string, string>;
  stallThresholdMs?: number;
  permissionMode?: 'default' | 'bypassPermissions' | 'plan' | 'acceptEdits' | 'dontAsk' | 'auto';
  autoApprove?: boolean;
  memoryKeys?: string[];
}

const createTemplateSchema = z.object({
  name: z.string().max(100),
  description: z.string().max(500).optional(),
  sessionId: z.string().uuid().optional(),
  workDir: z.string().min(1).optional(),
  prompt: z.string().max(100_000).optional(),
  claudeCommand: z.string().max(500).regex(SAFE_COMMAND_RE).optional(),
  env: z.record(z.string(), z.string()).optional(),
  stallThresholdMs: z.number().int().positive().max(3_600_000).optional(),
  permissionMode: z.enum(['default', 'bypassPermissions', 'plan', 'acceptEdits', 'dontAsk', 'auto']).optional(),
  autoApprove: z.boolean().optional(),
  memoryKeys: z.array(z.string()).max(50).optional(),
}).strict();

// POST /v1/templates — Create a new template
app.post<{ Body: CreateTemplateRequest }>('/v1/templates', async (req, reply) => {
  const parsed = createTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
  }

  const { name, description, sessionId, ...templateData } = parsed.data;

  // If sessionId is provided, fill in missing fields from the session
  const finalData = { ...templateData };
  if (sessionId) {
    const session = sessions.getSession(sessionId);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    // Use session's workDir if not explicitly provided
    if (!finalData.workDir) {
      finalData.workDir = session.workDir;
    }
    if (!finalData.stallThresholdMs && session.stallThresholdMs) {
      finalData.stallThresholdMs = session.stallThresholdMs;
    }
    if (!finalData.permissionMode && session.permissionMode !== 'default') {
      finalData.permissionMode = session.permissionMode as CreateTemplateRequest['permissionMode'];
    }
  }

  if (!finalData.workDir) {
    return reply.status(400).send({ error: 'workDir is required (provide sessionId or explicit workDir)' });
  }

  // Issue #1125: Validate workDir for path traversal at template creation time
  const safeWorkDir = await validateWorkDirWithConfig(finalData.workDir);
  if (typeof safeWorkDir === 'object') {
    return reply.status(400).send({ error: `Invalid workDir: ${safeWorkDir.error}`, code: safeWorkDir.code });
  }

  try {
    const template = await templateStore.createTemplate({
      name,
      description,
      workDir: safeWorkDir,
      prompt: finalData.prompt,
      claudeCommand: finalData.claudeCommand,
      env: finalData.env,
      stallThresholdMs: finalData.stallThresholdMs,
      permissionMode: finalData.permissionMode,
      autoApprove: finalData.autoApprove,
      memoryKeys: finalData.memoryKeys,
    });
    return reply.status(201).send(template);
  } catch (e: unknown) {
    return reply.status(500).send({ error: e instanceof Error ? e.message : 'Failed to create template' });
  }
});

// GET /v1/templates — List all templates
app.get('/v1/templates', { config: { rateLimit: RATE_LIMITS.expensiveRead } }, async () => {
  try {
    return await templateStore.listTemplates();
  } catch (_e: unknown) {
    return [];
  }
});

// GET /v1/templates/:id — Get a specific template
app.get<{ Params: { id: string } }>('/v1/templates/:id', async (req, reply) => {
  try {
    const template = await templateStore.getTemplate(req.params.id);
    if (!template) {
      return reply.status(404).send({ error: 'Template not found' });
    }
    return template;
  } catch (e: unknown) {
    return reply.status(500).send({ error: e instanceof Error ? e.message : 'Failed to get template' });
  }
});

// PUT /v1/templates/:id — Update a template
app.put<{ Params: { id: string }; Body: Partial<CreateTemplateRequest> }>('/v1/templates/:id', async (req, reply) => {
  try {
    const updates = createTemplateSchema.partial().safeParse(req.body);
    if (!updates.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: updates.error.issues });
    }

    const template = await templateStore.updateTemplate(req.params.id, updates.data as Parameters<typeof templateStore.updateTemplate>[1]);
    if (!template) {
      return reply.status(404).send({ error: 'Template not found' });
    }
    return template;
  } catch (e: unknown) {
    return reply.status(500).send({ error: e instanceof Error ? e.message : 'Failed to update template' });
  }
});

// DELETE /v1/templates/:id — Delete a template
app.delete<{ Params: { id: string } }>('/v1/templates/:id', async (req, reply) => {
  try {
    const deleted = await templateStore.deleteTemplate(req.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Template not found' });
    }
    return { ok: true };
  } catch (e: unknown) {
    return reply.status(500).send({ error: e instanceof Error ? e.message : 'Failed to delete template' });
  }
});

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

// ── Helpers ──────────────────────────────────────────────────────────

/** Issue #20: Add actionHints to session response for interactive states. */
function addActionHints(
  session: import('./session.js').SessionInfo,
  sessions?: SessionManager,
): Record<string, unknown> {
  // #357: Convert Set to array for JSON serialization
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
  // #599: Expose pending question data for MCP/REST callers
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
function extractQuestionOptions(text: string): string[] | null {
  // Numbered options: "1. Foo\n2. Bar"
  const numberedRegex = /^\s*(\d+)\.\s+(.+)$/gm;
  const options: string[] = [];
  let m;
  while ((m = numberedRegex.exec(text)) !== null) {
    options.push(m[2].trim());
  }
  if (options.length >= 2) return options.slice(0, 4);
  return null;
}

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

// Preserve public export used by tests and external imports.
export { readParentPid as readPpid } from './process-utils.js';

async function main(): Promise<void> {
  // Load configuration
  config = await loadConfig();

  // Initialize core components with config
  tmux = new TmuxManager(config.tmuxSession);
  sessions = new SessionManager(tmux, config);
  const container = new ServiceContainer();

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

  // #1419: Initialize audit logger and wire into auth
  auditLogger = new AuditLogger(path.join(config.stateDir, 'audit'));
  await auditLogger.init();
  auth.setAuditLogger(auditLogger);

  // Issue #1418: Initialize production alerting
  alertManager = new AlertManager(config.alerting);
  if (config.alerting.webhooks.length > 0) {
    console.log(`Alerting enabled: ${config.alerting.webhooks.length} webhook(s), threshold=${config.alerting.failureThreshold}`);
  }

  // Wire monitor dependencies before lifecycle startup.
  monitor.setEventBus(eventBus);
  monitor.setTmuxManager(tmux);
  monitor.setAlertManager(alertManager);
  jsonlWatcher = new JsonlWatcher();
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
  registerHookRoutes(app, { sessions, eventBus, metrics, hookSecretHeaderOnly: config.hookSecretHeaderOnly });

  // Initialize pipeline manager (Issue #36, #1424)
  pipelines = new PipelineManager(sessions, eventBus, config.stateDir, config.pipelineStageTimeoutMs);
  await pipelines.hydrate(config.stateDir);

  // Initialize batch rate limiter (Issue #583)

  // Initialize metrics (Issue #40)
  metrics = new MetricsCollector(path.join(config.stateDir, 'metrics.json'));
  await metrics.load();

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

      // 4. Stop managed services in reverse dependency order with timeout safety
      const serviceStopTimeoutMs = Math.max(1_000, Math.floor(shutdownTimeoutMs / 5));
      const serviceStops = await container.stopAll({ timeoutMs: serviceStopTimeoutMs });
      for (const stopResult of serviceStops) {
        if (stopResult.status === 'timeout') {
          console.error(`Service shutdown timed out: ${stopResult.name}`);
        } else if (stopResult.status === 'error') {
          console.error(`Service shutdown failed: ${stopResult.name}`, stopResult.error);
        }
      }

      // 5. Save metrics
      try { await metrics.save(); } catch (e) { console.error('Error saving metrics:', e); }

      // 6. Cleanup PID file
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

  // Start monitor via dependency-aware service lifecycle.
  await container.start(['sessionMonitor']);

  // Issue #81: Start swarm monitor for agent swarm awareness
  swarmMonitor = new SwarmMonitor(sessions);
toolRegistry = new ToolRegistry();
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
  await container.assertHealthy();
  await listenWithRetry(app, config.port, config.host, config.stateDir);
  pidFilePath = await writePidFile(config.stateDir);
  console.log(`Aegis running on http://${config.host}:${config.port}`);
  console.log(`Channels: ${channels.count} registered`);
  console.log(`State dir: ${config.stateDir}`);
  console.log(`Claude projects dir: ${config.claudeProjectsDir}`);
  if (auth.authEnabled) {
    console.log('Auth: enabled');
  } else {
    console.warn('WARNING: No authentication configured — set AEGIS_AUTH_TOKEN to secure the server');
  }
}

main().catch(err => {
  console.error('Failed to start Aegis:', err);
  process.exit(1);
});
