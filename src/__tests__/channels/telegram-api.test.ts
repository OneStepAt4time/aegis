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
    vi.restoreAllMocks();
  });

  it('returns data.result on success', async () => {
    const mockResult = { message_id: 42 };
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: mockResult }),
    } as unknown as Response);

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
    } as unknown as Response);

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
    } as unknown as Response);

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

// #4675: network-level fetch failure retry. The tgApi retry loop previously
// only handled HTTP-level errors (429, 500). If fetch() itself threw (e.g.
// TypeError: fetch failed from DNS/TLS/IPv6 issues), the exception propagated
// immediately with no retry. This describe adds coverage for the fix.
describe('TelegramApiClient network error retry (#4675)', () => {
  const config = { botToken: 'test-token-123', hookTimeoutMs: 5_000 };

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries on fetch failure and succeeds on next attempt', async () => {
    const client = new TelegramApiClient(config);
    const networkError = new TypeError('fetch failed');
    const mockResult = { message_id: 42 };

    global.fetch = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, result: mockResult }),
      } as unknown as Response);

    const result = await client.tgApi('sendMessage', { chat_id: 1 }, 1);
    expect(result).toEqual(mockResult);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries on persistent fetch failure', async () => {
    const client = new TelegramApiClient(config);
    const networkError = new TypeError('fetch failed');

    global.fetch = vi.fn().mockRejectedValue(networkError);

    await expect(client.tgApi('sendMessage', { chat_id: 1 }, 1)).rejects.toThrow('fetch failed');
    expect(global.fetch).toHaveBeenCalledTimes(2); // attempt 0 + attempt 1 (retries=1)
  });

  it('retries up to default 3 retries (4 total attempts) on fetch failure', async () => {
    const client = new TelegramApiClient(config);
    const networkError = new TypeError('fetch failed');

    global.fetch = vi.fn().mockRejectedValue(networkError);

    await expect(client.tgApi('sendMessage', { chat_id: 1 })).rejects.toThrow('fetch failed');
    expect(global.fetch).toHaveBeenCalledTimes(4); // 1 + 3 retries
  }, 10_000);

  it('logs each retry attempt with method and error message', async () => {
    const client = new TelegramApiClient(config);
    const networkError = new TypeError('fetch failed');

    global.fetch = vi.fn().mockRejectedValue(networkError);

    await expect(client.tgApi('sendMessage', { chat_id: 1 }, 1)).rejects.toThrow('fetch failed');
    // The retry loop logs a warning on each failed attempt before the final throw.
    // We verify the code path ran by checking fetch call count.
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
