/**
 * session-cleanup.ts — Shared per-session cleanup for terminated sessions.
 *
 * Ensures all server-side session-keyed tracking structures are cleaned in
 * every termination path (API kill, inbound kill, stale reaper, zombie reaper).
 */

export interface SessionCleanupDeps {
  monitor: { removeSession(sessionId: string): void };
  metrics: { cleanupSession(sessionId: string): void };
  toolRegistry: { cleanupSession(sessionId: string): void };
}

export function cleanupTerminatedSessionState(
  sessionId: string,
  deps: SessionCleanupDeps,
): void {
  deps.monitor.removeSession(sessionId);
  deps.metrics.cleanupSession(sessionId);
  deps.toolRegistry.cleanupSession(sessionId);
}
