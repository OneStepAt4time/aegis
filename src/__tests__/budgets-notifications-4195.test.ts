/**
 * budgets-notifications-4195.test.ts — BudgetNotifier tests.
 *
 * Tests log channel (synchronous), webhook POST (with fetch mock),
 * and Telegram (with fetch mock). Errors thrown on non-OK responses.
 * Issue #4195: Cost Alerts — /v1/budgets API backend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
// Mock SSRF utilities to avoid real DNS lookups in unit tests.
vi.mock('../ssrf.js', () => ({
  validateWebhookUrl: (u: string) => null,
  resolveAndCheckIp: async (h: string) => ({ error: null, resolvedIp: null }),
  buildConnectionUrl: (u: string, ip: string) => ({ connectionUrl: u, hostHeader: new URL(u).host }),
}));
import { BudgetNotifier } from '../budgets/notifications.js';
import type { AlertPayload } from '../budgets/notifications.js';
import type { Budget } from '../budgets/types.js';

function makePayload(overrides: Partial<AlertPayload> = {}): AlertPayload {
  const budget: Budget = {
    id: 'b-1',
    name: 'Test Budget',
    keyId: null,
    limitUsd: 100,
    thresholds: [50, 80, 100],
    window: { kind: 'rolling', hours: 168 },
    channels: [{ type: 'log' }],
    enabled: true,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    lastEvaluatedAt: null,
  };
  return {
    budget,
    threshold: 50,
    currentSpendUsd: 50,
    windowStart: '2026-05-18T00:00:00.000Z',
    windowEnd: '2026-05-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('BudgetNotifier — log channel', () => {
  it('resolves without throwing for log channel', async () => {
    const notifier = new BudgetNotifier({});
    const payload = makePayload();
    await expect(notifier.sendAlert(payload, { type: 'log' })).resolves.not.toThrow();
  });
});

describe('BudgetNotifier — webhook channel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends a POST request with correct body structure', async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue({
      ok: true,
    } as Response);

    const notifier = new BudgetNotifier({});
    const payload = makePayload({ threshold: 80, currentSpendUsd: 80 });
    await notifier.sendAlert(payload, { type: 'webhook', url: 'https://example.com/hook' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/hook');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body as string);
    expect(body.event).toBe('budget.threshold');
    expect(body.budgetId).toBe('b-1');
    expect(body.threshold).toBe(80);
    expect(body.currentSpendUsd).toBe(80);
    expect(body.limitUsd).toBe(100);
  });

  it('throws when webhook returns non-OK status', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    } as Response);

    const notifier = new BudgetNotifier({});
    const payload = makePayload();
    await expect(notifier.sendAlert(payload, { type: 'webhook', url: 'https://example.com/hook' })).rejects.toThrow(/500/);
  });
});

describe('BudgetNotifier — telegram channel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('throws when bot token is not configured', async () => {
    const notifier = new BudgetNotifier({});
    const payload = makePayload();
    await expect(notifier.sendAlert(payload, { type: 'telegram', chatId: 12345 })).rejects.toThrow(/token/i);
  });

  it('sends a message to the Telegram API', async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue({
      ok: true,
    } as Response);

    const notifier = new BudgetNotifier({ telegramBotToken: 'test-token' });
    const payload = makePayload({ threshold: 100, currentSpendUsd: 100 });
    await notifier.sendAlert(payload, { type: 'telegram', chatId: 987654 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('test-token');
    expect(url).toContain('sendMessage');

    const body = JSON.parse(opts.body as string);
    expect(body.chat_id).toBe(987654);
    expect(body.text).toContain('Budget Alert');
    expect(body.text).toContain('Test Budget');
  });

  it('throws when Telegram API returns non-OK', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad Request'),
    } as Response);

    const notifier = new BudgetNotifier({ telegramBotToken: 'test-token' });
    const payload = makePayload();
    await expect(notifier.sendAlert(payload, { type: 'telegram', chatId: 12345 })).rejects.toThrow(/400/);
  });
});
