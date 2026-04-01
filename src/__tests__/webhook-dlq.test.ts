/**
 * webhook-dlq.test.ts — Tests for Issue #89 L14: dead letter queue for failed webhooks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookChannel } from '../channels/webhook.js';
import type { SessionEventPayload } from '../channels/types.js';

// Mock SSRF DNS check (resolves to public IP so delivery proceeds)
vi.mock('../ssrf.js', () => ({
  validateWebhookUrl: vi.fn().mockReturnValue(null),
  resolveAndCheckIp: vi.fn().mockResolvedValue({ error: null, resolvedIp: null }),
  buildConnectionUrl: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makePayload(event: string = 'session.created'): SessionEventPayload {
  return {
    event: event as any,
    timestamp: new Date().toISOString(),
    session: { id: 'test-123', name: 'test-session', workDir: '/tmp' },
    detail: 'Test event',
  };
}

describe('Webhook dead letter queue (L14)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should add entry to DLQ after all retries exhausted (network error)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook' }],
    });

    const deliveryPromise = channel.onSessionCreated!(makePayload());
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    await deliveryPromise;

    const dlq = channel.getDeadLetterQueue();
    expect(dlq).toHaveLength(1);
    expect(dlq[0].endpoint).toBe('https://example.com/hook');
    expect(dlq[0].event).toBe('session.created');
    expect(dlq[0].error).toBe('ECONNREFUSED');
    expect(dlq[0].attempts).toBe(5);
    expect(dlq[0].timestamp).toBeDefined();
  });

  it('should add entry to DLQ after all retries exhausted (5xx error)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook' }],
    });

    const deliveryPromise = channel.onSessionCreated!(makePayload());
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    await deliveryPromise;

    const dlq = channel.getDeadLetterQueue();
    expect(dlq).toHaveLength(1);
    expect(dlq[0].error).toBe('HTTP 500');
    expect(dlq[0].attempts).toBe(5);
  });

  it('should NOT add to DLQ for 4xx client errors', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400 });

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook' }],
    });

    await channel.onSessionCreated!(makePayload());

    expect(channel.getDeadLetterQueue()).toHaveLength(0);
  });

  it('should NOT add to DLQ for successful deliveries', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook' }],
    });

    await channel.onSessionCreated!(makePayload());

    expect(channel.getDeadLetterQueue()).toHaveLength(0);
  });

  it('should accumulate multiple DLQ entries', async () => {
    mockFetch.mockRejectedValue(new Error('fail'));

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook' }],
    });

    // Fire 3 events, each will fail and add to DLQ
    const promises = [
      channel.onSessionCreated!(makePayload()),
      channel.onMessage!(makePayload('message.assistant')),
      channel.onStatusChange!(makePayload('status.working')),
    ];

    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    await Promise.all(promises);

    expect(channel.getDeadLetterQueue()).toHaveLength(3);
  });

  it('should cap DLQ at 100 entries', async () => {
    mockFetch.mockRejectedValue(new Error('fail'));

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook' }],
    });

    // Fire 105 events
    const promises = Array.from({ length: 105 }, () =>
      channel.onSessionCreated!(makePayload()),
    );

    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    await Promise.all(promises);

    expect(channel.getDeadLetterQueue()).toHaveLength(100);
  });

  it('should clear DLQ entries', async () => {
    mockFetch.mockRejectedValue(new Error('fail'));

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook' }],
    });

    const deliveryPromise = channel.onSessionCreated!(makePayload());
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    await deliveryPromise;

    expect(channel.getDeadLetterQueue()).toHaveLength(1);

    const cleared = channel.clearDeadLetterQueue();
    expect(cleared).toBe(1);
    expect(channel.getDeadLetterQueue()).toHaveLength(0);
  });

  it('should log when adding to DLQ', async () => {
    mockFetch.mockRejectedValue(new Error('fail'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook' }],
    });

    const deliveryPromise = channel.onSessionCreated!(makePayload());
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    await deliveryPromise;

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Webhook DLQ'),
    );
    warnSpy.mockRestore();
  });
});
