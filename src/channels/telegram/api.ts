/**
 * channels/telegram/api.ts — Telegram Bot API transport.
 *
 * Extracted from telegram/index.ts (god-module split, #4626).
 * Handles rate-limit waiting, fetch + JSON parse, and generic retry/backoff.
 */

import { sleep } from './telegram-sender.js';
import { StructuredLogger } from '../../logger.js';

const log = new StructuredLogger();

export interface TgApiConfig {
  botToken: string;
  hookTimeoutMs?: number;
  /** Issue #4629: Redact sensitive fields (e.g., bot token) from error messages before throwing. */
  redactError?: (err: unknown) => unknown;
}

export class TelegramApiClient {
  private rateLimitUntil = 0;

  constructor(private readonly config: TgApiConfig) {}

  async tgApi(
    method: string,
    body: Record<string, unknown>,
    retries = 3,
  ): Promise<unknown> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const now = Date.now();
      if (this.rateLimitUntil > now) {
        const waitMs = this.rateLimitUntil - now;
        log.info({ component: 'telegram', operation: 'rateLimitWait', attributes: { waitSeconds: Math.ceil(waitMs / 1000), method } });
        await sleep(waitMs);
      }

      const res = await fetch(`https://api.telegram.org/bot${this.config.botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.hookTimeoutMs ?? 10_000),
      });
      const data = (await res.json()) as {
        ok: boolean;
        result?: unknown;
        description?: string;
        parameters?: { retry_after?: number };
      };

      if (data.ok) return data.result;

      if (res.status === 429 && data.parameters?.retry_after) {
        const retryAfter = data.parameters.retry_after;
        this.rateLimitUntil = Date.now() + retryAfter * 1000 + 500;
        log.info({ component: 'telegram', operation: 'rateLimit429', attributes: { retryAfter, attempt: attempt + 1, maxAttempts: retries + 1 } });
        if (attempt < retries) {
          await sleep(retryAfter * 1000 + 500);
          continue;
        }
      }

      if (attempt === retries) {
        const error = new Error(`Telegram API ${method}: ${data.description || 'unknown error'}`);
        throw this.config.redactError ? this.config.redactError(error) : error;
      }
      await sleep(1000 * (attempt + 1));
    }
    const unreachable = new Error('Unreachable');
    throw this.config.redactError ? this.config.redactError(unreachable) : unreachable;
  }
}
