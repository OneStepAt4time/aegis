/**
 * server-bootstrap.ts — Aegis server bootstrap extracted from server.ts (Issue #4227).
 *
 * Contains the module-level setup, service wiring, route registration, and main()
 * bootstrap. The HTTP server setup, handleInbound function, and channel registration
 * have been further extracted to ./server-http.ts, ./server-inbound.ts, and
 * ./server-channels.ts respectively. server.ts is reduced to a thin entry point
 * that imports and invokes main().
 *
 * Extraction acceptance criteria (per Ema's spec):
 *   - No behavior change
 *   - Existing test suite (224 files / 2252 tests baseline) passes unchanged
 *   - No edits in extracted files (src/routes/*.ts) beyond imports
 *   - One PR with diff stat showing extraction only
 *
 * Out of scope: any new route, any new middleware, any refactor of route internals.
 */

// Type declaration for the cross-module pid-path handoff between
// server-bootstrap.ts (which calls acquirePidLock) and server.ts (which
// removes the pid file on startup failure).
declare global {
  // eslint-disable-next-line no-var
  var __startupPidPath__: string | undefined;
}

// ── Imports from extracted modules (Issue #4227) ─────────────────────
import { app } from './server-http.js';
import { channels, registerChannels } from './server-channels.js';
import { handleInbound } from './server-inbound.js';

// ── Original imports (preserved from server.ts, scoped to main() and module-level setup) ──
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SessionManager } from './session.js';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG } from './monitor.js';
import { JsonlWatcher } from './jsonl-watcher.js';
import { loadConfig, SYSTEM_TENANT, type Config } from './config.js';
import type { StateStore } from './services/state/state-store.js';

import { parseIntSafe } from './validation.js';
import { SessionEventBus } from './events.js';

import { SSEConnectionLimiter } from './sse-limiter.js';
import { PipelineManager } from './pipeline.js';
import { registerSSEBridge } from './services/sse-bridge.js';
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

import { logger } from './logger.js';
import { initTracing, loadTracingConfig } from './tracing.js';
import { MemoryBridge } from './memory-bridge.js';
import { cleanupTerminatedSessionState, shutdownAcpRuntime } from './session-cleanup.js';
import { MeteringService } from './metering.js';
import { MetricsCache, JsonFileBackend } from './services/metrics-cache.js';
import { listenWithRetry, acquirePidLock, removePidFile } from './startup.js';
import { AlertManager } from './alerting.js';
let startupPidPath = ''; // #4568: track for cleanup on startup failure

import { ServiceContainer } from './container.js';
import type { AppContext } from './app-context.js';
import { setupAuth, pruneAuthFailLimits, pruneIpRateLimits, requestKeyMap } from './boot/boot-auth.js';
import { TimerRegistry } from './utils/timer-registry.js';
import { watch, type FSWatcher, realpathSync } from 'node:fs';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { WebhookChannel } from './channels/index.js';
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
import { reapStaleSessions, reapZombieSessions, ZOMBIE_REAP_DELAY_MS, ZOMBIE_REAP_INTERVAL_MS } from './services/server/session-reaper.js';
import { setupConfigWatcher } from './services/server/config-watcher.js';

// ── Configuration ────────────────────────────────────────────────────

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

// Issue #4241: All mutable state is now in AppContext, created in main().
// Module-level const values are still initialized here.
const eventBus = new SessionEventBus();
// Issue #4248: Centralized timer registry for clean shutdown
const timers = new TimerRegistry();
// Issue #4116: Debounce Set for session approval callbacks (moved to server-inbound.ts since only handleInbound uses it).

// Preserve public export used by tests and external imports.
export { readParentPid as readPpid } from './process-utils.js';

export async function main(): Promise<void> {
  // Issue #4241: Single context object replaces all module-level mutable globals
  const ctx = {} as AppContext;
  // Load configuration
  ctx.config = await loadConfig();
  startupPidPath = await acquirePidLock(ctx.config.stateDir); // #4568: early lock — refuse before expensive init
  // Expose to server.ts (thin entry point) for startup-failure cleanup
  ; globalThis.__startupPidPath__ = startupPidPath;

  ctx.dashboardTokenSessions = new DashboardSessionStore();
  ctx.dashboardOidc = await createDashboardOidcManagerFromEnv(ctx.config);

  // Initialize OpenTelemetry tracing before any instrumented modules load.
  // Must be called before Fastify starts so auto-instrumentation can patch HTTP.
  await initTracing(loadTracingConfig());

  // Issue #1753: Watch config file for changes and hot-reload allowedWorkDirs
  setupConfigWatcher(ctx, { logger });

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
    const rawDeliveries = wh.getDeliveryLog(ep.url);
    // Map to public contract: statusCode (not responseCode), attemptCount (not attemptNumber)
    const deliveries = rawDeliveries.map(d => ({
      id: d.id,
      timestamp: d.timestamp,
      status: d.status,
      statusCode: d.responseCode,
      durationMs: d.durationMs ?? 0,
      attemptCount: d.attemptNumber,
    }));
    return reply.send({ deliveries });
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

  // Issue #4393: Wire SSE bridge (/v1/sse) — auth-protected, tenant-scoped, connection-limited
  registerSSEBridge(app, routeCtx);

  // Issue #361: Store interval refs so graceful shutdown can clear them
  timers.setInterval(() => reapStaleSessions(ctx.config.maxSessionAgeMs, ctx, { logger, eventBus, channels }), ctx.config.reaperIntervalMs);
  timers.setInterval(() => reapZombieSessions(ctx, { logger, eventBus, channels }), ZOMBIE_REAP_INTERVAL_MS);
  // Issue #4294: ACP orphan reaper — detects and shuts down ACP runtimes
  // whose sessions no longer exist in the session manager.
  const ACP_ORPHAN_REAP_INTERVAL_MS = parseIntSafe(process.env.ACP_ORPHAN_REAP_INTERVAL_MS, 60_000);
  timers.setInterval(async () => {
    if (!ctx.acpBackend) return;
    const { reapOrphanAcpRuntimes } = await import('./services/acp/orphan-reaper.js');
    await reapOrphanAcpRuntimes({
      getActiveSessionIds: () => ctx.sessions.listSessions().filter(s => s.status !== 'killed' && s.status !== 'completed' && s.status !== 'crashed').map(s => s.id),
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
  // #3154: Dashboard static serving extracted to plugins/dashboard-static.ts
  // #3227, #140: Rate limiting via @fastify/rate-limit (replaces custom StaticRateLimiter)
  const dashboardRegistered = await registerDashboardStatic(app, { enabled: ctx.config.dashboardEnabled !== false });
  if (dashboardRegistered) {
    logger.info({
      component: "server",
      operation: "dashboard_static_registered",
    });
  }
  await container.assertHealthy();
await listenWithRetry(app, ctx.config.port, ctx.config.host, ctx.config.stateDir);
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


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isMainModule = (() => {
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main().catch((err: unknown) => {
    if (startupPidPath) removePidFile(startupPidPath);
    logger.error({ component: 'server', operation: 'startup_failed', errorCode: 'STARTUP_FAILED', attributes: { error: err instanceof Error ? err.message : String(err) } });
    process.exit(1);
  });
}
