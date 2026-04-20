/**
 * alerting.ts — Production alerting for session failures, tmux crashes, and API errors.
 *
 * Issue #1418: Tracks failure events and fires alert webhooks when configurable
 * thresholds are exceeded. Uses a cooldown window to prevent alert fatigue.
 */

import crypto from 'node:crypto';
import { logger } from './logger.js';
import { validateWebhookUrl, resolveAndCheckIp } from './ssrf.js';

/** Supported alert types. */
export type AlertType = 'session_failure' | 'tmux_crash' | 'api_error_rate';

/** An alert event ready for delivery. */
export interface AlertEvent {
  type: AlertType;
  timestamp: string;
  detail: string;
  /** Current count of failures in the tracking window. */
  failureCount: number;
  /** Configured threshold that triggered the alert. */
  threshold: number;
}

/** Configuration for the AlertManager. */
export interface AlertingConfig {
  /** Webhook URLs for alert notifications. */
  webhooks: string[];
  /** Number of consecutive failures before triggering an alert. */
  failureThreshold: number;
  /** Cooldown period in ms between alerts for the same type. */
  cooldownMs: number;  /** Issue #1911: Outgoing alert webhook fetch timeout in ms (default: 10_000). Env: AEGIS_HOOK_TIMEOUT_MS */
  hookTimeoutMs: number;}

/** Per-type failure tracking state. */
interface FailureTracker {
  count: number;
  windowStart: number;
  lastAlertAt: number;
}

const DEFAULT_CONFIG: AlertingConfig = {
  webhooks: [],
  failureThreshold: 5,
  cooldownMs: 10 * 60 * 1000,
  hookTimeoutMs: 10_000,
};

export class AlertManager {
  private config: AlertingConfig;
  private trackers = new Map<AlertType, FailureTracker>();
  private delivered = 0;
  private failed = 0;

  constructor(config: Partial<AlertingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Update configuration at runtime (e.g. from config reload). */
  updateConfig(config: Partial<AlertingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Get current configuration. */
  getConfig(): Readonly<AlertingConfig> {
    return this.config;
  }

  /**
   * Record a failure event. If the failure count for the given type exceeds
   * the threshold and the cooldown has elapsed, fire an alert webhook.
   */
  recordFailure(type: AlertType, detail: string): void {
    if (this.config.webhooks.length === 0) return;

    const now = Date.now();
    const tracker = this.getOrCreateTracker(type);

    // Reset window if older than cooldown (stale window)
    const windowDuration = this.config.cooldownMs;
    if (now - tracker.windowStart > windowDuration) {
      tracker.count = 0;
      tracker.windowStart = now;
    }

    tracker.count++;

    if (tracker.count >= this.config.failureThreshold && (now - tracker.lastAlertAt) >= this.config.cooldownMs) {
      tracker.lastAlertAt = now;
      const event: AlertEvent = {
        type,
        timestamp: new Date().toISOString(),
        detail,
        failureCount: tracker.count,
        threshold: this.config.failureThreshold,
      };
      // Fire-and-forget — don't block the caller
      void this.fireAlert(event).catch(e => {
        logger.error({
          component: 'alerting',
          operation: 'fire_alert',
          errorCode: 'ALERT_DELIVERY_FAILED',
          attributes: { alertType: type, error: e instanceof Error ? e.message : String(e) },
        });
      });
    }
  }

  /**
   * Manually fire a test alert (for POST /v1/alerts/test endpoint).
   * Returns the response from the first webhook that succeeds, or throws if all fail.
   */
  async fireTestAlert(): Promise<{ sent: boolean; webhookCount: number }> {
    if (this.config.webhooks.length === 0) {
      return { sent: false, webhookCount: 0 };
    }
    const event: AlertEvent = {
      type: 'session_failure',
      timestamp: new Date().toISOString(),
      detail: 'Test alert from POST /v1/alerts/test',
      failureCount: 1,
      threshold: this.config.failureThreshold,
    };
    await this.fireAlert(event);
    return { sent: true, webhookCount: this.config.webhooks.length };
  }

  /** Get alert statistics. */
  getStats(): { delivered: number; failed: number; trackers: Record<string, { count: number; lastAlertAt: number }> } {
    const trackers: Record<string, { count: number; lastAlertAt: number }> = {};
    for (const [type, tracker] of this.trackers) {
      trackers[type] = { count: tracker.count, lastAlertAt: tracker.lastAlertAt };
    }
    return { delivered: this.delivered, failed: this.failed, trackers };
  }

  /** Reset all tracking state. */
  reset(): void {
    this.trackers.clear();
    this.delivered = 0;
    this.failed = 0;
  }

  private getOrCreateTracker(type: AlertType): FailureTracker {
    let tracker = this.trackers.get(type);
    if (!tracker) {
      tracker = { count: 0, windowStart: Date.now(), lastAlertAt: 0 };
      this.trackers.set(type, tracker);
    }
    return tracker;
  }

  private async fireAlert(event: AlertEvent): Promise<void> {
    const body = JSON.stringify({
      event: 'alert',
      ...event,
      source: 'aegis',
    });

    const results = await Promise.allSettled(
      this.config.webhooks.map(url => this.deliverToWebhook(url, body, event.type)),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        this.delivered++;
      } else {
        this.failed++;
      }
    }

    const failedCount = results.filter(r => r.status === 'rejected').length;
    if (failedCount > 0) {
      logger.warn({
        component: 'alerting',
        operation: 'fire_alert',
        errorCode: 'ALERT_PARTIAL_FAILURE',
        attributes: { alertType: event.type, failed: failedCount, total: results.length },
      });
    }
  }

  private async deliverToWebhook(url: string, body: string, alertType: AlertType): Promise<void> {
    const urlError = validateWebhookUrl(url);
    if (urlError) {
      throw new Error(`Invalid alert webhook URL: ${urlError}`);
    }

    const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');

    // DNS rebinding protection for non-localhost URLs
    let fetchUrl = url;
    if (hostname !== '127.0.0.1' && hostname !== '::1' && hostname !== 'localhost') {
      const dnsResult = await resolveAndCheckIp(hostname);
      if (dnsResult.error) {
        throw new Error(`DNS check failed for alert webhook: ${dnsResult.error}`);
      }
    }

    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Aegis-Alert-Type': alertType,
      },
      body,
      signal: AbortSignal.timeout(this.config.hookTimeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Alert webhook returned HTTP ${res.status}`);
    }
  }
}
