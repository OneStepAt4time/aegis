/**
 * boot-routes.ts — Route registration and route-context initialization.
 *
 * Extracted from server.ts as part of #4243 (god object reduction).
 * Creates the RouteContext, registers all API route modules, and returns
 * the context + serverState for use in timer setup and graceful shutdown.
 */

import type { FastifyInstance } from 'fastify';

import { logger } from '../logger.js';
import type { AppContext } from '../app-context.js';
import { QuotaManager } from '../services/auth/QuotaManager.js';
import { InMemoryPauseInterventionStore } from '../services/acp/in-memory-pause-intervention-store.js';
import { setRouteConfig } from '../routes/context.js';
import {
  registerHealthRoutes,
  registerAuthRoutes,
  registerAuditRoutes,
  registerSessionRoutes,
  registerSessionActionRoutes,
  registerSessionApprovalRoutes,
  registerQuickApproveRejectRoutes,
  registerSessionDataRoutes,
  registerEventRoutes,
  registerTemplateRoutes,
  registerPipelineRoutes,
  registerAnalyticsRoutes,
  registerOidcAuthRoutes,
  registerUsageRoutes,
  registerCostRoutes,
  registerControlActionRoutes,
  registerDriverRoutes,
  registerTerminalRoutes,
  registerOpenApiSpec,
  registerOpenApiRoute,
  type RouteContext,
} from '../routes/index.js';
import { registerDeviceAuthRoutes } from '../routes/device-auth.js';
import { registerBudgetRoutes } from '../budgets/routes.js';
import { validateWorkDir } from '../validation.js';
import type { BudgetStore } from '../budgets/store.js';
import type { BudgetEvaluator } from '../budgets/evaluator.js';
import type { SessionEventBus } from '../events.js';
import type { ChannelManager } from '../channels/index.js';
import type { MetricsCache } from '../services/metrics-cache.js';
import { requestKeyMap } from '../middleware/auth-setup.js';

/** Dependencies needed for route registration beyond what AppContext provides. */
export interface RouteDeps {
  eventBus: SessionEventBus;
  channels: ChannelManager;
  metricsCache: MetricsCache;
  budgetStore: BudgetStore;
  budgetEvaluator: BudgetEvaluator;
  requestKeyMap: typeof requestKeyMap;
}

/**
 * Initialize the route context and register all API route modules.
 * Returns the constructed RouteContext and serverState for caller use
 * (quota sweep timer, drain flag on shutdown).
 */
export function registerRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  deps: RouteDeps,
): { routeCtx: RouteContext; serverState: { draining: boolean } } {
  const { eventBus, channels, metricsCache, budgetStore, budgetEvaluator, requestKeyMap: reqKeyMap } = deps;

  // Validate workDir — delegates to validation.ts (Issue #435)
  const validateWorkDirWithConfig = (workDir: string) => validateWorkDir(workDir, ctx.config.allowedWorkDirs);

  const serverState = { draining: false };

  const routeCtx: RouteContext = {
    sessions: ctx.sessions,
    auth: ctx.auth,
    config: ctx.config,
    metrics: ctx.metrics,
    monitor: ctx.monitor,
    eventBus,
    channels,
    jsonlWatcher: ctx.jsonlWatcher,
    pipelines: ctx.pipelines,
    toolRegistry: ctx.toolRegistry,
    getAuditLogger: () => ctx.auditLogger,
    alertManager: ctx.alertManager,
    sseLimiter: ctx.sseLimiter,
    memoryBridge: ctx.memoryBridge,
    requestKeyMap: reqKeyMap,
    validateWorkDir: validateWorkDirWithConfig,
    serverState,
    quotas: new QuotaManager(),
    metering: ctx.metering!,
    metricsCache,
    dashboardOidc: ctx.dashboardOidc,
    dashboardTokenSessions: ctx.dashboardTokenSessions,
    pauseInterventionStore: ctx.acpPauseStore ?? new InMemoryPauseInterventionStore(),
    acpBackend: ctx.acpBackend ?? undefined,
    eventStore: ctx.acpLocalProfile?.eventStore ?? undefined,
    terminalBridge: ctx.acpTerminalBridge ?? undefined,
  };

  // Issue #3208: Set config ref for strictRBAC enforcement in route guards
  setRouteConfig(ctx.config);

  // Issue #3208: Warn when auth is disabled and RBAC-guarded routes are active
  if (!ctx.auth.authEnabled && !ctx.config.strictRBAC) {
    logger.warn({
      component: 'server',
      operation: 'rbac_warning',
      errorCode: 'RBAC_DISABLED_NO_AUTH',
      attributes: { message: 'Auth is disabled and strictRBAC is false — all RBAC guards are bypassed. Set AEGIS_STRICT_RBAC=true for production.' },
    });
  }

  registerHealthRoutes(app, routeCtx);
  registerAuthRoutes(app, routeCtx);
  registerOidcAuthRoutes(app, routeCtx);
  // Issue #1943: OAuth2 device authorization grant endpoints (RFC 8628)
  registerDeviceAuthRoutes(app);
  registerAuditRoutes(app, routeCtx);
  registerSessionRoutes(app, routeCtx);
  registerSessionActionRoutes(app, routeCtx);
  registerSessionApprovalRoutes(app, routeCtx);
  registerQuickApproveRejectRoutes(app, routeCtx);
  registerSessionDataRoutes(app, routeCtx);
  registerEventRoutes(app, routeCtx);
  registerTemplateRoutes(app, routeCtx);
  registerPipelineRoutes(app, routeCtx);
  registerAnalyticsRoutes(app, routeCtx);
  registerUsageRoutes(app, routeCtx);
  registerCostRoutes(app, routeCtx);
  // Issue #4195: Cost Alerts — /v1/budgets endpoints
  registerBudgetRoutes(app, { auth: ctx.auth, budgetStore, budgetEvaluator });
  registerControlActionRoutes(app, routeCtx);
  registerDriverRoutes(app, routeCtx);
  registerTerminalRoutes(app, routeCtx);

  // OpenAPI spec registration and route (issue #1909)
  registerOpenApiSpec();
  registerOpenApiRoute(app);

  return { routeCtx, serverState };
}
