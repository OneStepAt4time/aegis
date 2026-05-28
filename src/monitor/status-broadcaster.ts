/**
 * status-broadcaster.ts — Status change detection, debouncing, and broadcasting.
 *
 * Extracted from SessionMonitor: manages idle notification dedup,
 * context-warning auto-compact, status debouncing, and event payload construction.
 */

import type { SessionInfo, UIState } from '../session-types.js';
import type { SessionEventPayload, SessionEvent } from '../channels/index.js';
import type { SessionEventBus } from '../events.js';
import type { SessionManager } from '../session.js';
import { logger } from '../logger.js';

/** Dependencies needed by StatusBroadcaster. */
export interface StatusBroadcasterDeps {
  sessions: SessionManager;
  /** Build a standard event payload. */
  makePayload: (event: SessionEvent, session: SessionInfo, detail: string) => SessionEventPayload;
  /** Notify channels of status change. */
  statusChange: (payload: SessionEventPayload) => void;
  /** Emit approval event on the event bus. */
  emitApproval?: (sessionId: string, content: string) => void;
  /** Emit status event on the event bus. */
  emitStatus?: (sessionId: string, status: string, detail: string) => void;
}

/** Debounce interval for status change broadcasts (ms). */
const STATUS_CHANGE_DEBOUNCE_MS = 500;

/**
 * StatusBroadcaster handles status change detection and notification.
 *
 * Manages:
 * - Idle notification dedup (only notify once per idle period)
 * - Status change debouncing (coalesce rapid transitions)
 * - Auto-approve for non-default permission modes
 * - Context warning auto-compact
 */
export class StatusBroadcaster {
  private idleNotified = new Set<string>();
  private contextWarningCompacted = new Set<string>();
  private idleSince = new Map<string, number>();
  private statusChangeDebounce = new Map<string, NodeJS.Timeout>();

  constructor(private deps: StatusBroadcasterDeps) {}

  /** Build a standard event payload. */
  makePayload(event: SessionEvent, session: SessionInfo, detail: string): SessionEventPayload {
    return {
      event,
      timestamp: new Date().toISOString(),
      session: {
        id: session.id,
        name: session.displayName,
        workDir: session.workDir,
      },
      detail: detail.slice(0, 2000),
    };
  }

  /**
   * Broadcast a status change for a session.
   * Handles auto-approve, idle debouncing, context-warning auto-compact, etc.
   */
  async broadcastStatusChange(
    session: SessionInfo,
    status: UIState,
    prevStatus: UIState | undefined,
    result: { statusText: string | null; interactiveContent: string | null },
  ): Promise<void> {
    if (status === 'permission_prompt' || status === 'bash_approval') {
      this.deps.emitApproval?.(session.id, result.interactiveContent || 'Permission requested');

      const AUTO_APPROVE_MODES = new Set(['bypassPermissions', 'dontAsk', 'acceptEdits', 'auto']);
      if (session.permissionMode !== 'default' && AUTO_APPROVE_MODES.has(session.permissionMode)) {
        logger.info({
          component: 'monitor',
          operation: 'auto_approve_permission',
          sessionId: session.id,
          attributes: { displayName: session.displayName, mode: session.permissionMode },
        });
        try {
          await this.deps.sessions.approve(session.id);
          this.deps.statusChange(
            this.makePayload('status.permission', session,
              `[AUTO-APPROVED] ${result.interactiveContent || 'Permission auto-approved'}`),
          );
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          logger.error({
            component: 'monitor',
            operation: 'auto_approve_permission',
            sessionId: session.id,
            errorCode: 'AUTO_APPROVE_FAILED',
            attributes: { error: errMsg },
          });
          this.deps.statusChange(
            this.makePayload('status.permission', session,
              `[AUTO-APPROVE FAILED] ${result.interactiveContent || 'Permission requested'}: ${errMsg}`),
          );
        }
      } else {
        this.deps.statusChange(
          this.makePayload('status.permission', session, result.interactiveContent || 'Permission requested'),
        );
      }
    } else if (status === 'plan_mode') {
      this.deps.emitStatus?.(session.id, 'plan_mode', result.interactiveContent || 'Plan review requested');
      this.deps.statusChange(
        this.makePayload('status.plan', session, result.interactiveContent || 'Plan review requested'),
      );
    } else if (status === 'idle') {
      const idleStart = this.idleSince.get(session.id) || Date.now();
      const idleDuration = Date.now() - idleStart;
      if (idleDuration >= 3_000 && !this.idleNotified.has(session.id)) {
        this.idleNotified.add(session.id);
        this.deps.emitStatus?.(session.id, 'idle', result.statusText || 'Session finished working, awaiting input');
        this.deps.statusChange(
          this.makePayload('status.idle', session, result.statusText || 'Session finished working, awaiting input'),
        );
      }
    } else if (status === 'context_warning' && prevStatus !== 'context_warning') {
      if (!this.contextWarningCompacted.has(session.id)) {
        this.contextWarningCompacted.add(session.id);
        logger.info({
          component: 'monitor',
          operation: 'auto_compact_context_warning',
          sessionId: session.id,
          attributes: { displayName: session.displayName },
        });
        try {
          this.deps.statusChange(
            this.makePayload('status.context_warning', session,
              'Context window nearing limit — auto-injected /compact to prevent overflow'),
          );
        } catch (e: unknown) {
          logger.error({
            component: 'monitor',
            operation: 'auto_compact_context_warning',
            sessionId: session.id,
            errorCode: 'AUTO_COMPACT_FAILED',
            attributes: { error: e instanceof Error ? e.message : String(e) },
          });
        }
      }
    } else if (status === 'ask_question' && prevStatus !== 'ask_question') {
      this.deps.emitStatus?.(session.id, 'ask_question', result.interactiveContent || 'Session is asking a question');
      this.deps.statusChange(
        this.makePayload('status.question', session, result.interactiveContent || 'Session is asking a question'),
      );
    }

    if (status === 'working' && prevStatus !== 'working') {
      this.deps.emitStatus?.(session.id, 'working', 'Claude is working');
    }
  }

  /** Record that a session transitioned to the given status (for idle debounce tracking). */
  recordStatus(sessionId: string, status: UIState): void {
    if (status === 'idle') {
      if (!this.idleSince.has(sessionId)) {
        this.idleSince.set(sessionId, Date.now());
      }
    } else {
      this.idleSince.delete(sessionId);
      this.idleNotified.delete(sessionId);
    }
  }

  /** Remove all tracking for a session. */
  removeSession(sessionId: string): void {
    this.idleNotified.delete(sessionId);
    this.contextWarningCompacted.delete(sessionId);
    this.idleSince.delete(sessionId);
    const pending = this.statusChangeDebounce.get(sessionId);
    if (pending) {
      clearTimeout(pending);
      this.statusChangeDebounce.delete(sessionId);
    }
  }

  /** Clear context-warning compact tracking when a session goes idle (allows re-compact next time). */
  clearContextWarningCompact(sessionId: string): void {
    this.contextWarningCompacted.delete(sessionId);
  }
}
