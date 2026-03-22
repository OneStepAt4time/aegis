/**
 * channels/webhook.ts — Generic webhook notification channel.
 *
 * Fires HTTP POST to configured URLs on session events.
 * Configure via MANUS_WEBHOOKS env var or config file.
 */

import type {
  Channel,
  SessionEvent,
  SessionEventPayload,
} from './types.js';

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

export class WebhookChannel implements Channel {
  readonly name = 'webhook';

  private endpoints: WebhookEndpoint[];

  constructor(config: WebhookChannelConfig) {
    this.endpoints = config.endpoints;
  }

  /** Create from MANUS_WEBHOOKS env var. Returns null if not set. */
  static fromEnv(): WebhookChannel | null {
    const raw = process.env.MANUS_WEBHOOKS;
    if (!raw) return null;
    try {
      const endpoints = JSON.parse(raw) as WebhookEndpoint[];
      if (!Array.isArray(endpoints) || endpoints.length === 0) return null;
      return new WebhookChannel({ endpoints });
    } catch (e) {
      console.error('Failed to parse MANUS_WEBHOOKS:', e);
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
        if (!res.ok) {
          console.error(`Webhook ${ep.url} returned ${res.status} for ${payload.event}`);
        }
      } catch (e) {
        console.error(`Webhook ${ep.url} error:`, e);
      }
    });

    await Promise.allSettled(promises);
  }
}
