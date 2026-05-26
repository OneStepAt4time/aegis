/**
 * app-context.ts — Typed application context for server.ts
 *
 * Bundles all mutable module-level state into a single typed object,
 * eliminating temporal coupling and enabling multiple server instances
 * and testability. Created once in main() and passed explicitly to
 * every function that needs shared state.
 *
 * Issue #4241: Replaces 23 mutable module-level `let` bindings.
 */

import type { FSWatcher } from 'node:fs';
import type { Config } from './config.js';
import type { StateStore } from './services/state/state-store.js';
import type { SessionManager } from './session.js';
import type { SessionMonitor } from './monitor.js';
import type { JsonlWatcher } from './jsonl-watcher.js';
import type { MemoryBridge } from './memory-bridge.js';
import type { SSEConnectionLimiter } from './sse-limiter.js';
import type { PipelineManager } from './pipeline.js';
import type { ToolRegistry } from './tool-registry.js';
import type { AuthManager } from './services/auth/index.js';
import type { MetricsCollector } from './metrics.js';
import type { AuditLogger } from './audit.js';
import type { AlertManager } from './alerting.js';
import type { DashboardOIDCManager, DashboardSessionStore } from './services/auth/OIDCManager.js';
import type { AcpLocalStorageProfile } from './services/acp/local-storage.js';
import type { AcpSessionService } from './services/acp/session-service.js';
import type { AcpBackend } from './services/acp/backend.js';
import type { AcpTerminalBridge } from './services/acp/terminal-bridge.js';
import type { AcpPauseInterventionStore } from './services/acp/pause-intervention.js';
import type { ActionSweeper } from './services/acp/action-sweeper.js';

/**
 * Typed application context holding all shared mutable state.
 *
 * Initialized in main() and passed explicitly to:
 * - handleInbound()
 * - reapStaleSessions()
 * - reapZombieSessions()
 * - setupAuth()
 * - setupConfigWatcher() / handleConfigReload()
 * - gracefulShutdown()
 */
export interface AppContext {
  config: Config;
  sessions: SessionManager;
  sessionStore: StateStore;
  monitor: SessionMonitor;
  jsonlWatcher: JsonlWatcher;
  memoryBridge: MemoryBridge | null;
  sseLimiter: SSEConnectionLimiter;
  pipelines: PipelineManager;
  toolRegistry: ToolRegistry;
  auth: AuthManager;
  metrics: MetricsCollector;
  auditLogger: AuditLogger | undefined;
  alertManager: AlertManager;
  dashboardOidc: DashboardOIDCManager | null;
  dashboardTokenSessions: DashboardSessionStore;
  configWatcher: FSWatcher | null;
  acpLocalProfile: AcpLocalStorageProfile | null;
  acpSessionService: AcpSessionService | null;
  acpBackend: AcpBackend | null;
  acpTerminalBridge: AcpTerminalBridge | null;
  acpPauseStore: AcpPauseInterventionStore | null;
  actionSweeper: ActionSweeper | null;
  configReloadTimer: ReturnType<typeof setTimeout> | null;
  watchedConfigPath: string | null;
}
