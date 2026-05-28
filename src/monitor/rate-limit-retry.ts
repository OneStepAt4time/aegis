/**
 * rate-limit-retry.ts — Rate-limit detection and automatic retry with backoff.
 *
 * Extracted from SessionMonitor: handles rate-limit signals from CC,
 * coordinates exponential backoff retries across sessions, and
 * manages retry state tracking.
 */

import type { SessionInfo } from '../session-types.js';
import type { SessionEventPayload, SessionEvent } from '../channels/index.js';
import type { AlertManager, AlertType } from '../alerting.js';
import type { MetricsCollector } from '../metrics.js';
import type { AcpBackend } from '../services/acp/backend.js';
import { SYSTEM_TENANT } from '../config.js';
import { computeDelayMs } from '../retry.js';
import { RateLimitCoordinator } from '../rate-limit-coordinator.js';
import { logger } from '../logger.js';

/** Dependencies needed by RateLimitRetryHandler. */
export interface RateLimitRetryDeps {
  /** Build a standard event payload. */
  makePayload: (event: SessionEvent, session: SessionInfo, detail: string) => SessionEventPayload;
  /** Notify channels of status change. */
  statusChange: (payload: SessionEventPayload) => void;
  /** Record a failure for alerting. */
  alertFailure?: (type: AlertType, detail: string) => void;
  /** Track session failure in metrics. */
  metricsFailed?: (sessionId: string) => void;
  /** Mark session as rate-limited in stall detector. */
  markRateLimited: (sessionId: string) => void;
  /** Unmark session as rate-limited in stall detector. */
  unmarkRateLimited: (sessionId: string) => void;
}

/** Configuration for rate-limit retry behavior. */
export interface RateLimitRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * RateLimitRetryHandler manages automatic retry of rate-limited sessions
 * with exponential backoff and cross-session coordination.
 */
export class RateLimitRetryHandler {
  private retryAttempts = new Map<string, number>();
  private coordinator = new RateLimitCoordinator();

  constructor(
    private deps: RateLimitRetryDeps,
    private config: RateLimitRetryConfig,
    private acpBackend?: AcpBackend,
  ) {}

  /** Public getter for retry attempt tracking. */
  getRetryAttempts(): Map<string, number> { return this.retryAttempts; }

  /** Update dependency callbacks (e.g. after setAlertManager/setMetrics). */
  updateDeps(deps: Partial<RateLimitRetryDeps>): void {
    Object.assign(this.deps, deps);
  }

  /** Update the ACP backend (may be set after construction). */
  setAcpBackend(backend: AcpBackend): void {
    this.acpBackend = backend;
  }

  /** Expose the rate-limit coordinator for dequeue on session removal. */
  get rateLimitCoordinator(): RateLimitCoordinator {
    return this.coordinator;
  }

  /** Handle a rate-limit signal for a session. */
  async handleRateLimitSignal(session: SessionInfo, stopReason: string): Promise<void> {
    this.deps.markRateLimited(session.id);

    const retryAttempt = (this.retryAttempts.get(session.id) ?? 0) + 1;
    const { maxRetries, baseDelayMs, maxDelayMs } = this.config;

    if (this.acpBackend && retryAttempt <= maxRetries) {
      const delayMs = computeDelayMs(retryAttempt, baseDelayMs, maxDelayMs);
      this.retryAttempts.set(session.id, retryAttempt);

      this.deps.statusChange(
        this.deps.makePayload('status.rate_limited', session,
          `Claude API rate limited (${stopReason}). Retrying (${retryAttempt}/${maxRetries}) in ${Math.round(delayMs / 1000)}s…`),
      );

      logger.info({
        component: 'monitor',
        operation: 'rate_limit_retry',
        sessionId: session.id,
        attributes: { attempt: retryAttempt, maxRetries, delayMs, stopReason },
      });

      // Fire-and-forget: acquire slot → delay → restart → release
      const backend = this.acpBackend;
      const sid = session.id;
      const cwd = session.workDir;
      const tenantId = session.tenantId ?? SYSTEM_TENANT;
      const ownerKeyId = session.ownerKeyId ?? 'master';
      const coordinator = this.coordinator;

      coordinator.acquire(sid).then(() => {
        return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }).then(() => {
        return backend.restartSession({
          sessionId: sid,
          cwd,
          tenantId,
          ownerKeyId,
          reason: `rate_limit_retry_${retryAttempt}`,
        });
      }).then((result) => {
        logger.info({
          component: 'monitor',
          operation: 'rate_limit_retry_success',
          sessionId: sid,
          attributes: { attempt: retryAttempt, backoffDelayMs: result.backoffDelayMs },
        });
        this.deps.unmarkRateLimited(sid);
        coordinator.release(sid);
      }).catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error({
          component: 'monitor',
          operation: 'rate_limit_retry_failed',
          sessionId: sid,
          errorCode: 'RATE_LIMIT_RETRY_ERROR',
          attributes: { attempt: retryAttempt, error: errMsg },
        });
        coordinator.release(sid);

        if (retryAttempt >= maxRetries) {
          this.retryAttempts.delete(sid);
          this.deps.statusChange(
            this.deps.makePayload('status.error', { ...session, status: 'error' } as SessionInfo,
              `Rate-limit retry exhausted (${maxRetries}/${maxRetries}). Session requires manual intervention.`),
          );
          this.deps.alertFailure?.('session_failure',
            `Session "${session.displayName}" rate-limit retries exhausted: ${errMsg}`);
          this.deps.metricsFailed?.(sid);
        }
      });
    } else if (!this.acpBackend) {
      // No ACP backend — legacy notification only
      this.deps.statusChange(
        this.deps.makePayload('status.rate_limited', session,
          `Claude API rate limited (${stopReason}). Session will resume when the backoff window expires.`),
      );
    } else {
      // Retries exhausted
      this.retryAttempts.delete(session.id);
      this.deps.statusChange(
        this.deps.makePayload('status.error', session,
          `Rate-limit retry exhausted (${maxRetries}/${maxRetries}). Session requires manual intervention.`),
      );
      this.deps.alertFailure?.('session_failure',
        `Session "${session.displayName}" rate-limit retries exhausted`);
      this.deps.metricsFailed?.(session.id);
    }
  }

  /** Remove retry tracking for a session. */
  removeSession(sessionId: string): void {
    this.retryAttempts.delete(sessionId);
    this.coordinator.dequeue(sessionId);
  }
}
