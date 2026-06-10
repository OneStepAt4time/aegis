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

// #4627: retry_after clamp tests. Verify clamping by checking rateLimitUntil
// (a public getter on TelegramApiClient) after a 429 with retry_after.
// The clamp is MAX_RETRY_AFTER_S = 60.
describe('TelegramApiClient retry_after clamping (#4627)', () => {
  const config = { botToken: 'test-token-123', hookTimeoutMs: 5_000 };

  it('uses retry_after=5 as-is (below clamp)', async () => {
    const client = new TelegramApiClient(config);
    global.fetch = vi.fn().mockResolvedValue({
      status: 429,
      json: () => Promise.resolve({
        ok: false,
        description: 'Too Many Requests',
        parameters: { retry_after: 5 },
      }),
    } as unknown as Response);
    // 0 retries → exhausts immediately, rateLimitUntil still set
    await expect(client.tgApi('sendMessage', { chat_id: 1 }, 0)).rejects.toThrow();
    // rateLimitUntil should be Date.now() + 5*1000 + 500 = +5500
    expect(client['rateLimitUntil']).toBeGreaterThan(Date.now() + 4000);
    expect(client['rateLimitUntil']).toBeLessThan(Date.now() + 7000);
  });

  it('uses retry_after=60 as-is (at clamp)', async () => {
    const client = new TelegramApiClient(config);
    global.fetch = vi.fn().mockResolvedValue({
      status: 429,
      json: () => Promise.resolve({
        ok: false,
        description: 'Too Many Requests',
        parameters: { retry_after: 60 },
      }),
    } as unknown as Response);
    await expect(client.tgApi('sendMessage', { chat_id: 1 }, 0)).rejects.toThrow();
    // rateLimitUntil should be Date.now() + 60*1000 + 500 = +60500
    expect(client['rateLimitUntil']).toBeGreaterThan(Date.now() + 55000);
    expect(client['rateLimitUntil']).toBeLessThan(Date.now() + 65000);
  });

  it('clamps retry_after=120 to 60', async () => {
    const client = new TelegramApiClient(config);
    global.fetch = vi.fn().mockResolvedValue({
      status: 429,
      json: () => Promise.resolve({
        ok: false,
        description: 'Too Many Requests',
        parameters: { retry_after: 120 },
      }),
    } as unknown as Response);
    await expect(client.tgApi('sendMessage', { chat_id: 1 }, 0)).rejects.toThrow();
    // Clamped to 60 → rateLimitUntil should be Date.now() + 60*1000 + 500 = +60500
    // NOT Date.now() + 120*1000 + 500 = +120500
    expect(client['rateLimitUntil']).toBeGreaterThan(Date.now() + 55000);
    expect(client['rateLimitUntil']).toBeLessThan(Date.now() + 65000);
  });

  it('clamps retry_after=999999 to 60', async () => {
    const client = new TelegramApiClient(config);
    global.fetch = vi.fn().mockResolvedValue({
      status: 429,
      json: () => Promise.resolve({
        ok: false,
        description: 'Too Many Requests',
        parameters: { retry_after: 999999 },
      }),
    } as unknown as Response);
    await expect(client.tgApi('sendMessage', { chat_id: 1 }, 0)).rejects.toThrow();
    // Clamped to 60 → rateLimitUntil should be ~60500ms out, not ~999999500ms
    expect(client['rateLimitUntil']).toBeGreaterThan(Date.now() + 55000);
    expect(client['rateLimitUntil']).toBeLessThan(Date.now() + 65000);
  });
});
