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
import fs from 'node:fs/promises';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TmuxManager } from './tmux.js';
import { SessionManager } from './session.js';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG } from './monitor.js';
import { JsonlWatcher } from './jsonl-watcher.js';
import {
  ChannelManager,
  TelegramChannel,
  WebhookChannel,
  type InboundCommand,
  type SessionEvent,
  type SessionEventPayload,
} from './channels/index.js';
import { loadConfig, type Config } from './config.js';
import { captureScreenshot, isPlaywrightAvailable } from './screenshot.js';
import { validateScreenshotUrl, resolveAndCheckIp, buildHostResolverRule } from './ssrf.js';
import { validateWorkDir } from './validation.js';
import { SessionEventBus, type SessionSSEEvent, type GlobalSSEEvent } from './events.js';
import { SSEWriter } from './sse-writer.js';
import { SSEConnectionLimiter } from './sse-limiter.js';
import { PipelineManager, type BatchSessionSpec, type PipelineConfig } from './pipeline.js';
import { AuthManager } from './auth.js';
import { MetricsCollector } from './metrics.js';
import { registerHookRoutes } from './hooks.js';
import { registerWsTerminalRoute } from './ws-terminal.js';
import { SwarmMonitor } from './swarm-monitor.js';
import { killAllSessions } from './signal-cleanup-helper.js';
import { execFileSync } from 'node:child_process';
import { negotiate, type HandshakeRequest } from './handshake.js';
import {
  authKeySchema, sendMessageSchema, commandSchema, bashSchema,
  screenshotSchema, permissionHookSchema, stopHookSchema,
  batchSessionSchema, pipelineSchema, parseIntSafe, isValidUUID,
} from './validation.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Shared route handler types ────────────────────────────────────────
type IdParams = { Params: { id: string } };
type IdRequest = FastifyRequest<IdParams>;

// ── Configuration ────────────────────────────────────────────────────

// Issue #349: CSP policy for dashboard responses (shared between static and SPA fallback)
const DASHBOARD_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:";

// Config loaded at startup; env vars override file values
let config: Config;

// These will be initialized after config is loaded
let tmux: TmuxManager;
let sessions: SessionManager;
let monitor: SessionMonitor;
let jsonlWatcher: JsonlWatcher;
const channels = new ChannelManager();
const eventBus = new SessionEventBus();
let sseLimiter: SSEConnectionLimiter;let pipelines: PipelineManager;
let auth: AuthManager;
let metrics: MetricsCollector;
let swarmMonitor: SwarmMonitor;

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
        monitor.removeSession(cmd.sessionId);
        metrics.cleanupSession(cmd.sessionId);
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
  logger: {
    // #230: Redact auth tokens from request logs
    serializers: {
      req(req) {
        const url = req.url?.includes('token=')
          ? req.url.replace(/token=[^&]*/g, 'token=[REDACTED]')
          : req.url;
        return {
          method: req.method,
          url,
          // ...rest intentionally omitted — prevents token leakage via headers
        };
      },
    },
  },
});

// #227: Security headers on all API responses (skip SSE)
app.addHook('onSend', (req, reply, payload, done) => {
  const contentType = reply.getHeader('content-type');
  if (typeof contentType === 'string' && contentType.includes('text/event-stream')) {
    return done();
  }
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=()');
  done();
});

// Auth middleware setup (Issue #39: multi-key auth with rate limiting)
// #228: Per-IP rate limiting (applies even with master token, with higher limits)
// #622: Circular buffer — O(1) prune via index advancement instead of O(n) shift()
interface IpRateBucket {
  entries: number[];
  start: number;
}
const ipRateLimits = new Map<string, IpRateBucket>();
const IP_WINDOW_MS = 60_000;
const IP_LIMIT_NORMAL = 120;   // per minute for regular keys
const IP_LIMIT_MASTER = 300;   // per minute for master token
const MAX_IP_ENTRIES = 10_000; // #844: Cap tracked IPs to prevent memory exhaustion

function checkIpRateLimit(ip: string, isMaster: boolean): boolean {
  const now = Date.now();
  const cutoff = now - IP_WINDOW_MS;
  const bucket = ipRateLimits.get(ip) || { entries: [], start: 0 };
  // O(1) prune: advance start index past expired entries
  while (bucket.start < bucket.entries.length && bucket.entries[bucket.start]! < cutoff) {
    bucket.start++;
  }
  // Compact when the leading garbage exceeds 50% of the allocated array
  if (bucket.start > bucket.entries.length >>> 1) {
    bucket.entries = bucket.entries.slice(bucket.start);
    bucket.start = 0;
  }
  bucket.entries.push(now);
  ipRateLimits.set(ip, bucket);
  // #844: Evict oldest IPs when map exceeds cap to prevent unbounded memory growth
  if (ipRateLimits.size > MAX_IP_ENTRIES) {
    let oldestIp = '';
    let oldestTime = Infinity;
    for (const [trackedIp, trackedBucket] of ipRateLimits) {
      const lastTs = trackedBucket.entries[trackedBucket.entries.length - 1];
      if (lastTs !== undefined && lastTs < oldestTime) {
        oldestTime = lastTs;
        oldestIp = trackedIp;
      }
    }
    if (oldestIp) ipRateLimits.delete(oldestIp);
  }
  const activeCount = bucket.entries.length - bucket.start;
  const limit = isMaster ? IP_LIMIT_MASTER : IP_LIMIT_NORMAL;
  return activeCount > limit;
}

/** #357: Prune IPs whose timestamp arrays are entirely outside the rate-limit window. */
function pruneIpRateLimits(): void {
  const cutoff = Date.now() - IP_WINDOW_MS;
  for (const [ip, bucket] of ipRateLimits) {
    // All timestamps are old — remove the entry entirely
    const last = bucket.entries[bucket.entries.length - 1];
    if (bucket.entries.length - bucket.start === 0 || (last !== undefined && last < cutoff)) {
      ipRateLimits.delete(ip);
    }
  }
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
          // Issue #629: Validate hook secret from query param
          const hookSecret = (req.query as Record<string, string>)?.secret;
          if (!hookSecret || hookSecret !== session.hookSecret) {
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

    // If no auth configured (no master token, no keys), allow all
    if (!authManager.authEnabled) return;

    // #124/#125: Accept token from Authorization header; ?token= query param
    // only on SSE routes where EventSource cannot set headers.
    // #297: SSE routes also accept short-lived SSE tokens via ?token=.
    const isSSERoute = req.url?.includes('/events');
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

    // #297: Check if this is a short-lived SSE token first
    if (isSSERoute && token.startsWith('sse_')) {
      if (await authManager.validateSSEToken(token)) {
        return; // authenticated via short-lived SSE token
      }
      return reply.status(401).send({ error: 'Unauthorized — SSE token invalid or expired' });
    }

    const result = authManager.validate(token);

    if (!result.valid) {
      return reply.status(401).send({ error: 'Unauthorized — invalid API key' });
    }

    if (result.rateLimited) {
      return reply.status(429).send({ error: 'Rate limit exceeded — 100 req/min per key' });
    }

    // #583: Store keyId for batch rate limiting
    // #634: Store validated keyId for SSE token endpoint to reuse
    requestKeyMap.set(req.id, result.keyId ?? 'anonymous');
    (req as unknown as Record<string, unknown>).authKeyId = result.keyId;

    // #228: Per-IP rate limiting (applies to all authenticated requests)
    // #633: Only use req.ip — trustProxy controls whether X-Forwarded-For is considered
    const clientIp = req.ip ?? 'unknown';
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

// #226: Zod schema for session creation
const createSessionSchema = z.object({
  workDir: z.string().min(1),
  name: z.string().max(200).optional(),
  prompt: z.string().max(100_000).optional(),
  resumeSessionId: z.string().uuid().optional(),
  claudeCommand: z.string().max(10_000).optional(),
  env: z.record(z.string(), z.string()).optional(),
  stallThresholdMs: z.number().int().positive().max(3_600_000).optional(),
  permissionMode: z.enum(['default', 'bypassPermissions', 'plan', 'acceptEdits', 'dontAsk', 'auto']).optional(),
  autoApprove: z.boolean().optional(),
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
    uptime: process.uptime(),
    sessions: { active: activeCount, total: totalCount },
    tmux: tmuxHealth,
    timestamp: new Date().toISOString(),
  };
}
app.get('/v1/health', healthHandler);
app.get('/health', healthHandler);
app.post<{ Body: HandshakeRequest }>('/v1/handshake', async (req, reply) => {
  const { protocolVersion, clientCapabilities, clientVersion } = req.body ?? {};
  if (typeof protocolVersion !== 'string' || !protocolVersion.trim()) {
    return reply.status(400).send({ error: 'protocolVersion is required' });
  }
  if (clientCapabilities !== undefined && !Array.isArray(clientCapabilities)) {
    return reply.status(400).send({ error: 'clientCapabilities must be an array' });
  }
  const result = negotiate({ protocolVersion, clientCapabilities, clientVersion });
  return reply.status(result.compatible ? 200 : 409).send(result);
});

// Issue #81: Swarm awareness

// Issue #81: Swarm awareness — list all detected CC swarms and their teammates
app.get('/v1/swarm', async () => {
  const result = await swarmMonitor.scan();
  return result;
});

// API key management (Issue #39)
// Security: reject all auth key operations when auth is not enabled
app.post('/v1/auth/keys', async (req, reply) => {
  if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
  const parsed = authKeySchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
  const { name, rateLimit } = parsed.data;
  const result = await auth.createKey(name, rateLimit);
  return reply.status(201).send(result);
});

app.get('/v1/auth/keys', async (req, reply) => {
  if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
  return auth.listKeys();
});

app.delete<{ Params: { id: string } }>('/v1/auth/keys/:id', async (req, reply) => {
  if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
  const revoked = await auth.revokeKey(req.params.id);
  if (!revoked) return reply.status(404).send({ error: 'Key not found' });
  return { ok: true };
});

// #297: SSE token endpoint — generates short-lived, single-use token
// to avoid exposing long-lived bearer tokens in SSE URL query params.
// Issue #634: Reuse keyId from auth middleware result to avoid double-increment.
// of rate limit counter.
app.post('/v1/auth/sse-token', async (req, reply) => {
  // This route goes through the onRequest auth hook, so the caller is
  // already authenticated. Reuse stored keyId to avoid calling auth.validate() again.
  const storedKeyId = (req as unknown as Record<string, unknown>)?.authKeyId;
  const keyId = (typeof storedKeyId === 'string' ? storedKeyId : 'anonymous');

  try {
    const sseToken = await auth.generateSSEToken(keyId);
    return reply.status(201).send(sseToken);
  } catch (e: unknown) {
    return reply.status(429).send({ error: e instanceof Error ? e.message : 'SSE token limit reached' });
  }
});

// Global metrics (Issue #40)
app.get('/v1/metrics', async () => metrics.getGlobalMetrics(sessions.listSessions().length));

// Per-session metrics (Issue #40)
app.get<{ Params: { id: string } }>('/v1/sessions/:id/metrics', async (req, reply) => {
  const m = metrics.getSessionMetrics(req.params.id);
  if (!m) return reply.status(404).send({ error: 'No metrics for this session' });
  return m;
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
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

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

// List sessions (with pagination and status filter)
app.get<{
  Querystring: { page?: string; limit?: string; status?: string };
}>('/v1/sessions', async (req) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
  const statusFilter = req.query.status;

  let all = sessions.listSessions();
  if (statusFilter) {
    all = all.filter(s => s.status === statusFilter);
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
  const { workDir, name, prompt, resumeSessionId, claudeCommand, env, stallThresholdMs, permissionMode, autoApprove } = parsed.data;
  if (!workDir) return reply.status(400).send({ error: 'workDir is required' });
  const safeWorkDir = await validateWorkDirWithConfig(workDir);
  if (typeof safeWorkDir === 'object') return reply.status(400).send({ error: safeWorkDir.error, code: safeWorkDir.code });

  // Issue #607: Check for an existing idle session with the same workDir
  const existing = await sessions.findIdleSessionByWorkDir(safeWorkDir);
  if (existing) {
    try {
      // Send prompt to the existing session if provided
      let promptDelivery: { delivered: boolean; attempts: number } | undefined;
      if (prompt) {
        promptDelivery = await sessions.sendInitialPrompt(existing.id, prompt);
        metrics.promptSent(promptDelivery.delivered);
      }
      return reply.status(200).send({ ...existing, reused: true, promptDelivery });
    } finally {
      sessions.releaseSessionClaim(existing.id);
    }
  }

  console.time("POST_CREATE_SESSION");
  const session = await sessions.createSession({ workDir: safeWorkDir, name, resumeSessionId, claudeCommand, env, stallThresholdMs, permissionMode, autoApprove });
  console.timeEnd("POST_CREATE_SESSION"); console.time("POST_CHANNEL_CREATED");

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
    promptDelivery = await sessions.sendInitialPrompt(session.id, prompt);
    console.timeEnd("POST_SEND_INITIAL_PROMPT");
    metrics.promptSent(promptDelivery.delivered);
  } else {
    console.timeEnd("POST_SEND_INITIAL_PROMPT");
  }

  return reply.status(201).send({ ...session, promptDelivery });
}
app.post('/v1/sessions', createSessionHandler);
app.post('/sessions', createSessionHandler);

// Get session (Issue #20: includes actionHints for interactive states)
async function getSessionHandler(req: IdRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });
  return addActionHints(session, sessions);
}
app.get<IdParams>('/v1/sessions/:id', getSessionHandler);
app.get<IdParams>('/sessions/:id', getSessionHandler);

// #128: Bulk health check — returns health for all sessions in one request
app.get('/v1/sessions/health', async () => {
  const allSessions = sessions.listSessions();
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
  await Promise.all(allSessions.map(async (s) => {
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
  const { text } = parsed.data;
  try {
    const result = await sessions.sendMessage(req.params.id, text);
    await channels.message({
      event: 'message.user',
      timestamp: new Date().toISOString(),
      session: { id: req.params.id, name: '', workDir: '' },
      detail: text,
    });
    return { ok: true, delivered: result.delivered, attempts: result.attempts };
  } catch (e: unknown) {
    return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
  }
}
app.post<IdParams>('/v1/sessions/:id/send', sendMessageHandler);
app.post<IdParams>('/sessions/:id/send', sendMessageHandler);

// Read messages
async function readMessagesHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
  try {
    return await sessions.readMessages(req.params.id);
  } catch (e: unknown) {
    return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
  }
}
app.get<IdParams>('/v1/sessions/:id/read', readMessagesHandler);
app.get<IdParams>('/sessions/:id/read', readMessagesHandler);

function makePermissionHandler(
  action: 'approve' | 'reject'
): (req: IdRequest, reply: FastifyReply) => Promise<unknown> {
  return async (req: IdRequest, reply: FastifyReply): Promise<unknown> => {
    try {
      const op = action === 'approve' ? sessions.approve.bind(sessions) : sessions.reject.bind(sessions);
      await op(req.params.id);
      // Issue #87: Record permission response latency
      const lat = sessions.getLatencyMetrics(req.params.id);
      if (lat !== null && lat.permission_response_ms !== null) {
        metrics.recordPermissionResponse(req.params.id, lat.permission_response_ms);
      }
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  };
}

const approveHandler = makePermissionHandler('approve');
const rejectHandler = makePermissionHandler('reject');

app.post<IdParams>('/v1/sessions/:id/reject', rejectHandler);
app.post<IdParams>('/sessions/:id/reject', rejectHandler);
app.post<IdParams>('/v1/sessions/:id/approve', approveHandler);
app.post<IdParams>('/sessions/:id/approve', approveHandler);

// Issue #336: Answer pending AskUserQuestion
app.post<{
  Params: { id: string };
  Body: { questionId?: string; answer?: string };
}>('/v1/sessions/:id/answer', async (req, reply) => {
  const { questionId, answer } = req.body || {};
  if (!questionId || answer === undefined || answer === null) {
    return reply.status(400).send({ error: 'questionId and answer are required' });
  }
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });
  const resolved = sessions.submitAnswer(req.params.id, questionId, answer);
  if (!resolved) {
    return reply.status(409).send({ error: 'No pending question matching this questionId' });
  }
  return { ok: true };
});

// Escape
async function escapeHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
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
  if (!sessions.getSession(req.params.id)) {
    return reply.status(404).send({ error: 'Session not found' });
  }
  try {
    // #842: killSession first, then notify — avoids race where channels
    // reference a session that is still being destroyed.
    await sessions.killSession(req.params.id);
    eventBus.emitEnded(req.params.id, 'killed');
    await channels.sessionEnded(makePayload('session.ended', req.params.id, 'killed'));
    monitor.removeSession(req.params.id);
    metrics.cleanupSession(req.params.id);
    return { ok: true };
  } catch (e: unknown) {
    return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
  }
}
app.delete<IdParams>('/v1/sessions/:id', killSessionHandler);
app.delete<IdParams>('/sessions/:id', killSessionHandler);

// Capture raw pane
async function capturePaneHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });
  const pane = await tmux.capturePane(session.windowId);
  return { pane };
}
app.get<IdParams>('/v1/sessions/:id/pane', capturePaneHandler);
app.get<IdParams>('/sessions/:id/pane', capturePaneHandler);

// Slash command
async function commandHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
  const parsed = commandSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
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

  // Validate session exists
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

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
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

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
  const session = sessions.getSession(req.params.id);
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
  const session = sessions.getSession(req.params.id);
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
  }
  const result = await pipelines.batchCreate(specs);
  return reply.status(201).send(result);
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
        monitor.removeSession(session.id);
        metrics.cleanupSession(session.id);
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
      monitor.removeSession(session.id);
      eventBus.cleanupSession(session.id);
      await sessions.killSession(session.id);
      metrics.cleanupSession(session.id);
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
    }));
  }

  // Webhooks (optional)
  if (cfg.webhooks.length > 0) {
    const webhookChannel = new WebhookChannel({
      endpoints: cfg.webhooks.map(url => ({ url })),
    });
    channels.register(webhookChannel);
  }
}

// ── PID file (peer Aegis detection) ───────────────────────────────────

let pidFilePath = '';

function writePidFile(): void {
  try {
    pidFilePath = path.join(config.stateDir, 'aegis.pid');
    writeFileSync(pidFilePath, String(process.pid));
  } catch { /* non-critical */ }
}


function readPidFile(): number | null {
  try {
    const p = path.join(config.stateDir, 'aegis.pid');
    const content = readFileSync(p, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch { /* pid file missing or unreadable */
    return null;
  }
}

// ── Port conflict recovery (Issue #99, #162) ──────────────────────────

/**
 * Check if a PID exists using `process.kill(pid, 0)`.
 */
function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch { /* ESRCH — process does not exist */
    return false;
  }
}

/**
 * Read the parent PID from /proc/<pid>/status.
 * Uses the PPid line instead of parsing /proc/<pid>/stat,
 * which breaks when the comm field (process name) contains spaces.
 */
export function readPpid(pid: number): number {
  const status = readFileSync(`/proc/${pid}/status`, 'utf-8');
  const match = status.match(/^PPid:\s+(\d+)/m);
  if (!match) throw new Error(`no PPid line in /proc/${pid}/status`);
  return parseInt(match[1], 10);
}

/**
 * Check if a PID is an ancestor of the current process.
 */
function isAncestorPid(pid: number): boolean {
  try {
    let current = process.ppid;
    for (let depth = 0; depth < 10 && current > 1; depth++) {
      if (current === pid) return true;
      try {
        current = readPpid(current);
      } catch { /* /proc unavailable or process gone — stop walking */
        break;
      }
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Wait for a port to be released with exponential backoff.
 */
async function waitForPortRelease(port: number, maxWaitMs = 5_000): Promise<void> {
  const net = await import('node:net');
  const start = Date.now();
  let delay = 200;

  while (Date.now() - start < maxWaitMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const sock = net.createServer();
        sock.once('error', reject);
        sock.listen(port, '127.0.0.1', () => {
          sock.close();
          reject(new Error('port free')); // signal success
        });
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'port free') return;
    }
    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 1_000);
  }
}

/**
 * Kill stale process holding a port. Returns true if a process was killed.
 * Uses `lsof` to find the PID, verifies it exists, skips ancestors,
 * and tries SIGTERM before SIGKILL.
 */
async function killStalePortHolder(port: number): Promise<boolean> {
  // Small random delay to reduce race window with systemd restarts
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 400));

  try {
    const output = execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf-8', timeout: 5_000 }).trim();
    if (!output) return false;

    const pids = output.split('\n').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (pids.length === 0) return false;

    let killed = false;

    for (const pid of pids) {
      // Skip own PID
      if (pid === process.pid) continue;

      // Skip ancestors to avoid killing parent process (e.g. systemd supervisor)
      if (isAncestorPid(pid)) {
        console.warn(`EADDRINUSE recovery: skipping ancestor PID ${pid} on port ${port}`);
        continue;
      }

      // Skip peer Aegis instance (another Aegis process that wrote the PID file)
      const pidFilePid = readPidFile();
      if (pidFilePid !== null && pid === pidFilePid && pid !== process.pid) {
        console.warn(`EADDRINUSE recovery: skipping peer Aegis PID ${pid} (PID file match) on port ${port}`);
        continue;
      }

      // Verify PID exists before attempting to kill
      if (!pidExists(pid)) continue;

      console.warn(`EADDRINUSE recovery: killing stale process PID ${pid} on port ${port}`);

      // Try SIGTERM first for graceful shutdown
      try {
        process.kill(pid, 'SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 2_000));

        // Check if process exited after SIGTERM
        if (!pidExists(pid)) {
          killed = true;
          continue;
        }
      } catch { /* process may have already exited */ }

      // Fallback to SIGKILL if SIGTERM didn't work
      try {
        process.kill(pid, 'SIGKILL');
        killed = true;
      } catch { /* already dead */ }
    }

    if (killed) {
      await waitForPortRelease(port);
    }

    return killed;
  } catch {
    // lsof not found or no process on port — that's fine
    return false;
  }
}

/**
 * Listen with EADDRINUSE recovery: if port is taken, kill the stale holder and retry once.
 */
async function listenWithRetry(
  app: ReturnType<typeof Fastify>,
  port: number,
  host: string,
  maxRetries = 1,
): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await app.listen({ port, host });
      return;
    } catch (err: unknown) {
      if (!(err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EADDRINUSE') || attempt >= maxRetries) {
        throw err;
      }
      console.error(`EADDRINUSE on port ${port} — attempting recovery (attempt ${attempt + 1}/${maxRetries})`);
      const killed = await killStalePortHolder(port);
      if (!killed) {
        console.error(`EADDRINUSE recovery failed: no stale process found on port ${port}`);
        throw err;
      }
    }
  }
}

async function main(): Promise<void> {
  // Load configuration
  config = await loadConfig();

  // Initialize core components with config
  tmux = new TmuxManager(config.tmuxSession);
  sessions = new SessionManager(tmux, config);
  sseLimiter = new SSEConnectionLimiter({ maxConnections: config.sseMaxConnections, maxPerIp: config.sseMaxPerIp });
  monitor = new SessionMonitor(sessions, channels, { ...DEFAULT_MONITOR_CONFIG, pollIntervalMs: 5000 });

  // Register channels
  registerChannels(config);

  // Setup auth (Issue #39: multi-key + backward compat)
  const { join } = await import('node:path');
  auth = new AuthManager(join(config.stateDir, 'keys.json'), config.authToken);
  await auth.load();
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

  // Issue #84: Wire JSONL watcher for fs.watch-based message detection
  jsonlWatcher = new JsonlWatcher();
  monitor.setJsonlWatcher(jsonlWatcher);

  // Start watching JSONL files for already-discovered sessions
  for (const session of sessions.listSessions()) {
    if (session.jsonlPath) {
      jsonlWatcher.watch(session.id, session.jsonlPath, session.monitorOffset);
    }
  }

  // Register HTTP hook receiver (Issue #169, Issue #87: pass metrics for latency tracking)
  registerHookRoutes(app, { sessions, eventBus, metrics });

  // Initialize pipeline manager (Issue #36)
  pipelines = new PipelineManager(sessions, eventBus);

  // Initialize batch rate limiter (Issue #583)

  // Initialize metrics (Issue #40)
  metrics = new MetricsCollector(join(config.stateDir, 'metrics.json'));
  await metrics.load();

  // Issue #361: Store interval refs so graceful shutdown can clear them
  const reaperInterval = setInterval(() => reapStaleSessions(config.maxSessionAgeMs), config.reaperIntervalMs);
  const zombieReaperInterval = setInterval(() => reapZombieSessions(), ZOMBIE_REAP_INTERVAL_MS);
  const metricsSaveInterval = setInterval(() => { void metrics.save(); }, 5 * 60 * 1000);
  // #357: Prune stale IP rate-limit entries every minute
  const ipPruneInterval = setInterval(pruneIpRateLimits, 60_000);
  // #398: Sweep stale API key rate limit buckets every 5 minutes
  const authSweepInterval = setInterval(() => auth.sweepStaleRateLimits(), 5 * 60_000);

  // Issue #361: Graceful shutdown handler
  // Issue #415: Reentrance guard at handler level prevents double execution on rapid SIGINT
  let shuttingDown = false;
  async function gracefulShutdown(signal: string): Promise<void> {
    console.log(`${signal} received, shutting down gracefully...`);

    // 1. Stop accepting new requests
    try { await app.close(); } catch (e) { console.error('Error closing server:', e); }

    // 2. Stop background monitors and intervals
    monitor.stop();
    swarmMonitor.stop();
    clearInterval(reaperInterval);
    clearInterval(zombieReaperInterval);
    clearInterval(metricsSaveInterval);
    clearInterval(ipPruneInterval);
    clearInterval(authSweepInterval);

    // Issue #569: Kill all CC sessions and tmux windows before exit
    try { await killAllSessions(sessions, tmux); } catch (e) { console.error('Error killing sessions:', e); }

    // 3. Destroy channels (awaits Telegram poll loop)
    try { await channels.destroy(); } catch (e) { console.error('Error destroying channels:', e); }

    // 4. Save session state
    try { await sessions.save(); } catch (e) { console.error('Error saving sessions:', e); }

    // 5. Save metrics
    try { await metrics.save(); } catch (e) { console.error('Error saving metrics:', e); }

    // 6. Cleanup PID file
    try { if (pidFilePath) { unlinkSync(pidFilePath); } } catch { /* non-critical */ }

    console.log('Graceful shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => { if (!shuttingDown) { shuttingDown = true; void gracefulShutdown('SIGTERM'); } });
  process.on('SIGINT', () => { if (!shuttingDown) { shuttingDown = true; void gracefulShutdown('SIGINT'); } });
  process.on('unhandledRejection', (reason) => {
    console.error('unhandledRejection:', reason);
  });

  // Start monitor
  monitor.start();

  // Issue #81: Start swarm monitor for agent swarm awareness
  swarmMonitor = new SwarmMonitor(sessions);
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
      channels.swarmEvent(makePayload('swarm.teammate_spawned', parentId, detail, {
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
      channels.swarmEvent(makePayload('swarm.teammate_finished', parentId, detail, {
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
  await listenWithRetry(app, config.port, config.host);
  writePidFile();
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
