/**
 * channels/slack.ts — Slack notification channel.
 *
 * Sends session events to Slack channels via Incoming Webhooks.
 * Configure via AEGIS_SLACK_WEBHOOK_URL env var.
 *
 * @example
 * // env: AEGIS_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx
 * const channel = SlackChannel.fromEnv();
 */

import type {
  Channel,
  SessionEvent,
  SessionEventPayload,
} from './types.js';

export interface SlackChannelConfig {
  /** Incoming webhook URL from Slack Apps. */
  webhookUrl: string;
  /** Optional: only fire on these events. Omit = all events. */
  events?: SessionEvent[];
  /** Optional: default channel override (for Slack API bots). */
  channel?: string;
  /** Timeout in ms (default: 5000). */
  timeoutMs?: number;
}

interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

interface SlackPayload {
  text: string;
  blocks?: SlackBlock[];
  attachments?: Array<{ color: string; blocks: SlackBlock[] }>;
}

export class SlackChannel implements Channel {
  readonly name = 'slack';

  private webhookUrl: string;
  private events?: SessionEvent[];
  private channel?: string;
  private timeoutMs: number;
  private deadLetterQueue: Array<{ timestamp: string; endpoint: string; event: SessionEvent; error: string; attempts: number }> = [];
  static readonly DLQ_MAX_SIZE = 100;

  constructor(config: SlackChannelConfig) {
    this.webhookUrl = config.webhookUrl;
    this.events = config.events;
    this.channel = config.channel;
    this.timeoutMs = config.timeoutMs ?? 5000;
  }

  static fromEnv(): SlackChannel | null {
    const webhookUrl = process.env.AEGIS_SLACK_WEBHOOK_URL;
    if (!webhookUrl) return null;

    let events: SessionEvent[] | undefined;
    const rawEvents = process.env.AEGIS_SLACK_EVENTS;
    if (rawEvents) {
      try {
        events = JSON.parse(rawEvents) as SessionEvent[];
      } catch {
        console.error('Failed to parse AEGIS_SLACK_EVENTS, ignoring');
      }
    }

    const channel = process.env.AEGIS_SLACK_CHANNEL;
    const timeoutMs = parseInt(process.env.AEGIS_SLACK_TIMEOUT_MS ?? '5000', 10);

    return new SlackChannel({ webhookUrl, events, channel, timeoutMs });
  }

  filter(event: SessionEvent): boolean {
    if (!this.events || this.events.length === 0) return true;
    return this.events.includes(event);
  }

  async onSessionCreated(payload: SessionEventPayload): Promise<void> {
    await this.fire(payload, 'session_created');
  }

  async onSessionEnded(payload: SessionEventPayload): Promise<void> {
    await this.fire(payload, 'session_ended');
  }

  async onMessage(payload: SessionEventPayload): Promise<void> {
    await this.fire(payload, 'message');
  }

  async onStatusChange(payload: SessionEventPayload): Promise<void> {
    await this.fire(payload, 'status_change');
  }

  private async fire(payload: SessionEventPayload, _eventType: string): Promise<void> {
    const body = this.buildPayload(payload);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`Slack API error: HTTP ${res.status} ${res.statusText}`);
      }
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[slack] Delivery failed for event ${payload.event}: ${error}`);
      this.pushDLQ(payload.event, error);
    }
  }

  private buildPayload(payload: SessionEventPayload): SlackPayload {
    const emoji = this.eventEmoji(payload.event);
    const statusColor = this.eventColor(payload.event);
    const text = `${emoji} Aegis: ${payload.detail}`;

    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Aegis Event*\n*${this.formatEvent(payload.event)}*`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Session:* \`${payload.session.name}\` (\`${payload.session.id}\`)\n*Detail:* ${payload.detail}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `WorkDir: \`${payload.session.workDir}\` • ${new Date(payload.timestamp).toISOString()}`,
          },
        ],
      },
    ];

    return {
      text,
      blocks,
      attachments: [
        {
          color: statusColor,
          blocks: [],
        },
      ],
    };
  }

  private eventEmoji(event: SessionEvent): string {
    switch (event) {
      case 'session.created': return ':large_green_circle:';
      case 'session.ended': return ':grey_circle:';
      case 'status.working': return ':hourglass_flowing_sand:';
      case 'status.stall': return ':warning:';
      case 'status.dead': return ':skull:';
      case 'status.error': return ':x:';
      case 'status.idle': return ':white_circle:';
      case 'status.permission': return ':lock:';
      case 'status.question': return ':question:';
      case 'status.plan': return ':thought_balloon:';
      case 'message.user': return ':bust_in_silhouette:';
      case 'message.assistant': return ':robot_face:';
      case 'message.tool_use': return ':wrench:';
      case 'message.tool_result': return ':checkered_flag:';
      default: return ':bell:';
    }
  }

  private eventColor(event: SessionEvent): string {
    switch (event) {
      case 'status.stall': return '#ffcc00';
      case 'status.dead': return '#dc3545';
      case 'status.error': return '#dc3545';
      case 'status.working': return '#17a2b8';
      case 'session.created': return '#28a745';
      case 'session.ended': return '#6c757d';
      default: return '#007bff';
    }
  }

  private formatEvent(event: SessionEvent): string {
    return event.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  private pushDLQ(event: SessionEvent, error: string): void {
    this.deadLetterQueue.unshift({
      timestamp: new Date().toISOString(),
      endpoint: this.webhookUrl,
      event,
      error,
      attempts: 1,
    });
    if (this.deadLetterQueue.length > SlackChannel.DLQ_MAX_SIZE) {
      this.deadLetterQueue.length = SlackChannel.DLQ_MAX_SIZE;
    }
  }

  getDeadLetterQueue() {
    return this.deadLetterQueue;
  }

  getHealth() {
    return {
      channel: this.name,
      healthy: true,
      lastSuccess: null,
      lastError: this.deadLetterQueue[0]?.error ?? null,
      pendingCount: 0,
    };
  }
}
