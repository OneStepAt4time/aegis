/**
 * signal-cleanup-helper.ts — Signal handler cleanup logic for Issue #569.
 *
 * Provides killAllSessions() and createSignalHandler() for graceful shutdown.
 * Separated from server.ts for testability.
 */

import type { SessionManager } from './session.js';
import type { TmuxManager } from './tmux.js';
import { cleanupTerminatedSessionState, type SessionCleanupDeps } from './session-cleanup.js';

/** Result of killAllSessions operation. */
export interface KillAllResult {
  /** Number of sessions successfully killed. */
  killed: number;
  /** Number of sessions that failed to kill. */
  errors: number;
}

/** Result of killAllSessionsWithTimeout operation. */
export interface KillAllWithTimeoutResult extends KillAllResult {
  /** Whether any session kill timed out. */
  timedOut: boolean;
}

/**
 * Kill all active CC sessions and the tmux session.
 * Best-effort: continues even if individual session kills fail.
 *
 * @param sessions - SessionManager instance
 * @param tmux - TmuxManager instance
 * @returns Number of sessions killed and errors encountered
 */
export async function killAllSessions(
  sessions: SessionManager,
  tmux: TmuxManager,
  cleanupDeps?: SessionCleanupDeps,
): Promise<KillAllResult> {
  const allSessions = sessions.listSessions();
  let killed = 0;
  let errors = 0;

  // Kill each session individually (restores settings, cleans up temp files)
  for (const session of allSessions) {
    try {
      await sessions.killSession(session.id);
      if (cleanupDeps) cleanupTerminatedSessionState(session.id, cleanupDeps);
      killed++;
    } catch (e) {
      errors++;
      console.error(
        `Signal cleanup: failed to kill session ${session.windowName} (${session.id.slice(0, 8)}): ${(e as Error).message}`,
      );
    }
  }

  // Final fallback: kill the entire tmux session to ensure nothing is left
  try {
    await tmux.killSession();
  } catch (e) {
    console.error(`Signal cleanup: failed to kill tmux session: ${(e as Error).message}`);
  }

  console.log(`Signal cleanup: killed ${killed} sessions (${errors} errors)`);
  return { killed, errors };
}

/**
 * Kill all sessions with per-session timeout protection.
 * If a session kill hangs beyond the timeout, it is skipped.
 *
 * @param sessions - SessionManager instance
 * @param tmux - TmuxManager instance
 * @param perSessionTimeoutMs - Maximum time to wait per session kill (default 5000ms)
 * @returns Result including timeout status
 */
export async function killAllSessionsWithTimeout(
  sessions: SessionManager,
  tmux: TmuxManager,
  perSessionTimeoutMs: number = 5_000,
  cleanupDeps?: SessionCleanupDeps,
): Promise<KillAllWithTimeoutResult> {
  const allSessions = sessions.listSessions();
  let killed = 0;
  let errors = 0;
  let timedOut = false;

  for (const session of allSessions) {
    try {
      await withTimeout(
        sessions.killSession(session.id),
        perSessionTimeoutMs,
        `Session kill timeout for ${session.windowName}`,
      );
      if (cleanupDeps) cleanupTerminatedSessionState(session.id, cleanupDeps);
      killed++;
    } catch (e) {
      if (e instanceof TimeoutError) {
        timedOut = true;
        console.error(`Signal cleanup: TIMED OUT killing session ${session.windowName}`);
      } else {
        console.error(
          `Signal cleanup: failed to kill session ${session.windowName}: ${(e as Error).message}`,
        );
      }
      errors++;
    }
  }

  // Final fallback: kill entire tmux session
  try {
    await tmux.killSession();
  } catch (e) {
    console.error(`Signal cleanup: failed to kill tmux session: ${(e as Error).message}`);
  }

  console.log(`Signal cleanup: killed ${killed}/${allSessions.length} sessions (${errors} errors, ${timedOut ? 'some timed out' : 'no timeouts'})`);
  return { killed, errors, timedOut };
}

/** Error thrown when an operation exceeds its timeout. */
class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** Wrap a promise with a timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Create a signal handler that kills all sessions on SIGTERM/SIGINT.
 * Includes reentrance guard to prevent double cleanup on rapid signals.
 *
 * @param sessions - SessionManager instance
 * @param tmux - TmuxManager instance
 * @returns Signal handler function
 */
export function createSignalHandler(
  sessions: SessionManager,
  tmux: TmuxManager,
): (signal: string) => void {
  let shuttingDown = false;

  return (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`${signal} received — cleaning up ${sessions.listSessions().length} active sessions...`);

    void killAllSessions(sessions, tmux)
      .then((result) => {
        console.log(`${signal} cleanup complete: ${result.killed} sessions killed`);
        process.exit(0);
      })
      .catch((e) => {
        console.error(`${signal} cleanup error:`, e);
        process.exit(1);
      });
  };
}
