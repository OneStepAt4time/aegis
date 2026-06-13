/**
 * dead-detector.ts — Dead session detection and cleanup.
 *
 * Extracted from SessionMonitor: detects sessions whose CC process
 * has terminated unexpectedly, notifies channels, and triggers cleanup.
 */

import type { SessionInfo } from '../session-types.js';
import type { SessionEventPayload, SessionEvent } from '../channels/index.js';
import type { SessionEventBus } from '../events.js';
import type { AlertManager, AlertType } from '../alerting.js';
import type { SessionManager } from '../session.js';
import { suppressedCatch } from '../suppress.js';
import { logger } from '../logger.js';
import { maybeInjectFault } from '../fault-injection.js';

/** Dependencies needed by DeadDetector to interact with the rest of the system. */
export interface DeadDetectorDeps {
  sessions: SessionManager;
  /** Build a standard event payload. */
  makePayload: (event: SessionEvent, session: SessionInfo, detail: string) => SessionEventPayload;
  /** Emit dead event on the event bus. */
  emitDead?: (sessionId: string, detail: string) => void;
  /** Record a failure for alerting. */
  alertFailure?: (type: AlertType, detail: string) => void;
  /** Notify channels of status change. */
  statusChange: (payload: SessionEventPayload) => void;
  /** Remove session from internal tracking (maps, sets, watchers). */
  removeSession: (sessionId: string) => void;
  /** Issue #4691: Shut down ACP runtime before killing session. */
  shutdownAcpRuntime?: (sessionId: string) => Promise<void>;
}

/**
 * DeadDetector tracks sessions whose CC process has died unexpectedly.
 *
 * Maintains a set of already-notified dead sessions to prevent duplicate alerts.
 */
export class DeadDetector {
  private deadNotified = new Set<string>();

  constructor(private deps: DeadDetectorDeps) {}

  /** Public getter for dead-notified session tracking. */
  getDeadNotified(): Set<string> { return this.deadNotified; }

  /** Update dependency callbacks (e.g. after setAlertManager). */
  updateDeps(deps: Partial<DeadDetectorDeps>): void {
    Object.assign(this.deps, deps);
  }

  /** Check all sessions for dead processes. */
  async checkDeadSessions(): Promise<void> {
    const sessions = this.deps.sessions.listSessions();
    for (const session of sessions) {
      if (this.deadNotified.has(session.id)) continue;

      await maybeInjectFault('monitor.checkDeadSessions.isWindowAlive');
      const alive = await this.deps.sessions.isWindowAlive(session.id);
      if (!alive) {
        await this.handleDeadSession(session, 'process_not_alive_or_unknown');
      }
    }
  }

  /** Handle a single dead session. */
  private async handleDeadSession(session: SessionInfo, cause: string): Promise<void> {
    logger.warn({
      component: 'monitor',
      operation: 'check_dead_sessions',
      sessionId: session.id,
      errorCode: 'SESSION_TERMINATED_UNEXPECTEDLY',
      attributes: {
        cause,
        displayName: session.displayName,
        windowId: session.windowId,
        claudeSessionId: session.claudeSessionId,
        ccPid: session.ccPid ?? null,
        uptimeMs: Date.now() - session.createdAt,
        lastActivityAt: new Date(session.lastActivity).toISOString(),
        detectedAt: new Date().toISOString(),
      },
    });

    this.deadNotified.add(session.id);
    // Track when the session died so the zombie reaper can clean it up
    session.lastDeadAt = Date.now();
    const detail = `Session "${session.displayName}" died — session process no longer alive. ` +
        `Last activity: ${new Date(session.lastActivity).toISOString()}`;

    if (this.deps.emitDead) {
      this.deps.emitDead(session.id, detail);
    }

    this.deps.statusChange(
      this.deps.makePayload('status.dead', session, detail),
    );

    // Issue #1418: Report dead session to alerting
    this.deps.alertFailure?.('session_failure',
      `Session "${session.displayName}" died unexpectedly: ${cause}`);

    this.deps.removeSession(session.id);

    // Issue #4691: Shut down ACP runtime before killing session to prevent orphans
    if (this.deps.shutdownAcpRuntime) {
      try {
        await this.deps.shutdownAcpRuntime(session.id);
      } catch (e) {
        logger.warn({
          component: 'monitor',
          operation: 'check_dead_sessions',
          sessionId: session.id,
          errorCode: 'ACP_SHUTDOWN_FAILED',
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }
    }

    // #262: Also remove from SessionManager so dead sessions don't linger
    try {
      await this.deps.sessions.killSession(session.id);
    } catch (e) {
      suppressedCatch(e, 'monitor.checkDeadSessions.killSession');
    }
  }

  /** Remove a session from dead-tracking (called during cleanup). */
  removeSession(sessionId: string): void {
    this.deadNotified.delete(sessionId);
  }
}
