/**
 * channels/telegram-api.test.ts — Tests for TelegramApiClient (#4626).
 *
 * Extracted from telegram/index.ts god-module split.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramApiClient } from '../../channels/telegram/api.js';

describe('TelegramApiClient', () => {
  const config = { botToken: 'test-token-123', hookTimeoutMs: 5_000 };
  let client: TelegramApiClient;

  beforeEach(() => {
    client = new TelegramApiClient(config);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns data.result on success', async () => {
    const mockResult = { message_id: 42 };
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: mockResult }),
    } as any);

    const result = await client.tgApi('sendMessage', { chat_id: 1, text: 'hi' });
    expect(result).toEqual(mockResult);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-token-123/sendMessage',
      expect.any(Object),
    );
  });

  it('throws after exhausting retries', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 500,
      json: () => Promise.resolve({ ok: false, description: 'Internal Server Error' }),
    } as any);

    await expect(client.tgApi('sendMessage', { chat_id: 1 }, 0)).rejects.toThrow(
      'Telegram API sendMessage: Internal Server Error',
    );
  });

  // #4629: red test — tgApi throw must redact bot token before propagating.
  // The current implementation throws the raw error description, which may
  // contain the bot token if the Telegram API response includes it (e.g.,
  // 401 Unauthorized with the token in the error message). The fix injects
  // redactError into TgApiConfig and applies it at every throw site.
  it('redacts bot token from thrown error description', async () => {
    const token = 'secret-bot-token-789';
    // Simulate a 401 where the API helpfully echoes the token in the error
    const description = `Unauthorized: bot token ${token} is invalid`;
    global.fetch = vi.fn().mockResolvedValue({
      status: 401,
      json: () => Promise.resolve({ ok: false, description }),
    } as any);

    // The client must be constructed with a redactError that scrubs the token.
    // This test will fail (red) until the fix injects redactError into TgApiConfig.
    const redactingClient = new TelegramApiClient({
      botToken: token,
      hookTimeoutMs: 5_000,
      redactError: (err: unknown) => {
        const str = err instanceof Error ? err.message : String(err);
        return str.includes(token)
          ? new Error(str.replaceAll(token, 'REDACTED'))
          : err;
      },
    });

    await expect(redactingClient.tgApi('sendMessage', { chat_id: 1 }, 0)).rejects.toThrow(
      'Telegram API sendMessage: Unauthorized: bot token REDACTED is invalid',
    );
  });
});
