/**
 * boot-shutdown.ts — Graceful shutdown handler for Aegis server.
 *
 * Extracted from server.ts (#4243 step 4): the ~200-line shutdown
 * function that tears down all services in reverse dependency order
 * with timeout safety.
 *
 * Issue #361, #415, #1911: Reentrance guard, config-driven timeouts,
 * structured logging for every shutdown step.
 */

import type { FastifyInstance } from 'fastify';
import type { ServiceContainer } from '../container.js';
import type { AppContext } from '../app-context.js';
import type { SessionEventBus } from '../events.js';
import type { MetricsCache } from '../services/metrics-cache.js';
import type { TimerRegistry } from '../utils/timer-registry.js';
import type { BudgetTimer } from '../budgets/timer.js';
import { killAllSessions } from '../signal-cleanup-helper.js';
import { shutdownAcpRuntime } from '../session-cleanup.js';
import { SYSTEM_TENANT } from '../config.js';
import { removePidFile } from '../startup.js';
import { shutdownTracing } from '../tracing.js';
import { getRateLimiter } from '../middleware/auth-setup.js';
import { isWindowsShutdownMessage, parseShutdownTimeoutMs } from '../shutdown-utils.js';
import { StructuredLogger } from '../logger.js';

const logger = new StructuredLogger();

/** Mutable references set after registration but read during shutdown. */
export interface ShutdownLateRefs {
  pidFilePath: string;
}

export interface ShutdownDeps {
  app: FastifyInstance;
  ctx: AppContext;
  eventBus: SessionEventBus;
  container: ServiceContainer;
  metricsCache: MetricsCache;
  budgetTimer: BudgetTimer;
  timers: TimerRegistry;
  serverState: { draining: boolean };
  lateRefs: ShutdownLateRefs;
}

/**
 * Register the graceful shutdown handler.
 *
 * `lateRefs` is a mutable object whose `pidFilePath` is set after
 * `listenWithRetry` completes — the shutdown handler reads it at shutdown time.
 */
export function registerShutdownHandler(deps: ShutdownDeps): void {
  let shuttingDown = false;

  const shutdownTimeoutMs = deps.ctx.config.shutdownHardMs > 0
    ? deps.ctx.config.shutdownHardMs
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
      const { app, ctx, eventBus, container, metricsCache, budgetTimer, timers, serverState, lateRefs } = deps;

      // 1. Flip health to draining and broadcast shutdown SSE frame
      serverState.draining = true;
      eventBus.emitShutdown();

      // 2. Stop accepting new requests (waits up to shutdownGraceMs for in-flight requests)
      try {
        await Promise.race([
          app.close(),
          new Promise<void>(resolve => setTimeout(resolve, ctx.config.shutdownGraceMs)),
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
      ctx.monitor.stop();
      // Issue #1937: Stop session store
      try {
        await ctx.sessionStore.stop(AbortSignal.timeout(5000));
      } catch (e) {
        logger.error({
          component: 'server',
          operation: 'graceful_shutdown_stop_store',
          errorCode: 'SHUTDOWN_STOP_STORE_FAILED',
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }
      // #1753: Close config file watcher
      ctx.configWatcher?.close();
      ctx.configWatcher = null;
      if (ctx.configReloadTimer) { timers.clearTimeout(ctx.configReloadTimer); ctx.configReloadTimer = null; }
      // Issue #4248: Clear all tracked timers via TimerRegistry
      timers.clearAll();
      // Issue #4004: Stop orphan action sweeper
      ctx.actionSweeper?.stop();
      // Issue #4195: Stop budget evaluation timer
      budgetTimer.stop();
      getRateLimiter().dispose();

      // 3. Close file watchers, pipelines, and reaper
      try {
        ctx.jsonlWatcher.destroy();
      } catch (e) {
        logger.error({
          component: 'server',
          operation: 'graceful_shutdown_destroy_jsonl_watcher',
          errorCode: 'SHUTDOWN_DESTROY_JSONL_WATCHER_FAILED',
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }
      try {
        await ctx.pipelines.destroy();
      } catch (e) {
        logger.error({
          component: 'server',
          operation: 'graceful_shutdown_destroy_pipelines',
          errorCode: 'SHUTDOWN_DESTROY_PIPELINES_FAILED',
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }
      if (ctx.memoryBridge) {
        try {
          ctx.memoryBridge.stopReaper();
        } catch (e) {
          logger.error({
            component: 'server',
            operation: 'graceful_shutdown_stop_memory_bridge_reaper',
            errorCode: 'SHUTDOWN_STOP_MEMORY_BRIDGE_REAPER_FAILED',
            attributes: { error: e instanceof Error ? e.message : String(e) },
          });
        }
      }

      // Issue #4691: Shut down ACP runtimes before killing sessions to prevent orphaned processes
      if (ctx.acpBackend) {
        for (const session of ctx.sessions.listSessions()) {
          try {
            await shutdownAcpRuntime(session.id, ctx);
          } catch (e) {
            logger.warn({
              component: 'server',
              operation: 'graceful_shutdown_acp_runtime',
              attributes: { sessionId: session.id, error: e instanceof Error ? e.message : String(e) },
            });
          }
        }
      }

      // Issue #569: Kill all CC sessions before exit
      try {
        await killAllSessions(ctx.sessions, { monitor: ctx.monitor, metrics: ctx.metrics, toolRegistry: ctx.toolRegistry });
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
        await ctx.metrics.save();
      } catch (e) {
        logger.error({
          component: 'server',
          operation: 'graceful_shutdown_save_metrics',
          errorCode: 'SHUTDOWN_SAVE_METRICS_FAILED',
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }

      // Issue #3310: Save metering data on shutdown.
      try {
        await ctx.metering!.save();
      } catch (e) {
        logger.error({
          component: 'server',
          operation: 'graceful_shutdown_save_metering',
          errorCode: 'SHUTDOWN_SAVE_METERING_FAILED',
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
      removePidFile(lateRefs.pidFilePath);

      // 8. Issue #1911: Flush pending audit log writes with a hard cap of shutdownHardMs
      try {
        const auditFlushMs = Math.max(0, shutdownTimeoutMs - 1_000);
        await Promise.race([
          ctx.auditLogger?.flush() ?? Promise.resolve(),
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

  // Register signal handlers
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

  // Standalone safety net — not part of shutdown, but registered alongside
  // signal handlers for structured logging of unhandled promise rejections.
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
}
