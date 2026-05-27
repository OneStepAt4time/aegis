/**
 * server.ts — HTTP API server for Aegis.
 *
 * Exposes RESTful endpoints for creating, managing, and interacting
 * with Claude Code sessions via ACP.
 *
 * Notification channels (Telegram, webhooks, etc.) are pluggable —
 * the server doesn't know which channels are active.
 */

import { StructuredLogger } from './logger.js';
const log = new StructuredLogger();

import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import fs from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { loadConfig, reloadAllowedWorkDirs, findConfigFilePath, SYSTEM_TENANT, type Config } from './config.js';
import type { StateStore } from './services/state/state-store.js';

import { parseIntSafe } from './validation.js';
import { SessionEventBus } from './events.js';

import { SSEConnectionLimiter } from './sse-limiter.js';
import { PipelineManager } from './pipeline.js';
import { ToolRegistry } from './tool-registry.js';
import {
  AuthManager,
  type ApiKeyPermission,
  type ApiKeyRole,
} from './services/auth/index.js';
import { AuditLogger } from './audit.js';
import { MetricsCollector } from './metrics.js';

import { registerHookRoutes } from './hooks.js';
import { registerDashboardStatic } from './plugins/dashboard-static.js';

import { registerMemoryRoutes } from './memory-routes.js';

import { logger, setStructuredLogSink, isJsonLogsEnabled } from './logger.js';
import { initTracing, loadTracingConfig } from './tracing.js';
import { MemoryBridge } from './memory-bridge.js';
import { cleanupTerminatedSessionState, shutdownAcpRuntime } from './session-cleanup.js';
import { MeteringService } from './metering.js';
import { MetricsCache, JsonFileBackend } from './services/metrics-cache.js';
import { normalizeApiErrorPayload } from './api-error-envelope.js';
import { listenWithRetry, writePidFile } from './startup.js';
import { AlertManager } from './alerting.js';

import { ServiceContainer } from './container.js';
import type { AppContext } from './app-context.js';
import { setupAuth, pruneAuthFailLimits, pruneIpRateLimits, requestKeyMap } from './middleware/auth-setup.js';
import { TimerRegistry } from './utils/timer-registry.js';
import { AcpBackend } from './services/acp/backend.js';
import { ActionSweeper, resolveSweeperConfig } from './services/acp/action-sweeper.js';
import { bootAcp, registerAcpServices } from './boot/boot-acp.js';
import { bootMetering } from './boot/boot-metering.js';
import { registerShutdownHandler } from './boot/boot-shutdown.js';
import { registerRoutes } from './boot/boot-routes.js';
import { registerCoreServices } from './boot/boot-services.js';
import { makePayload as makePayloadFromCtx } from './routes/context.js';
import { BudgetStore } from './budgets/store.js';
import { BudgetEvaluator } from './budgets/evaluator.js';
import { BudgetNotifier } from './budgets/notifications.js';
import { BudgetTimer } from './budgets/timer.js';
import {
  createDashboardOidcManagerFromEnv,
  DashboardSessionStore,
  type DashboardOIDCManager,
} from './services/auth/OIDCManager.js';

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

// Issue #4241: All mutable state is now in AppContext, created in main().
// Module-level const values are still initialized here.
const channels = new ChannelManager();
const eventBus = new SessionEventBus();
// Issue #4248: Centralized timer registry for clean shutdown
const timers = new TimerRegistry();
// Issue #4116: Debounce Set for session approval callbacks (prevents duplicate notifications from rapid Telegram clicks).
const recentApprovalActions = new Set<string>();

// ── Inbound command handler ─────────────────────────────────────────

async function handleInbound(cmd: InboundCommand, ctx: AppContext): Promise<void> {
  try {
    switch (cmd.action) {
      case 'approve':
        await ctx.sessions.approve(cmd.sessionId);
        break;
      case 'reject':
        await ctx.sessions.reject(cmd.sessionId);
        break;
      case 'escape':
        await ctx.sessions.escape(cmd.sessionId);
        break;
      case 'kill':
        // #842: killSession first, then notify — avoids race where channels
        // reference a session that is still being destroyed.
        // #4294: Shut down ACP runtime before killing session metadata.
        await shutdownAcpRuntime(cmd.sessionId, ctx);
        await ctx.sessions.killSession(cmd.sessionId);
        channels.sessionEnded(makePayloadFromCtx(ctx.sessions, 'session.ended', cmd.sessionId, 'killed'));
        cleanupTerminatedSessionState(cmd.sessionId, { monitor: ctx.monitor, metrics: ctx.metrics, toolRegistry: ctx.toolRegistry });
        break;
      case 'session_approve': {
        // Issue #4116: Debounce — skip if this session was already processed recently.
        if (recentApprovalActions.has(cmd.sessionId)) break;
        recentApprovalActions.add(cmd.sessionId);
        setTimeout(() => recentApprovalActions.delete(cmd.sessionId), 2000);
        // Issue #4117: Include actor info (Telegram user) in approvedBy.
        const approveActor = cmd.actor?.type === 'telegram'
          ? `telegram:${cmd.actor.userId} (${cmd.actor.firstName})`
          : 'telegram';
        // Issue #4092: Wrap in try/catch — stale Telegram callbacks (e.g. user taps
        // Approve after session was already approved via API) should not crash callback processing.
        try {
          await ctx.sessions.approveSession(cmd.sessionId, approveActor);
          channels.statusChange({
            event: 'session.approved',
            timestamp: new Date().toISOString(),
            session: { id: cmd.sessionId, name: '', workDir: '', runnerName: undefined },
            detail: `Session approved by ${approveActor}`,
          });
        } catch (e) {
          logger.error({ component: 'server', operation: 'session_approve', sessionId: cmd.sessionId, attributes: { error: String(e) } });
        }
        break;
      }
      case 'session_reject': {
        // Issue #4116: Debounce — skip if this session was already processed recently.
        if (recentApprovalActions.has(cmd.sessionId)) break;
        recentApprovalActions.add(cmd.sessionId);
        setTimeout(() => recentApprovalActions.delete(cmd.sessionId), 2000);
        // Issue #4117: Include actor info in rejection log.
        const rejectActor = cmd.actor?.type === 'telegram'
          ? `telegram:${cmd.actor.userId} (${cmd.actor.firstName})`
          : 'telegram';
        try {
          await ctx.sessions.rejectSession(cmd.sessionId);
          channels.statusChange({
            event: 'session.rejected',
            timestamp: new Date().toISOString(),
            session: { id: cmd.sessionId, name: '', workDir: '', runnerName: undefined },
            detail: `Session rejected by ${rejectActor}`,
          });
        } catch (e) {
          logger.error({ component: 'server', operation: 'session_reject', sessionId: cmd.sessionId, attributes: { error: String(e) } });
        }
        break;
      }
      case 'message':
      case 'command':
        if (cmd.text) await ctx.sessions.sendMessage(cmd.sessionId, cmd.text);
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
  // Issue #3500: Full pino logs when --json-logs set; error-only otherwise so app.log.error still works
  logger: isJsonLogsEnabled() ? {
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
  } : { level: "error" },
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

// Route handlers are registered in main() via route modules (src/routes/*).

// ── Session Reaper ──────────────────────────────────────────────────

async function reapStaleSessions(maxAgeMs: number, ctx: AppContext): Promise<void> {
  const now = Date.now();
  // Snapshot list before iterating — killSession() modifies the sessions map
  const snapshot = [...ctx.sessions.listSessions()];
  for (const session of snapshot) {
    // Guard: session may have been deleted by DELETE handler between snapshot and here
    if (!ctx.sessions.getSession(session.id)) continue;
    // Issue #4027: Skip pinned sessions — user explicitly wants them alive.
    if (session.isPinned) continue;
    const age = now - session.createdAt;
    if (age > maxAgeMs) {
      const ageMin = Math.round(age / 60000);
      logger.info({
        component: 'server',
        operation: 'reap_stale_sessions',
        sessionId: session.id,
        attributes: {
          displayName: session.displayName,
          ageMinutes: ageMin,
        },
      });
      try {
        // #842: killSession first, then notify — avoids race where channels
        // reference a session that is still being destroyed.
        // #4294: Shut down ACP runtime before killing session metadata.
        await shutdownAcpRuntime(session.id, ctx);
        await ctx.sessions.killSession(session.id);
        eventBus.cleanupSession(session.id);
        channels.sessionEnded({
          event: 'session.ended',
          timestamp: new Date().toISOString(),
          session: { id: session.id, name: session.displayName, workDir: session.workDir },
          detail: `Auto-killed: exceeded ${maxAgeMs / 3600000}h time limit`,
        });
        cleanupTerminatedSessionState(session.id, { monitor: ctx.monitor, metrics: ctx.metrics, toolRegistry: ctx.toolRegistry });
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

async function reapZombieSessions(ctx: AppContext): Promise<void> {
  const now = Date.now();
  // Snapshot list before iterating — killSession() modifies the sessions map
  const snapshot = [...ctx.sessions.listSessions()];
  for (const session of snapshot) {
    // Guard: session may have been deleted between snapshot and here
    if (!ctx.sessions.getSession(session.id)) continue;
    // Issue #4027: Skip pinned sessions — user explicitly wants them alive.
    if (session.isPinned) continue;
    if (!session.lastDeadAt) continue;
    const deadDuration = now - session.lastDeadAt;
    if (deadDuration < ZOMBIE_REAP_DELAY_MS) continue;

    logger.info({
      component: 'server',
      operation: 'reap_zombie_sessions',
      sessionId: session.id,
      attributes: {
        displayName: session.displayName,
      },
    });
    try {
      eventBus.cleanupSession(session.id);
      // #4294: Shut down ACP runtime before killing session metadata.
      await shutdownAcpRuntime(session.id, ctx);
      await ctx.sessions.killSession(session.id);
      // Issue #2947: mark zombie-reaped sessions as infra failures
      ctx.metrics.sessionInfraFailed(session.id);
      cleanupTerminatedSessionState(session.id, { monitor: ctx.monitor, metrics: ctx.metrics, toolRegistry: ctx.toolRegistry });
      channels.sessionEnded({
        event: 'session.ended',
        timestamp: new Date().toISOString(),
        session: { id: session.id, name: session.displayName, workDir: session.workDir },
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
      verbose: cfg.tgVerbose,
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

/** Debounce timer for config file change events. Moved to AppContext. */

/** Set up fs.watch on the active config file and a SIGHUP handler for manual reload.
 *  Only allowedWorkDirs is hot-reloaded — other config changes still require a restart. */
// watchedConfigPath moved to AppContext

function setupConfigWatcher(ctx: AppContext): void {
  const configPath = findConfigFilePath();
  if (!configPath) return; // No config file to watch
  ctx.watchedConfigPath = configPath;

  // SIGHUP handler for manual reload
  process.on('SIGHUP', () => {
    void handleConfigReload('SIGHUP', ctx);
  });

  // fs.watch for automatic detection
  try {
    ctx.configWatcher = watch(configPath, (_eventType) => {
      // Accept all event types — editors emit rename (atomic save), change, or undefined.
      // Debounce: FS events can fire multiple times for one save
        if (ctx.configReloadTimer) timers.clearTimeout(ctx.configReloadTimer);
        ctx.configReloadTimer = timers.setTimeout(() => {
          void handleConfigReload('file-change', ctx);
        }, 300);
    });
    ctx.configWatcher.on('error', () => {
      // Watcher failed (file deleted, permissions) — disable gracefully
      ctx.configWatcher?.close();
      ctx.configWatcher = null;
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
async function handleConfigReload(source: string, ctx: AppContext): Promise<void> {
  try {
    const newDirs = await reloadAllowedWorkDirs(ctx.watchedConfigPath ?? undefined);
    if (newDirs === null) return; // Config file gone/invalid
    const oldDirs = ctx.config.allowedWorkDirs;
    const changed = newDirs.length !== oldDirs.length
      || newDirs.some((d, i) => d !== oldDirs[i]);
    if (changed) {
      ctx.config.allowedWorkDirs = newDirs;
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
  // Issue #4241: Single context object replaces all module-level mutable globals
  const ctx = {} as AppContext;
  // Load configuration
  ctx.config = await loadConfig();
  ctx.dashboardTokenSessions = new DashboardSessionStore();
  ctx.dashboardOidc = await createDashboardOidcManagerFromEnv(ctx.config);

  // Initialize OpenTelemetry tracing before any instrumented modules load.
  // Must be called before Fastify starts so auto-instrumentation can patch HTTP.
  await initTracing(loadTracingConfig());

  // Issue #1753: Watch config file for changes and hot-reload allowedWorkDirs
  setupConfigWatcher(ctx);

  // Initialize core components with config

  // Issue #1937: Create pluggable session store based on config.
  const { createStateStore } = await import('./services/state/store-factory.js');
  ctx.sessionStore = await createStateStore(ctx.config);
  await ctx.sessionStore.start();

  ctx.sessions = new SessionManager(ctx.config, ctx.sessionStore);
  // Issue #4092: Wire recovery callback for stuck awaiting_approval sessions.
ctx.sessions.onSessionApprovalRecovery = (session) => {
    channels.statusChange({
      event: 'session.awaiting_approval',
      timestamp: new Date().toISOString(),
      session: { id: session.id, name: session.displayName ?? '', workDir: session.workDir },
      detail: `Session still awaiting approval after restart: ${session.displayName ?? session.id}`,
    });
  };

  // Issue #2607 / ACP-064: Initialize ACP via extracted boot module
  await bootAcp(ctx);

  const container = new ServiceContainer();
  // #1644: Derive hook-secret encryption key from master auth token (non-empty only)
  // #3340: Also check clientAuthToken
const encryptionKey = ctx.config.authToken || ctx.config.clientAuthToken;
  if (encryptionKey) {
    ctx.sessions.setEncryptionKey(encryptionKey);
  }

  // Issue #3143: Wire ACP event store into session transcript reader
  ctx.sessions.setAcpEventStore(ctx.acpLocalProfile!.eventStore);

  // Issue #4004: Orphan action sweeper — recovers stale leased actions
  const sweeperConfig = resolveSweeperConfig();
  if (sweeperConfig.enabled) {
  ctx.actionSweeper = new ActionSweeper(ctx.acpLocalProfile!.actionQueue, sweeperConfig, {
      onRecovered: (actions) => {
        logger.info({
          component: 'server',
          operation: 'action_sweeper_recovered',
          attributes: { count: actions.length, actionIds: actions.map(a => a.actionId) },
        });
      },
      onError: (err) => {
        logger.error({
          component: 'server',
          operation: 'action_sweeper_error',
          errorCode: 'ACTION_SWEEPER_ERROR',
          attributes: { error: err instanceof Error ? err.message : String(err) },
        });
      },
    });
  }

  // Memory bridge (Issue #783)
if (ctx.config.memoryBridge?.enabled) {
const persistPath = ctx.config.memoryBridge.persistPath ?? path.join(ctx.config.stateDir, 'memory.json');
ctx.memoryBridge = new MemoryBridge(persistPath, ctx.config.memoryBridge.reaperIntervalMs);
await ctx.memoryBridge!.load();
ctx.memoryBridge!.startReaper();
registerMemoryRoutes(app, ctx.memoryBridge!);
    logger.info({
      component: 'server',
      operation: 'memory_bridge_enabled',
      attributes: { persistPath },
    });
  }

  ctx.sseLimiter = new SSEConnectionLimiter({ maxConnections: ctx.config.sseMaxConnections, maxPerIp: ctx.config.sseMaxPerIp });
  ctx.monitor = new SessionMonitor(ctx.sessions, channels, { ...DEFAULT_MONITOR_CONFIG, pollIntervalMs: 5000 });

  // Register channels
registerChannels(ctx.config);

  // Setup auth (Issue #39: multi-key + backward compat)
  // #3340: Fall back to clientAuthToken when authToken is not set
  const masterToken = ctx.config.authToken || ctx.config.clientAuthToken || undefined;
  ctx.auth = new AuthManager(path.join(ctx.config.stateDir, 'keys.json'), masterToken, ctx.config.defaultTenantId);
ctx.auth.setHost(ctx.config.host);  // #1080: needed for auth bypass security check

  // #1419: Initialize audit logger and wire into auth
  ctx.auditLogger = new AuditLogger(path.join(ctx.config.stateDir, 'audit'));
await ctx.auditLogger!.init();
ctx.auth.setAuditLogger(ctx.auditLogger!);

  // Issue #1418: Initialize production alerting
  ctx.alertManager = new AlertManager({ ...ctx.config.alerting, hookTimeoutMs: ctx.config.hookTimeoutMs });
  if (ctx.config.alerting.webhooks.length > 0) {
    logger.info({
      component: 'server',
      operation: 'alerting_enabled',
      attributes: {
        webhooks: ctx.config.alerting.webhooks.length,
        failureThreshold: ctx.config.alerting.failureThreshold,
      },
    });
  }

  // Wire monitor dependencies before lifecycle startup.
  ctx.monitor.setEventBus(eventBus);
  ctx.monitor.setAlertManager(ctx.alertManager);
  ctx.jsonlWatcher = new JsonlWatcher();
  ctx.monitor.setMetrics(ctx.metrics);
  // Issue #3754: Wire ACP backend for rate-limit retry support
if (ctx.acpBackend) ctx.monitor.setAcpBackend(ctx.acpBackend);
  ctx.monitor.setJsonlWatcher(ctx.jsonlWatcher);
registerCoreServices(container, { ctx, channels, handleInbound: (cmd) => handleInbound(cmd, ctx) });
  registerAcpServices(container, ctx);

setupAuth(app, ctx);

  // Register WebSocket plugin for live terminal streaming (Issue #108)
  await app.register(fastifyWebsocket);

  // #217: CORS configuration — restrictive by default
  // #413: Reject wildcard CORS_ORIGIN — * is insecure and allows any origin
  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin === '*') {
    throw new Error('CORS_ORIGIN=* wildcard is not allowed. Specify explicit origins (comma-separated) or leave unset to disable CORS.');
  }
  // Issue #4356: Use a callback instead of `false` so the CORS plugin still
  // registers its OPTIONS handler. With `origin: false` the plugin is a no-op
  // and OPTIONS requests fall through to route matching → 404.
  await app.register(fastifyCors, {
    origin: corsOrigin
      ? corsOrigin.split(',').map(s => s.trim())
      : ((origin: string | undefined, callback: (err: Error | null, allow: boolean) => void) => {
          callback(null, false);
        }),
  });
await container.start(['sessionManager', 'sessionMonitor', 'authManager', 'channelManager', 'acpLocalProfile', 'acpBackend']);

  // Issue #3264: Initialize MeteringService for persistent cost tracking.
  ctx.metering = new MeteringService(eventBus, (sid) => ctx.sessions.getSession(sid)?.ownerKeyId, path.join(ctx.config.stateDir, 'metering.jsonl'));
  await bootMetering(ctx, ctx.metering, eventBus);

  // Issue #4195: Cost Alerts — budget store, evaluator, notifier, timer.
  const budgetStore = new BudgetStore(ctx.config.stateDir);
  const budgetNotifier = new BudgetNotifier({ telegramBotToken: ctx.config.tgBotToken || undefined });
  const budgetEvaluator = new BudgetEvaluator(budgetStore, ctx.metering, budgetNotifier);
  const budgetTimer = new BudgetTimer(budgetEvaluator, budgetStore);
  // Register HTTP hook receiver (Issue #169, Issue #87: pass metrics for latency tracking)
registerHookRoutes(app, { sessions: ctx.sessions, eventBus, metrics: ctx.metrics, hookSecretHeaderOnly: ctx.config.hookSecretHeaderOnly });

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
ctx.pipelines = new PipelineManager(ctx.sessions, eventBus, ctx.sessionStore, ctx.config.pipelineStageTimeoutMs);
await ctx.pipelines.hydrate();

  // Initialize batch rate limiter (Issue #583)

  // Initialize metrics (Issue #40)
ctx.metrics = new MetricsCollector(path.join(ctx.config.stateDir, 'metrics.json'));
await ctx.metrics.load();

  // Issue #2250: Initialize analytics cache with JSON file persistence
const metricsCache = new MetricsCache(
    ctx.sessions,
    ctx.metrics,
    ctx.auth,
new JsonFileBackend(path.join(ctx.config.stateDir, 'analytics-cache.json')),
    eventBus,
  );
  await metricsCache.start();

  // ── Register routes (extracted to boot/boot-routes.ts, #4243) ──────
  ctx.toolRegistry = new ToolRegistry();
  const { routeCtx, serverState } = registerRoutes(app, ctx, {
    eventBus,
    channels,
    metricsCache,
    budgetStore,
    budgetEvaluator,
    requestKeyMap,
  });

  // Issue #361: Store interval refs so graceful shutdown can clear them
  timers.setInterval(() => reapStaleSessions(ctx.config.maxSessionAgeMs, ctx), ctx.config.reaperIntervalMs);
  timers.setInterval(() => reapZombieSessions(ctx), ZOMBIE_REAP_INTERVAL_MS);
  // Issue #4294: ACP orphan reaper — detects and shuts down ACP runtimes
  // whose sessions no longer exist in the session manager.
  const ACP_ORPHAN_REAP_INTERVAL_MS = parseIntSafe(process.env.ACP_ORPHAN_REAP_INTERVAL_MS, 60_000);
  timers.setInterval(async () => {
    if (!ctx.acpBackend) return;
    const { reapOrphanAcpRuntimes } = await import('./services/acp/orphan-reaper.js');
    await reapOrphanAcpRuntimes({
      getActiveSessionIds: () => ctx.sessions.listSessions().map(s => s.id),
      getActiveAcpRuntimeIds: () => ctx.acpBackend!.getActiveRuntimeIds(),
      shutdownAcpRuntime: (id) => ctx.acpBackend!.shutdownSession({
        sessionId: id,
        tenantId: ctx.sessions.getSession(id)?.tenantId ?? SYSTEM_TENANT,
        ownerKeyId: ctx.sessions.getSession(id)?.ownerKeyId ?? 'master',
      }).then(() => {}),
      log: logger,
    });
  }, ACP_ORPHAN_REAP_INTERVAL_MS);
timers.setInterval(() => { void ctx.metrics.save(); }, 5 * 60 * 1000);
  // Issue #3310: Periodically persist metering data.
  timers.setInterval(() => { void ctx.metering!.save(); }, 5 * 60 * 1000);
  // #357: Prune stale IP rate-limit entries every minute
  timers.setInterval(pruneIpRateLimits, 60_000);
  // #632: Prune stale auth failure rate-limit buckets every minute
  timers.setInterval(pruneAuthFailLimits, 60_000);
  // #398: Sweep stale API key rate limit buckets every 5 minutes
timers.setInterval(() => ctx.auth.sweepStaleRateLimits(), 5 * 60_000);
  // #2452: Sweep expired quota usage entries every 5 minutes to prevent unbounded growth
  const quotaSweepInterval = setInterval(() => routeCtx.quotas.sweep(), 5 * 60_000);
  // Issue #4004: Start orphan action sweeper
ctx.actionSweeper?.start();
  // Issue #4195: Start budget evaluation timer
  budgetTimer.start();
  // #3227: Prune interval from StaticRateLimiter — assigned after registerDashboardStatic()
  // Issue #4248: staticPruneInterval tracked via timers.track() after registration
  let staticPruneInterval: ReturnType<typeof setInterval> | null = null;
  // #4243 step 4: Mutable refs for data set after registration
  const shutdownLateRefs = { pidFilePath: '' };

  // Issue #4243 step 4: Graceful shutdown handler extracted to boot/boot-shutdown.ts
  registerShutdownHandler({
    app,
    ctx,
    eventBus,
    container,
    metricsCache,
    budgetTimer,
    timers,
    serverState,
    lateRefs: shutdownLateRefs,
  });

  // Start monitor via dependency-aware service lifecycle.

  // Start reaper (intervals already created above with stored refs for graceful shutdown)
  logger.info({
    component: 'server',
    operation: 'session_reaper_active',
    attributes: {
      maxAgeHours: ctx.config.maxSessionAgeMs / 3600000,
      intervalMinutes: ctx.config.reaperIntervalMs / 60000,
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

  // #3154: Dashboard static serving extracted to plugins/dashboard-static.ts
  // #3227: Capture prune interval handle for cleanup on shutdown
staticPruneInterval = await registerDashboardStatic(app, { enabled: ctx.config.dashboardEnabled !== false });
  if (staticPruneInterval) timers.track(staticPruneInterval);
  await container.assertHealthy();
await listenWithRetry(app, ctx.config.port, ctx.config.host, ctx.config.stateDir);
shutdownLateRefs.pidFilePath = await writePidFile(ctx.config.stateDir);
  logger.info({
    component: 'server',
    operation: 'startup_listening',
    attributes: {
host: ctx.config.host,
      port: ctx.config.port,
      channels: channels.count,
      stateDir: ctx.config.stateDir,
      claudeProjectsDir: ctx.config.claudeProjectsDir,
    },
  });
if (ctx.auth.authEnabled) {
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
