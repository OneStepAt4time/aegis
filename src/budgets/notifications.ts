/**
 * budgets/notifications.ts — Notification dispatch for budget alerts.
 *
 * Supports Telegram, webhook, and log channels per ADR-0031.
 *
 * Issue #4195: Cost Alerts — /v1/budgets API backend.
 */

import type { Budget, NotificationChannel } from './types.js';
import { StructuredLogger } from '../logger.js';
import { validateWebhookUrl, resolveAndCheckIp, buildConnectionUrl } from '../ssrf.js';

const log = new StructuredLogger();

export interface AlertPayload {
  budget: Budget;
  threshold: number;
  currentSpendUsd: number;
  windowStart: string;
  windowEnd: string;
}

export interface NotificationConfig {
  telegramBotToken?: string;
}

export class BudgetNotifier {
  constructor(private readonly config: NotificationConfig) {}

  async sendAlert(payload: AlertPayload, channel: NotificationChannel): Promise<void> {
    try {
      switch (channel.type) {
        case 'telegram':
          await this.sendTelegram(payload, channel.chatId);
          break;
        case 'webhook':
          await this.sendWebhook(payload, channel.url);
          break;
        case 'log':
          this.sendLog(payload);
          break;
      }
      log.info({
        component: 'budget-notifier',
        operation: 'alertSent',
        attributes: {
          budgetId: payload.budget.id,
          threshold: payload.threshold,
          channel: channel.type,
        },
      });
    } catch (err) {
      log.error({
        component: 'budget-notifier',
        operation: 'alertFailed',
        attributes: {
          budgetId: payload.budget.id,
          threshold: payload.threshold,
          channel: channel.type,
          error: String(err),
        },
      });
      throw err;
    }
  }

  private async sendTelegram(payload: AlertPayload, chatId: number): Promise<void> {
    const token = this.config.telegramBotToken;
    if (!token) {
      throw new Error('Telegram bot token not configured');
    }

    const { budget, threshold, currentSpendUsd, windowStart, windowEnd } = payload;
    const percentUsed = Math.round((currentSpendUsd / budget.limitUsd) * 100 * 10) / 10;
    const windowDesc = budget.window.kind === 'rolling'
      ? `rolling ${budget.window.hours}h`
      : `calendar ${budget.window.hours}h`;
    const windowEndFormatted = new Date(windowEnd).toUTCString().replace(' GMT', ' UTC');

    const icon = threshold >= 100 ? '🚨' : threshold >= 80 ? '⚠️' : 'ℹ️';
    const text = [
      `${icon} <b>Budget Alert: "${budget.name}"</b>`,
      `${percentUsed}% used ($${currentSpendUsd.toFixed(2)} / $${budget.limitUsd.toFixed(2)})`,
      `Window: ${windowDesc} (ends ${windowEndFormatted})`,
      `Threshold: ${threshold}%`,
    ].join('
');

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Telegram API error ${res.status}: ${body}`);
    }
  }

  private async sendWebhook(payload: AlertPayload, url: string): Promise<void> {
    // SSRF protection: validate URL format and DNS resolution before performing fetch.
    const urlError = validateWebhookUrl(url);
    if (urlError) {
      throw new Error(`Invalid webhook URL: ${urlError}`);
    }

    const hostname = new URL(url).hostname.replace(/(^\[|\]$)/g, '');
    let fetchUrl = url;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // For non-local hosts, resolve and check IPs to prevent DNS rebinding / SSRF.
    if (hostname !== '127.0.0.1' && hostname !== '::1' && hostname !== 'localhost') {
      const dnsResult = await resolveAndCheckIp(hostname);
      if (dnsResult.error) {
        throw new Error(dnsResult.error);
      }
      if (dnsResult.resolvedIp) {
        const conn = buildConnectionUrl(url, dnsResult.resolvedIp);
        fetchUrl = conn.connectionUrl;
        headers['Host'] = conn.hostHeader;
      }
    }

    const { budget, threshold, currentSpendUsd, windowStart, windowEnd } = payload;
    const body = {
      event: 'budget.threshold',
      budgetId: budget.id,
      budgetName: budget.name,
      threshold,
      currentSpendUsd,
      limitUsd: budget.limitUsd,
      percentUsed: Math.round((currentSpendUsd / budget.limitUsd) * 10000) / 100,
      windowStart,
      windowEnd,
      timestamp: new Date().toISOString(),
    };

    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const respBody = await res.text().catch(() => '');
      throw new Error(`Webhook error ${res.status}: ${respBody}`);
    }
  }

  private sendLog(payload: AlertPayload): void {
    const { budget, threshold, currentSpendUsd, windowStart, windowEnd } = payload;
    log.info({
      component: 'budget-notifier',
      operation: 'thresholdAlert',
      attributes: {
        budgetId: budget.id,
        budgetName: budget.name,
        threshold,
        currentSpendUsd,
        limitUsd: budget.limitUsd,
        percentUsed: Math.round((currentSpendUsd / budget.limitUsd) * 10000) / 100,
        windowStart,
        windowEnd,
      },
    });
  }
}
