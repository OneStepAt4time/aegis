/**
 * stall-detector.ts — Focused stall detection for Aegis sessions.
 *
 * Extracted from monitor.ts to isolate stall detection logic and state.
 * Detects 5 types of stalls:
 * 1. JSONL stall: "working" but no new JSONL bytes for stallThresholdMs
 * 2. Permission stall: permission_prompt/bash_approval for permissionStallMs
 * 3. Unknown stall: unknown state for unknownStallMs (CC stuck in transition)
 * 4. Extended state stall: any non-idle state for 2x stallThresholdMs
 * 5. Extended working stall: working for 3x stallThresholdMs (internal loop)
 */

import type { SessionInfo, UIState } from './session-types.js';
import { type SessionEventPayload, type SessionEvent } from './channels/index.js';
import { SYSTEM_TENANT } from './config.js';
import { retryWithJitter } from './retry.js';
import { logger } from './logger.js';

/** Stub: parse "Cogitated for Xm Ys" from status text. Returns duration in ms or null. */
function parseCogitatedDuration(_statusText: string): number | null {
  return null;
}

/** Configuration for stall detection thresholds and recovery. */
export interface StallDetectorConfig {
  /** Emit stall event after this long without new JSONL bytes while "working" */
  stallThresholdMs: number;
  /** Permission prompt stall threshold */
  permissionStallMs: number;
  /** Unknown state stall threshold */
  unknownStallMs: number;
  /** Auto-reject permission after this long */
  permissionTimeoutMs: number;
  /** Auto-recover stalled sessions via restart */
  stallRecoveryEnabled: boolean;
  /** Max restart attempts for stall recovery */
  stallRecoveryMaxRetries: number;
}

/** Callbacks the stall detector uses to interact with the outside world. */
export interface StallDetectorDeps {
  rejectSession: (sessionId: string) => Promise<void>;
  emitStall: (sessionId: string, stallType: string, detail: string) => void;
  statusChange: (payload: SessionEventPayload) => void;
  makePayload: (event: SessionEvent, session: SessionInfo, detail: string) => SessionEventPayload;
  alertFailure?: (type: string, detail: string) => void;
  metricsFailed?: (sessionId: string) => void;
  restartSession?: (params: {
    sessionId: string;
    cwd: string;
    tenantId: string;
    ownerKeyId: string;
    reason: string;
  }) => Promise<{ backoffDelayMs: number }>;
  /** Called when a session transitions to idle during stall detection. */
  onSessionIdle?: (sessionId: string) => void;
}

export class StallDetector {
  /** Thinking stall threshold multiplier — CC extended thinking gets 5x the normal stall threshold. */
  static readonly THINKING_STALL_MULTIPLIER = 5;

  /** Issue #663: Nested Map for O(1) per-session stall lookup. */
  readonly stallNotified = new Map<string, Set<string>>();
  readonly lastBytesSeen = new Map<string, { bytes: number; at: number }>();
  /** Smart stall detection: track when each non-working state started. */
  readonly stateSince = new Map<string, { state: string; since: number }>();
  readonly prevStatusForStall = new Map<string, UIState>();
  /** Sessions currently being recovered from stall. */
  readonly stallRecovering = new Set<string>();
  /** Sessions in rate-limit backoff (exempt from JSONL stall detection). */
  readonly rateLimitedSessions = new Set<string>();

  constructor(
    private config: StallDetectorConfig,
    private deps: StallDetectorDeps,
  ) {}

  /** Update dependency callbacks (e.g. after setEventBus/setAlertManager/setMetrics). */
  updateDeps(deps: Partial<StallDetectorDeps>): void {
    Object.assign(this.deps, deps);
  }

  /** Update the restartSession callback without resetting accumulated state. */
  setRestartSession(restartSession: StallDetectorDeps['restartSession']): void {
    this.deps.restartSession = restartSession;
  }

  /** Issue #663: O(1) stall notification check. */
  stallHas(sessionId: string, stallType: string): boolean {
    return this.stallNotified.get(sessionId)?.has(stallType) ?? false;
  }

  /** Issue #663: O(1) stall notification add. */
  stallAdd(sessionId: string, stallType: string): void {
    const set = this.stallNotified.get(sessionId);
    if (set) { set.add(stallType); } else { this.stallNotified.set(sessionId, new Set([stallType])); }
  }

  /** Issue #663: O(1) stall notification delete. */
  stallDelete(sessionId: string, stallType: string): void {
    this.stallNotified.get(sessionId)?.delete(stallType);
  }

  /** Issue #663: Delete all stall notifications for a session. */
  stallDeleteAll(sessionId: string): void {
    this.stallNotified.delete(sessionId);
  }

  /** Issue #663: Delete specific stall types for a session. */
  stallDeleteTypes(sessionId: string, types: string[]): void {
    const set = this.stallNotified.get(sessionId);
    if (!set) return;
    for (const t of types) set.delete(t);
  }

  /** Return active stall types for a session, or null if not stalled. */
  getStallInfo(sessionId: string): { stalled: true; types: string[] } | { stalled: false } {
    const types = this.stallNotified.get(sessionId);
    if (!types || types.size === 0) return { stalled: false };
    return { stalled: true, types: [...types] };
  }

  /** Clean up all stall tracking for a removed/killed session. */
  removeSession(sessionId: string): void {
    this.lastBytesSeen.delete(sessionId);
    this.rateLimitedSessions.delete(sessionId);
    this.stallRecovering.delete(sessionId);
    this.stallDeleteAll(sessionId);
    this.stateSince.delete(sessionId);
    this.prevStatusForStall.delete(sessionId);
  }

  /**
   * Run stall detection across all sessions.
   * Called periodically by the monitor loop.
   */
  async check(
    sessions: Iterable<SessionInfo>,
    lastStatus: Map<string, UIState>,
    lastStatusText: Map<string, string | null>,
    now: number,
  ): Promise<void> {
    for (const session of sessions) {
      const currentStatus = lastStatus.get(session.id);
      const prevStallStatus = this.prevStatusForStall.get(session.id);

      // Track state transitions — one entry per session, preserving timer across
      // permission_prompt ↔ bash_approval transitions (both are "permission" states)
      if (currentStatus && currentStatus !== 'idle') {
        const entry = this.stateSince.get(session.id);
        if (!entry) {
          this.stateSince.set(session.id, { state: currentStatus, since: now });
        } else if (entry.state !== currentStatus) {
          const isPermState = (s: string): boolean => s === 'permission_prompt' || s === 'bash_approval';
          if (isPermState(entry.state) && isPermState(currentStatus)) {
            entry.state = currentStatus; // preserve since across permission sub-type transitions
          } else {
            this.stateSince.set(session.id, { state: currentStatus, since: now });
          }
        }
      }

      // --- Type 1: JSONL stall (working but no output) ---
      if (currentStatus === 'working') {
        // Skip stall detection for rate-limited sessions — CC is in backoff
        if (this.rateLimitedSessions.has(session.id)) {
          continue;
        }

        const prev = this.lastBytesSeen.get(session.id);
        const currentBytes = session.monitorOffset;

        if (!prev) {
          this.lastBytesSeen.set(session.id, { bytes: currentBytes, at: now });
          continue;
        }

        if (currentBytes > prev.bytes) {
          this.lastBytesSeen.set(session.id, { bytes: currentBytes, at: now });
          this.stallDelete(session.id, 'jsonl');
          this.stallDelete(session.id, 'thinking');
        } else {
          const stallDuration = now - prev.at;
          const baseThreshold = session.stallThresholdMs || this.config.stallThresholdMs;

          // Issue #1324: CC extended thinking ("Cogitated for Xm Ys") is legitimate work
          // but produces no JSONL bytes. Use a longer threshold before flagging as stalled.
          const statusText = lastStatusText.get(session.id) ?? null;
          const thinkingDuration = statusText ? parseCogitatedDuration(statusText) : null;

          if (thinkingDuration !== null) {
            // CC is in extended thinking mode — use 5x the normal stall threshold
            const thinkingThreshold = baseThreshold * StallDetector.THINKING_STALL_MULTIPLIER;
            if (stallDuration >= thinkingThreshold && !this.stallHas(session.id, 'thinking')) {
              this.stallAdd(session.id, 'thinking');
              const minutes = Math.round(thinkingDuration / 60000);
              const detail = `Session stalled: CC extended thinking for ${minutes}min with no output. ` +
                  `Status: "${statusText}". Consider: POST /v1/sessions/${session.id}/interrupt or /kill`;
              this.deps.emitStall(session.id, 'thinking', detail);
              this.deps.statusChange(
                this.deps.makePayload('status.stall', session, detail),
              );
            }
          } else {
            // Normal JSONL stall detection
            if (stallDuration >= baseThreshold && !this.stallHas(session.id, 'jsonl')) {
              this.stallAdd(session.id, 'jsonl');
              const minutes = Math.round(stallDuration / 60000);
              const detail = `Session stalled: "working" for ${minutes}min with no new output. ` +
                  `Last activity: ${new Date(session.lastActivity).toISOString()}`;
              this.deps.emitStall(session.id, 'jsonl', detail);
              this.deps.statusChange(
                this.deps.makePayload('status.stall', session, detail),
              );
              // Issue #3752: Attempt auto-recovery for JSONL stall
              this.attemptStallRecovery(session, 'jsonl');
            }
          }
        }
      } else {
        // Reset JSONL and thinking stall tracking when not working
        this.stallDelete(session.id, 'jsonl');
        this.stallDelete(session.id, 'thinking');
      }

      // --- Type 2: Permission stall (waiting for approval too long) ---
      if (currentStatus === 'permission_prompt' || currentStatus === 'bash_approval') {
        const entry = this.stateSince.get(session.id);
        const permDuration = entry ? now - entry.since : 0;
        if (permDuration >= this.config.permissionStallMs) {
          if (!this.stallHas(session.id, 'permission')) {
            this.stallAdd(session.id, 'permission');
            const minutes = Math.round(permDuration / 60000);
            const detail = `Session stalled: waiting for permission approval for ${minutes}min. ` +
                `Auto-approve this session or POST /v1/sessions/${session.id}/approve`;
            this.deps.emitStall(session.id, 'permission', detail);
            this.deps.statusChange(
              this.deps.makePayload('status.stall', session, detail),
            );
          }
        }
        // L9: Auto-reject permission after timeout
        if (permDuration >= this.config.permissionTimeoutMs) {
          if (!this.stallHas(session.id, 'permission_timeout')) {
            this.stallAdd(session.id, 'permission_timeout');
            const minutes = Math.round(permDuration / 60000);
            logger.warn({
              component: 'stall-detector',
              operation: 'permission_timeout_auto_reject',
              sessionId: session.id,
              errorCode: 'PERMISSION_TIMEOUT',
              attributes: { displayName: session.displayName, timeoutMinutes: minutes },
            });
            try {
              await this.deps.rejectSession(session.id);
              const detail = `Permission auto-rejected after ${minutes}min timeout (session ${session.displayName})`;
              this.deps.emitStall(session.id, 'permission_timeout', detail);
              this.deps.statusChange(
                this.deps.makePayload('status.permission_timeout', session, detail),
              );
            } catch (e: unknown) {
              logger.error({
                component: 'stall-detector',
                operation: 'permission_timeout_auto_reject',
                sessionId: session.id,
                errorCode: 'AUTO_REJECT_FAILED',
                attributes: { error: e instanceof Error ? e.message : String(e) },
              });
            }
          }
        }
      }

      // --- Type 3: Unknown stall (CC stuck in transition) ---
      if (currentStatus === 'unknown') {
        const entry = this.stateSince.get(session.id);
        const unkDuration = entry ? now - entry.since : 0;
        if (unkDuration >= this.config.unknownStallMs) {
          if (!this.stallHas(session.id, 'unknown')) {
            this.stallAdd(session.id, 'unknown');
            const minutes = Math.round(unkDuration / 60000);
            const detail = `Session stalled: in "unknown" state for ${minutes}min. ` +
                `CC may be stuck. Try: POST /v1/sessions/${session.id}/interrupt or /kill`;
            this.deps.emitStall(session.id, 'unknown', detail);
            this.deps.statusChange(
              this.deps.makePayload('status.stall', session, detail),
            );
          }
        }
      }

      // --- Type 4: Extended state stall (any state held too long) ---
      if (currentStatus && currentStatus !== 'idle' && currentStatus !== 'working') {
        const entry = this.stateSince.get(session.id);
        const stateDuration = entry ? now - entry.since : 0;
        const extendedThreshold = this.config.stallThresholdMs * 2;
        if (stateDuration >= extendedThreshold) {
          if (!this.stallHas(session.id, 'extended')) {
            this.stallAdd(session.id, 'extended');
            const minutes = Math.round(stateDuration / 60000);
            const detail = `Session stalled: "${currentStatus}" state for ${minutes}min. ` +
                `May need intervention: /interrupt, /approve, or /kill`;
            this.deps.emitStall(session.id, 'extended', detail);
            this.deps.statusChange(
              this.deps.makePayload('status.stall', session, detail),
            );
          }
        }
      }

      // --- Type 5: Extended working stall (working too long regardless of byte changes, ---
      // Catches CC stuck in "Misting" state where internal loop detection
      if (currentStatus === 'working') {
        const entry = this.stateSince.get(session.id);
        if (entry && entry.state === 'working') {
          const workingDuration = now - entry.since;
          const maxWorkingMs = this.config.stallThresholdMs * 3; // 15 min default
          if (workingDuration >= maxWorkingMs && !this.stallHas(session.id, 'extended_working')) {
            this.stallAdd(session.id, 'extended_working');
            const minutes = Math.round(workingDuration / 60000);
            const detail = `Session stalled: in "working" state for ${minutes}min. ` +
              `CC may be stuck in an internal loop (e.g., Misting). Consider: POST /v1/sessions/${session.id}/interrupt or /kill`;
            this.deps.emitStall(session.id, 'extended_working', detail);
            this.deps.statusChange(
              this.deps.makePayload('status.stall', session, detail),
            );
            // Issue #3752: Attempt auto-recovery for extended working stall
            this.attemptStallRecovery(session, 'extended_working');
          }
        }
      }

      // Clean up stall notifications on state transitions (using prevStallStatus)
      if (prevStallStatus && prevStallStatus !== currentStatus) {
        const exitedPermission = prevStallStatus === 'permission_prompt' || prevStallStatus === 'bash_approval';
        const exitedUnknown = prevStallStatus === 'unknown';

        if (exitedPermission) {
          this.stallDeleteTypes(session.id, ['permission', 'permission_timeout']);
        }
        if (exitedUnknown) {
          this.stallDelete(session.id, 'unknown');
        }
      }

      // Clean up all state tracking when idle (catch-all)
      if (currentStatus === 'idle') {
        this.rateLimitedSessions.delete(session.id);
        this.stateSince.delete(session.id);
        // Clean stall notifications (session recovered) — O(1) with Map
        this.stallDeleteAll(session.id);
        // Notify monitor to clean up its own non-stall state (e.g. contextWarningCompacted)
        this.deps.onSessionIdle?.(session.id);
      }

      // Update prevStatusForStall for next cycle
      if (currentStatus) {
        this.prevStatusForStall.set(session.id, currentStatus);
      } else {
        this.prevStatusForStall.delete(session.id);
      }
    }
  }

  /**
   * Issue #3752: Attempt stall recovery via ACP backend restart.
   * Issue #4802 (F-4): Per-session kill-switch — when session.recoveryDisabled
   *   is true, skip the restart and surface an audit log/notification so the
   *   operator can see the recovery was paused (not silently swallowed).
   * Uses retryWithJitter for the restart attempt.
   * Fire-and-forget to avoid blocking the monitor loop.
   */
  attemptStallRecovery(session: SessionInfo, stallType: string): void {
    if (!this.config.stallRecoveryEnabled) return;
    if (!this.deps.restartSession) return;
    if (this.stallRecovering.has(session.id)) return; // Already recovering

    // F-4: per-session kill-switch. Survives restart via SessionInfo persistence
    // (per Daedalus Cycle-1.5). When true, no recovery fires; we surface the
    // paused state to the operator instead.
    if (session.recoveryDisabled) {
      logger.info({
        component: 'stall-detector',
        operation: 'stall_recovery_skipped_killswitch',
        sessionId: session.id,
        attributes: { stallType, displayName: session.displayName },
      });
      this.deps.statusChange(
        this.deps.makePayload('status.stall', session,
          `Stall recovery skipped (${stallType}): per-session kill-switch active. Recovery disabled on this session.`),
      );
      return;
    }

    this.stallRecovering.add(session.id);

    const maxRetries = this.config.stallRecoveryMaxRetries;
    const restartSession = this.deps.restartSession;
    const sid = session.id;
    const cwd = session.workDir;
    const tenantId = session.tenantId ?? SYSTEM_TENANT;
    const ownerKeyId = session.ownerKeyId ?? 'master';
    const displayName = session.displayName;

    logger.info({
      component: 'stall-detector',
      operation: 'stall_recovery_start',
      sessionId: sid,
      attributes: { stallType, displayName },
    });

    this.deps.statusChange(
      this.deps.makePayload('status.stall', session,
        `Stall recovery (${stallType}): restarting...`),
    );

    // Fire-and-forget recovery
    retryWithJitter(
      () => restartSession({
        sessionId: sid,
        cwd,
        tenantId,
        ownerKeyId,
        reason: `stall_recovery_${stallType}`,
      }),
      {
        maxAttempts: maxRetries,
        baseDelayMs: 2_000,
        maxDelayMs: 10_000,
        onRetry: (_err: unknown, attempt: number, delayMs: number) => {
          logger.info({
            component: 'stall-detector',
            operation: 'stall_recovery_retry',
            sessionId: sid,
            attributes: { attempt, delayMs },
          });
        },
      },
    ).then((result) => {
      logger.info({
        component: 'stall-detector',
        operation: 'stall_recovery_success',
        sessionId: sid,
        attributes: { backoffDelayMs: result.backoffDelayMs },
      });
      this.rateLimitedSessions.delete(sid);
      this.stallRecovering.delete(sid);
      this.stallDeleteAll(sid);
      this.deps.statusChange(
        this.deps.makePayload('status.stall', { ...session, status: 'idle' } as SessionInfo,
          `Stall recovery OK — session restarted.`),
      );
    }).catch((err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({
        component: 'stall-detector',
        operation: 'stall_recovery_failed',
        sessionId: sid,
        errorCode: 'STALL_RECOVERY_ERROR',
        attributes: { error: errMsg },
      });
      this.stallRecovering.delete(sid);
      this.deps.statusChange(
        this.deps.makePayload('status.stall', session,
          `Stall recovery failed: ${errMsg}`),
      );
      this.deps.alertFailure?.('session_failure',
        `Session "${displayName}" stall recovery failed: ${errMsg}`);
      this.deps.metricsFailed?.(sid);
    });
  }
}
