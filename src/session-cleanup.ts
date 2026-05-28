/**
 * session-cleanup.ts — Shared per-session cleanup for terminated sessions.
 *
 * Ensures all server-side session-keyed tracking structures are cleaned in
 * every termination path (API kill, inbound kill, stale reaper, zombie reaper).
 */

import type { AppContext } from './app-context.js';
import { SYSTEM_TENANT } from './config.js';
import { StructuredLogger } from './logger.js';

const log = new StructuredLogger();

export interface SessionCleanupDeps {
  monitor: { removeSession(sessionId: string): void };
  metrics: { cleanupSession(sessionId: string): void };
  toolRegistry: { cleanupSession(sessionId: string): void };
}

/**
 * Shut down the ACP backend runtime for a session (if one exists).
 * Issue #4294: Ensures the ACP Node wrapper process is killed when a session is killed.
 */
export async function shutdownAcpRuntime(
  sessionId: string,
  ctx: AppContext,
): Promise<void> {
  if (!ctx.acpBackend) return;
  try {
    const session = ctx.sessions.getSession(sessionId);
    await ctx.acpBackend.shutdownSession({
      sessionId,
      tenantId: session?.tenantId ?? SYSTEM_TENANT,
      ownerKeyId: session?.ownerKeyId ?? 'master',
    });
  } catch (e) {
    // Best-effort — session metadata cleanup must proceed regardless.
    log.warn({ component: 'session-cleanup', operation: 'shutdownAcpRuntime', attributes: { sessionId, error: e instanceof Error ? e.message : String(e) } });
  }
}

export function cleanupTerminatedSessionState(
  sessionId: string,
  deps: SessionCleanupDeps,
): void {
  deps.monitor.removeSession(sessionId);
  deps.metrics.cleanupSession(sessionId);
  deps.toolRegistry.cleanupSession(sessionId);
}
