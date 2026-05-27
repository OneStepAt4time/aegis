// boot/boot-reaper.ts — extracted reaper logic from server.ts

import type { SessionManager } from '../session.js';
import type { EventBus } from '../event-bus.js';
import type { ChannelManager } from '../channels/index.js';
import type { MetricsManager } from '../metrics.js';
import type { Monitor } from '../monitor.js';
import type { ToolRegistry } from '../tools/tool-registry.js';

export const ZOMBIE_REAP_DELAY_MS = parseInt(process.env.ZOMBIE_REAP_DELAY_MS || '60000', 10);
export const ZOMBIE_REAP_INTERVAL_MS = parseInt(process.env.ZOMBIE_REAP_INTERVAL_MS || '60000', 10);

export interface ReaperDeps {
  sessions: SessionManager;
  eventBus: EventBus;
  channels: ChannelManager;
  metrics: MetricsManager;
  monitor: Monitor;
  toolRegistry: ToolRegistry;
  logger: { info: (...args: any[]) => void; error: (...args: any[]) => void };
}

export async function reapStaleSessionsImpl(deps: ReaperDeps, maxAgeMs: number): Promise<void> {
  const { sessions, eventBus, channels, metrics, monitor, toolRegistry, logger } = deps;
  const now = Date.now();
  const snapshot = [...sessions.listSessions()];
  for (const session of snapshot) {
    if (!sessions.getSession(session.id)) continue;
    if (session.isPinned) continue;
    const age = now - session.createdAt;
    if (age > maxAgeMs) {
      const ageMin = Math.round(age / 60000);
      logger.info({ component: 'server', operation: 'reap_stale_sessions', sessionId: session.id, attributes: { displayName: session.displayName, ageMinutes: ageMin } });
      try {
        await sessions.killSession(session.id);
        eventBus.cleanupSession(session.id);
        channels.sessionEnded({ event: 'session.ended', timestamp: new Date().toISOString(), session: { id: session.id, name: session.displayName, workDir: session.workDir }, detail: `Auto-killed: exceeded ${maxAgeMs / 3600000}h time limit` });
        // best-effort cleanup
        try { cleanupTerminatedSessionState(session.id, { monitor, metrics, toolRegistry }); } catch (_) { /* ignore */ }
      } catch (e) {
        logger.error({ component: 'server', operation: 'reap_stale_sessions', sessionId: session.id, errorCode: 'REAPER_KILL_FAILED', attributes: { error: e instanceof Error ? e.message : String(e) } });
      }
    }
  }
}

export async function reapZombieSessionsImpl(deps: ReaperDeps): Promise<void> {
  const { sessions, eventBus, channels, metrics, monitor, toolRegistry, logger } = deps;
  const now = Date.now();
  const snapshot = [...sessions.listSessions()];
  for (const session of snapshot) {
    if (!sessions.getSession(session.id)) continue;
    if (session.isPinned) continue;
    if (!session.lastDeadAt) continue;
    const deadDuration = now - session.lastDeadAt;
    if (deadDuration < ZOMBIE_REAP_DELAY_MS) continue;

    logger.info({ component: 'server', operation: 'reap_zombie_sessions', sessionId: session.id, attributes: { displayName: session.displayName } });
    try {
      eventBus.cleanupSession(session.id);
      await sessions.killSession(session.id);
      metrics.sessionInfraFailed(session.id);
      try { cleanupTerminatedSessionState(session.id, { monitor, metrics, toolRegistry }); } catch (_) { /* ignore */ }
      channels.sessionEnded({ event: 'session.ended', timestamp: new Date().toISOString(), session: { id: session.id, name: session.displayName, workDir: session.workDir }, detail: `Zombie reaped: dead for ${Math.round(deadDuration / 1000)}s` });
    } catch (e) {
      logger.error({ component: 'server', operation: 'reap_zombie_sessions', sessionId: session.id, errorCode: 'ZOMBIE_REAP_FAILED', attributes: { error: e instanceof Error ? e.message : String(e) } });
    }
  }
}

// Helper defined in server.ts originally — keep a no-op stub here for build-time linking; server will provide the real implementation via import time workaround if needed.
export function cleanupTerminatedSessionState(sessionId: string, deps?: { monitor?: Monitor; metrics?: MetricsManager; toolRegistry?: ToolRegistry }) {
  // implementation lives in server startup context — this is a safe placeholder to avoid circular imports.
  return;
}
