/**
 * session-reaper.ts — Stale and zombie session cleanup.
 *
 * Extracted from server.ts as part of #4243 decomposition.
 */

import { cleanupTerminatedSessionState, shutdownAcpRuntime } from '../../session-cleanup.js';
import { parseIntSafe } from '../../validation.js';
import type { AppContext } from '../../app-context.js';
import type { StructuredLogger } from '../../logger.js';
import { SessionEventBus } from '../../events.js';
import type { ChannelManager } from '../../channels/index.js';

export const ZOMBIE_REAP_DELAY_MS = parseIntSafe(process.env.ZOMBIE_REAP_DELAY_MS, 60000);
export const ZOMBIE_REAP_INTERVAL_MS = parseIntSafe(process.env.ZOMBIE_REAP_INTERVAL_MS, 60000);

interface ReaperHelpers {
  logger: StructuredLogger;
  eventBus: SessionEventBus;
  channels: ChannelManager;
}

/**
 * Kill sessions that exceed the maximum age.
 */
export async function reapStaleSessions(
  maxAgeMs: number,
  ctx: AppContext,
  helpers: ReaperHelpers,
): Promise<void> {
  const { logger, eventBus, channels } = helpers;
  const now = Date.now();
  const snapshot = [...ctx.sessions.listSessions()];
  for (const session of snapshot) {
    if (!ctx.sessions.getSession(session.id)) continue;
    if (session.isPinned) continue;
    const age = now - session.createdAt;
    if (age > maxAgeMs) {
      const ageMin = Math.round(age / 60000);
      logger.info({
        component: 'server',
        operation: 'reap_stale_sessions',
        sessionId: session.id,
        attributes: { displayName: session.displayName, ageMinutes: ageMin },
      });
      try {
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
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }
    }
  }
}

/**
 * Kill sessions that have been dead for too long (zombie reaping, Issue #283).
 */
export async function reapZombieSessions(
  ctx: AppContext,
  helpers: ReaperHelpers,
): Promise<void> {
  const { logger, eventBus, channels } = helpers;
  const now = Date.now();
  const snapshot = [...ctx.sessions.listSessions()];
  for (const session of snapshot) {
    if (!ctx.sessions.getSession(session.id)) continue;
    if (session.isPinned) continue;
    if (!session.lastDeadAt) continue;
    const deadDuration = now - session.lastDeadAt;
    if (deadDuration < ZOMBIE_REAP_DELAY_MS) continue;

    logger.info({
      component: 'server',
      operation: 'reap_zombie_sessions',
      sessionId: session.id,
      attributes: { displayName: session.displayName },
    });
    try {
      eventBus.cleanupSession(session.id);
      await shutdownAcpRuntime(session.id, ctx);
      await ctx.sessions.killSession(session.id);
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
        attributes: { error: e instanceof Error ? e.message : String(e) },
      });
    }
  }
}
