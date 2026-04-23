/**
 * channels/webhook.ts — Generic webhook notification channel.
 *
 * Fires HTTP POST to configured URLs on session events.
 * Configure via AEGIS_WEBHOOKS (or legacy MANUS_WEBHOOKS) env var or config file.
 */

import type {
  Channel,
  SessionEvent,
  SessionEventPayload,
} from './types.js';
import { webhookEndpointSchema, getErrorMessage } from '../validation.js';
import { validateWebhookUrl, resolveAndCheckIp, buildConnectionUrl } from '../ssrf.js';
import { redactSecretsFromText } from '../utils/redact-headers.js';
import { RetriableError } from './manager.js';
import { signPayload } from '../webhook-signature.js';
import crypto from 'node:crypto';

export interface WebhookEndpoint {
  /** URL to POST to. */
  url: string;
  /** Filter: only fire on these events. Omit = all events. */
  events?: SessionEvent[];
  /** Custom headers (e.g. Authorization). */
  headers?: Record<string, string>;
  /** Timeout in ms (default: 5000). */
  timeoutMs?: number;
  /** HMAC-SHA256 signing secret. If set, outbound requests include X-Aegis-Signature header. */
  secret?: string;
  /** E5-6: Redact message content from webhook payloads. When true, detail field is replaced with [REDACTED]. */
  redactContent?: boolean;
}

export interface WebhookChannelConfig {
  endpoints: WebhookEndpoint[];
}

/** Dead letter queue entry for a failed webhook delivery. */
export interface DeadLetterEntry {
  timestamp: string;
  endpoint: string;
  event: SessionEvent;
  error: string;
  attempts: number;
}

/** Delivery attempt status (Issue #2144). */
export type DeliveryStatus = 'pending' | 'success' | 'failed';

/** Record of a single webhook delivery attempt (Issue #2144). */
export interface WebhookDeliveryAttempt {
  id: string;
  endpointUrl: string;
  event: SessionEvent;
  status: DeliveryStatus;
  responseCode: number | null;
  error: string | null;
  timestamp: string;
  attemptNumber: number;
}

export class WebhookChannel implements Channel {
  readonly name = 'webhook';

  private endpoints: WebhookEndpoint[];

  /** Issue #89 L14: In-memory dead letter queue for failed deliveries. Max 100 items. */
  private deadLetterQueue: DeadLetterEntry[] = [];
  static readonly DLQ_MAX_SIZE = 100;

  /** Issue #2144: In-memory delivery attempt log. Max 1000 entries. */
  private deliveryLog: WebhookDeliveryAttempt[] = [];
  static readonly DELIVERY_LOG_MAX_SIZE = 1000;

  constructor(config: WebhookChannelConfig) {
    this.endpoints = config.endpoints;
  }

  /** Create from AEGIS_WEBHOOKS (or legacy MANUS_WEBHOOKS) env var. Returns null if not set or invalid. */
  static fromEnv(): WebhookChannel | null {
    const raw = process.env.AEGIS_WEBHOOKS ?? process.env.MANUS_WEBHOOKS;
    if (!raw) return null;
    try {
      const parsed: unknown[] = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return null;

      // Validate each endpoint with Zod schema + SSRF URL check
      const endpoints: WebhookEndpoint[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const result = webhookEndpointSchema.safeParse(parsed[i]);
        if (!result.success) {
          console.error(`Webhook URL validation failed for endpoint ${i}: schema error`, result.error.message);
          return null;
        }
        const urlError = validateWebhookUrl(result.data.url);
        if (urlError) {
          console.error(`Webhook URL validation failed for endpoint ${i}: ${urlError}`, result.data.url);
          return null;
        }
        endpoints.push(result.data as WebhookEndpoint);
      }
      return new WebhookChannel({ endpoints });
    } catch (e) {
      console.error('Failed to parse AEGIS_WEBHOOKS:', e);
      return null;
    }
  }

  filter(event: SessionEvent): boolean {
    // Accept if ANY endpoint wants this event
    return this.endpoints.some(
      ep => !ep.events || ep.events.length === 0 || ep.events.includes(event),
    );
  }

  async onSessionCreated(payload: SessionEventPayload): Promise<void> {
    await this.fire(payload);
  }

  async onSessionEnded(payload: SessionEventPayload): Promise<void> {
    await this.fire(payload);
  }

  async onMessage(payload: SessionEventPayload): Promise<void> {
    await this.fire(payload);
  }

  async onStatusChange(payload: SessionEventPayload): Promise<void> {
    await this.fire(payload);
  }

  /** Issue #2144: Maximum retry attempts per webhook delivery. */
  static readonly MAX_RETRIES = 3;

  /** Issue #2144: Fixed retry delay schedule (ms): 1s, 5s, 30s. */
  static readonly RETRY_DELAYS_MS = [1000, 5000, 30000];

  /** Issue #2144: Base delay kept for backward compat (tests). */
  static readonly BASE_DELAY_MS = 1000;

  /** Issue #2144: Fixed retry delay for the given attempt (0-indexed retry number). */
  static backoff(attempt: number): number {
    return WebhookChannel.RETRY_DELAYS_MS[Math.min(attempt - 1, WebhookChannel.RETRY_DELAYS_MS.length - 1)];
  }

  /** Redact sensitive session metadata from webhook payloads. */
  private static redactSessionMeta(
    payload: SessionEventPayload,
  ): Record<string, unknown> {
    const { session, ...rest } = payload;
    return {
      ...rest,
      session: {
        id: session.id,  // Not a secret — safe to expose
        name: session.name,  // Not a secret — safe to expose
        workDir: '[REDACTED]',  // Contains filesystem paths — redact
      },
    };
  }

  /** Build webhook payload, applying per-endpoint redaction rules. */
  private buildPayload(
    payload: SessionEventPayload,
    ep: WebhookEndpoint,
  ): Record<string, unknown> {
    const base = WebhookChannel.redactSessionMeta(payload);
    // E5-6: When redactContent is enabled, replace message detail with [REDACTED]
    // This prevents LLM-generated content with secrets/PII from reaching webhook receivers
    if (ep.redactContent) {
      base['detail'] = '[REDACTED]';
      // Also redact meta content if it contains message data
      if (base['meta']) {
        base['meta'] = '[REDACTED]';
      }
    }
    return base;
  }

  private async fire(payload: SessionEventPayload): Promise<void> {
    const promises = this.endpoints.map(async ep => {
      // Skip if endpoint filters and this event isn't in the list
      if (ep.events && ep.events.length > 0 && !ep.events.includes(payload.event)) return;

      // E5-6: Build per-endpoint body with its redaction settings
      const body = JSON.stringify(this.buildPayload(payload, ep));

      await this.deliverWithRetry(ep, body, payload.event);
    });

    const results = await Promise.allSettled(promises);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed.length > 0) {
      const reasons = failed.map(r => String(r.reason)).join('; ');
      const allFailed = failed.length === results.length;
      if (allFailed) {
        console.error(`Webhook: ${failed.length}/${results.length} endpoint(s) failed (total): ${reasons}`);
      } else {
        console.warn(`Webhook: ${failed.length}/${results.length} endpoint(s) failed: ${reasons}`);
      }
    }
  }

  /** Issue #25/#2144: Deliver webhook with retry + fixed backoff delays. */
  private async deliverWithRetry(
    ep: WebhookEndpoint,
    body: string,
    event: SessionEvent,
    maxRetries: number = WebhookChannel.MAX_RETRIES,
  ): Promise<void> {
    let lastError = '';
    const hostname = new URL(ep.url).hostname;
    const bareHost = hostname.replace(/^\[|\]$/g, '');
    const deliveryId = crypto.randomUUID();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // DNS rebinding protection: resolve and validate IP before each fetch.
        // Skip for literal IPs (already validated at config time).
        let fetchUrl = ep.url;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(ep.headers || {}),
        };
        // E5-4: HMAC-SHA256 signing with timestamp — compute signature before DNS check (body must match)
        if (ep.secret) {
          const { signatureHeader } = signPayload(body, ep.secret);
          headers['X-Aegis-Signature'] = signatureHeader;
        }
        if (bareHost !== '127.0.0.1' && bareHost !== '::1' && bareHost !== 'localhost') {
          const dnsResult = await resolveAndCheckIp(bareHost);
          if (dnsResult.error) {
            lastError = dnsResult.error;
            // Issue #2144: Record failed attempt
            this.recordDelivery({
              id: deliveryId, endpointUrl: ep.url, event,
              status: 'failed', responseCode: null, error: lastError,
              timestamp: new Date().toISOString(), attemptNumber: attempt,
            });
            if (attempt < maxRetries) {
              const delay = WebhookChannel.backoff(attempt);
              console.warn(`Webhook ${ep.url} DNS check failed for ${event} (attempt ${attempt}/${maxRetries}): ${lastError}, retrying in ${Math.round(delay)}ms`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
            console.error(`Webhook ${ep.url} DNS check failed after ${maxRetries} attempts for ${event}: ${lastError}`);
            this.addToDeadLetterQueue(ep.url, event, lastError, maxRetries);
            throw new RetriableError(lastError);
          }
          if (dnsResult.resolvedIp) {
            const { connectionUrl, hostHeader } = buildConnectionUrl(ep.url, dnsResult.resolvedIp);
            fetchUrl = connectionUrl;
            headers['Host'] = hostHeader;
          }
        }

        const res = await fetch(fetchUrl, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(ep.timeoutMs || 5000),
        });

        if (res.ok) {
          // Issue #2144: Record successful attempt
          this.recordDelivery({
            id: deliveryId, endpointUrl: ep.url, event,
            status: 'success', responseCode: res.status, error: null,
            timestamp: new Date().toISOString(), attemptNumber: attempt,
          });
          return;
        }

        lastError = `HTTP ${res.status}`;
        // Issue #2144: Record failed attempt
        this.recordDelivery({
          id: deliveryId, endpointUrl: ep.url, event,
          status: 'failed', responseCode: res.status, error: lastError,
          timestamp: new Date().toISOString(), attemptNumber: attempt,
        });

        // Issue #2144: Retry on 429 (rate limit) or 5xx (server error)
        const isRetryable = res.status === 429 || res.status >= 500;
        if (isRetryable && attempt < maxRetries) {
          const delay = WebhookChannel.backoff(attempt);
          console.warn(`Webhook ${ep.url} returned ${res.status} for ${event} (attempt ${attempt}/${maxRetries}), retrying in ${Math.round(delay)}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        console.error(`Webhook ${ep.url} returned ${res.status} for ${event} (attempt ${attempt}/${maxRetries})`);
        // Issue #89 L14: Only add to DLQ for 5xx (server) errors, not 4xx client errors
        if (res.status >= 500) {
          this.addToDeadLetterQueue(ep.url, event, lastError, attempt);
        }
      } catch (e: unknown) {
        lastError = redactSecretsFromText(getErrorMessage(e), ep.headers);
        // Issue #2144: Record failed attempt
        this.recordDelivery({
          id: deliveryId, endpointUrl: ep.url, event,
          status: 'failed', responseCode: null, error: lastError,
          timestamp: new Date().toISOString(), attemptNumber: attempt,
        });
        if (attempt < maxRetries) {
          const delay = WebhookChannel.backoff(attempt);
          console.warn(`Webhook ${ep.url} error for ${event} (attempt ${attempt}/${maxRetries}): ${lastError}, retrying in ${Math.round(delay)}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.error(`Webhook ${ep.url} failed after ${maxRetries} attempts for ${event}: ${lastError}`);
        this.addToDeadLetterQueue(ep.url, event, lastError, maxRetries);
      }
      // Final failure — throw so fire() can aggregate.
      // Use RetriableError for 5xx/network (circuit breaker counts these),
      // plain Error for 4xx (circuit breaker ignores these).
      if (lastError.startsWith('HTTP ') && parseInt(lastError.slice(5)) < 500) {
        throw new Error(lastError);
      }
      throw new RetriableError(lastError);
    }
  }

  /** Issue #89 L14: Add a failed delivery to the dead letter queue. */
  private addToDeadLetterQueue(endpoint: string, event: SessionEvent, error: string, attempts: number): void {
    const entry: DeadLetterEntry = {
      timestamp: new Date().toISOString(),
      endpoint,
      event,
      error,
      attempts,
    };
    this.deadLetterQueue.push(entry);
    // Evict oldest entries if over max size
    if (this.deadLetterQueue.length > WebhookChannel.DLQ_MAX_SIZE) {
      this.deadLetterQueue = this.deadLetterQueue.slice(-WebhookChannel.DLQ_MAX_SIZE);
    }
    console.warn(`Webhook DLQ: added failed delivery for ${event} to ${endpoint} after ${attempts} attempts`);
  }

  /** Issue #89 L14: Get all entries in the dead letter queue. */
  getDeadLetterQueue(): DeadLetterEntry[] {
    return [...this.deadLetterQueue];
  }

  /** Issue #89 L14: Clear the dead letter queue. Returns number of entries cleared. */
  clearDeadLetterQueue(): number {
    const count = this.deadLetterQueue.length;
    this.deadLetterQueue = [];
    return count;
  }

  /** Issue #2144: Record a delivery attempt to the audit log. */
  private recordDelivery(entry: WebhookDeliveryAttempt): void {
    this.deliveryLog.push(entry);
    if (this.deliveryLog.length > WebhookChannel.DELIVERY_LOG_MAX_SIZE) {
      this.deliveryLog = this.deliveryLog.slice(-WebhookChannel.DELIVERY_LOG_MAX_SIZE);
    }
  }

  /** Issue #2144: Get delivery history, optionally filtered by endpoint URL. */
  getDeliveryLog(endpointUrl?: string): WebhookDeliveryAttempt[] {
    if (endpointUrl) {
      return this.deliveryLog.filter(d => d.endpointUrl === endpointUrl);
    }
    return [...this.deliveryLog];
  }

  /** Issue #2144: Get configured endpoints with their index-based IDs. */
  getEndpoints(): Array<{ id: string; url: string }> {
    return this.endpoints.map((ep, i) => ({ id: String(i), url: ep.url }));
  }
}
