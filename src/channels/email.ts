/**
 * channels/email.ts — Email notification channel.
 *
 * Sends session events to ops email on stall/dead events.
 * Configure via AEGIS_EMAIL_* env vars.
 *
 * @example
 * // env:
 * //   AEGIS_EMAIL_HOST=smtp.example.com
 * //   AEGIS_EMAIL_PORT=587
 * //   AEGIS_EMAIL_USER=alerts@example.com
 * //   AEGIS_EMAIL_PASS=...
 * //   AEGIS_EMAIL_TO=ops@example.com
 * //   AEGIS_EMAIL_FROM=aegis@example.com
 * const channel = EmailChannel.fromEnv();
 */

import type { Transporter } from 'nodemailer';
import type {
  Channel,
  SessionEvent,
  SessionEventPayload,
} from './types.js';

export interface EmailChannelConfig {
  /** SMTP host. */
  host: string;
  /** SMTP port (default: 587). */
  port?: number;
  /** SMTP secure (default: false, true for 465). */
  secure?: boolean;
  /** SMTP username. */
  user: string;
  /** SMTP password or API key. */
  pass: string;
  /** Destination email address. */
  to: string;
  /** Sender email address. */
  from: string;
  /** Optional: only fire on these events. Omit = stall/dead events only. */
  events?: SessionEvent[];
  /** Connection timeout in ms (default: 10000). */
  timeoutMs?: number;
}

interface EmailHealthStatus {
  channel: string;
  healthy: boolean;
  lastSuccess: number | null;
  lastError: string | null;
  pendingCount: number;
}

export class EmailChannel implements Channel {
  readonly name = 'email';

  private transporter: Transporter;
  private to: string;
  private from: string;
  private events?: SessionEvent[];
  private lastSuccess: number | null = null;
  private lastError: string | null = null;
  private deadLetterQueue: Array<{ timestamp: string; endpoint: string; event: SessionEvent; error: string; attempts: number }> = [];
  static readonly DLQ_MAX_SIZE = 50;
  static readonly DEFAULT_EVENTS: SessionEvent[] = ['status.stall', 'status.dead', 'status.error', 'status.permission_timeout'];

  constructor(config: EmailChannelConfig, transporter: Transporter) {
    this.transporter = transporter;
    this.to = config.to;
    this.from = config.from;
    this.events = config.events;
    this.lastSuccess = null;
    this.lastError = null;
  }

  static fromEnv(): EmailChannel | null {
    const host = process.env.AEGIS_EMAIL_HOST;
    const user = process.env.AEGIS_EMAIL_USER;
    const pass = process.env.AEGIS_EMAIL_PASS;
    const to = process.env.AEGIS_EMAIL_TO;
    const from = process.env.AEGIS_EMAIL_FROM ?? 'aegis@localhost';

    if (!host || !user || !pass || !to) return null;

    // Lazy-import nodemailer so the rest of the app doesn't need it
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodemailer = require('nodemailer');

    const port = parseInt(process.env.AEGIS_EMAIL_PORT ?? '587', 10);
    const secure = process.env.AEGIS_EMAIL_SECURE === 'true' || port === 465;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      connectionTimeout: parseInt(process.env.AEGIS_EMAIL_TIMEOUT_MS ?? '10000', 10),
    });

    let events: SessionEvent[] | undefined;
    const rawEvents = process.env.AEGIS_EMAIL_EVENTS;
    if (rawEvents) {
      try {
        events = JSON.parse(rawEvents) as SessionEvent[];
      } catch {
        events = EmailChannel.DEFAULT_EVENTS;
      }
    } else {
      events = EmailChannel.DEFAULT_EVENTS;
    }

    return new EmailChannel({ host, port, secure, user, pass, to, from, events }, transporter);
  }

  filter(event: SessionEvent): boolean {
    const allowed = this.events ?? EmailChannel.DEFAULT_EVENTS;
    return allowed.includes(event);
  }

  async onStatusChange(payload: SessionEventPayload): Promise<void> {
    if (!this.filter(payload.event)) return;
    await this.send(payload);
  }

  private async send(payload: SessionEventPayload): Promise<void> {
    const subject = this.buildSubject(payload);
    const html = this.buildHtml(payload);
    const text = this.buildText(payload);

    try {
      const result = await this.transporter.sendMail({
        from: this.from,
        to: this.to,
        subject,
        text,
        html,
      });
      this.lastSuccess = Date.now();
      this.lastError = null;
      console.log(`[email] Sent ${payload.event} email to ${this.to}, messageId: ${result.messageId}`);
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      this.lastError = error;
      console.error(`[email] Failed to send ${payload.event} email: ${error}`);
      this.pushDLQ(payload.event, error);
    }
  }

  private buildSubject(payload: SessionEventPayload): string {
    const prefix = this.eventSubjectPrefix(payload.event);
    return `[Aegis] ${prefix} — ${payload.session.name}`;
  }

  private buildHtml(payload: SessionEventPayload): string {
    const color = this.eventColor(payload.event);
    const eventLabel = payload.event.replace(/[._]/g, ' ');
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="border-left: 4px solid ${color}; padding: 16px 20px; background: #f9f9f9;">
    <h2 style="margin: 0 0 12px; color: ${color};">Aegis — ${this.formatEvent(payload.event)}</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr><td style="padding: 4px 0; color: #666;">Session</td><td style="padding: 4px 0; font-weight: bold;">${this.escapeHtml(payload.session.name)}</td></tr>
      <tr><td style="padding: 4px 0; color: #666;">Session ID</td><td style="padding: 4px 0; font-family: monospace;">${this.escapeHtml(payload.session.id)}</td></tr>
      <tr><td style="padding: 4px 0; color: #666;">WorkDir</td><td style="padding: 4px 0; font-family: monospace; font-size: 12px;">${this.escapeHtml(payload.session.workDir)}</td></tr>
      <tr><td style="padding: 4px 0; color: #666;">Event</td><td style="padding: 4px 0;"><code>${eventLabel}</code></td></tr>
      <tr><td style="padding: 4px 0; color: #666;">Detail</td><td style="padding: 4px 0;">${this.escapeHtml(payload.detail)}</td></tr>
      <tr><td style="padding: 4px 0; color: #666;">Time</td><td style="padding: 4px 0;">${new Date(payload.timestamp).toISOString()}</td></tr>
    </table>
  </div>
</body>
</html>`;
  }

  private buildText(payload: SessionEventPayload): string {
    return `Aegis — ${this.formatEvent(payload.event)}

Session: ${payload.session.name} (${payload.session.id})
WorkDir: ${payload.session.workDir}
Event: ${payload.event}
Detail: ${payload.detail}
Time: ${new Date(payload.timestamp).toISOString()}`;
  }

  private eventSubjectPrefix(event: SessionEvent): string {
    switch (event) {
      case 'status.stall': return '[ACTION] Session Stalled';
      case 'status.dead': return '[CRITICAL] Session Dead';
      case 'status.error': return '[ERROR] Session Error';
      case 'status.permission_timeout': return '[WARNING] Permission Timeout';
      case 'session.created': return 'Session Created';
      case 'session.ended': return 'Session Ended';
      default: return `Event: ${event}`;
    }
  }

  private eventColor(event: SessionEvent): string {
    switch (event) {
      case 'status.stall': return '#ffcc00';
      case 'status.dead': return '#dc3545';
      case 'status.error': return '#dc3545';
      case 'status.permission_timeout': return '#fd7e14';
      case 'session.created': return '#28a745';
      case 'session.ended': return '#6c757d';
      default: return '#007bff';
    }
  }

  private formatEvent(event: SessionEvent): string {
    return event.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private pushDLQ(event: SessionEvent, error: string): void {
    this.deadLetterQueue.unshift({
      timestamp: new Date().toISOString(),
      endpoint: this.to,
      event,
      error,
      attempts: 1,
    });
    if (this.deadLetterQueue.length > EmailChannel.DLQ_MAX_SIZE) {
      this.deadLetterQueue.length = EmailChannel.DLQ_MAX_SIZE;
    }
  }

  getDeadLetterQueue() {
    return this.deadLetterQueue;
  }

  getHealth(): EmailHealthStatus {
    return {
      channel: this.name,
      healthy: this.lastError === null,
      lastSuccess: this.lastSuccess,
      lastError: this.lastError,
      pendingCount: 0,
    };
  }

  async destroy(): Promise<void> {
    this.transporter.close();
  }
}
