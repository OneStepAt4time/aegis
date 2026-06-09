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
});
