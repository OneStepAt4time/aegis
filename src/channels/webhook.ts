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
import { validateWebhookUrl } from '../ssrf.js';
import { redactSecretsFromText } from '../utils/redact-headers.js';

export interface WebhookEndpoint {
  /** URL to POST to. */
  url: string;
  /** Filter: only fire on these events. Omit = all events. */
  events?: SessionEvent[];
  /** Custom headers (e.g. Authorization). */
  headers?: Record<string, string>;
  /** Timeout in ms (default: 5000). */
  timeoutMs?: number;
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

export class WebhookChannel implements Channel {
  readonly name = 'webhook';

  private endpoints: WebhookEndpoint[];

  /** Issue #89 L14: In-memory dead letter queue for failed deliveries. Max 100 items. */
  private deadLetterQueue: DeadLetterEntry[] = [];
  static readonly DLQ_MAX_SIZE = 100;

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

  /** Maximum retry attempts per webhook delivery. */
  static readonly MAX_RETRIES = 5;

  /** Base delay for exponential backoff (ms). */
  static readonly BASE_DELAY_MS = 1000;

  /** Exponential backoff with jitter: delay * (0.5 + Math.random() * 0.5). */
  static backoff(attempt: number): number {
    const base = WebhookChannel.BASE_DELAY_MS * Math.pow(2, attempt - 1);
    return base * (0.5 + Math.random() * 0.5);
  }

  private async fire(payload: SessionEventPayload): Promise<void> {
    const body = JSON.stringify({
      ...payload,
      api: {
        read: `GET /sessions/${payload.session.id}/read`,
        send: `POST /sessions/${payload.session.id}/send`,
        kill: `DELETE /sessions/${payload.session.id}`,
      },
    });

    const promises = this.endpoints.map(async ep => {
      // Skip if endpoint filters and this event isn't in the list
      if (ep.events && ep.events.length > 0 && !ep.events.includes(payload.event)) return;

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

  /** Issue #25: Deliver webhook with retry + exponential backoff. */
  private async deliverWithRetry(
    ep: WebhookEndpoint,
    body: string,
    event: SessionEvent,
    maxRetries: number = WebhookChannel.MAX_RETRIES,
  ): Promise<void> {
    let lastError = '';
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(ep.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(ep.headers || {}),
          },
          body,
          signal: AbortSignal.timeout(ep.timeoutMs || 5000),
        });

        if (res.ok) return; // Success

        lastError = `HTTP ${res.status}`;
        // Server error (5xx) — retry; client error (4xx) — don't
        if (res.status >= 500 && attempt < maxRetries) {
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
        if (attempt < maxRetries) {
          const delay = WebhookChannel.backoff(attempt);
          console.warn(`Webhook ${ep.url} error for ${event} (attempt ${attempt}/${maxRetries}): ${lastError}, retrying in ${Math.round(delay)}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.error(`Webhook ${ep.url} failed after ${maxRetries} attempts for ${event}: ${lastError}`);
        this.addToDeadLetterQueue(ep.url, event, lastError, maxRetries);
      }
      // Final failure (HTTP or network) — throw so fire() can aggregate
      throw new Error(lastError);
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
}
