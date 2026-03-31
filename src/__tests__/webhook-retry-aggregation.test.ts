/**
 * webhook-retry-aggregation.test.ts — Tests for Issue #588:
 * Promise.allSettled error aggregation in webhook fire() method.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookChannel } from '../channels/webhook.js';
import type { SessionEventPayload } from '../channels/types.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makePayload(event: string = 'session.created'): SessionEventPayload {
  return {
    event: event as SessionEventPayload['event'],
    timestamp: new Date().toISOString(),
    session: { id: 'test-123', name: 'test-session', workDir: '/tmp' },
    detail: 'Test event',
  };
}

describe('Issue #588: Promise.allSettled error aggregation', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should log aggregated failure count when all endpoints fail', async () => {
    vi.useFakeTimers();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const channel = new WebhookChannel({
      endpoints: [
        { url: 'https://example.com/hook1' },
        { url: 'https://example.com/hook2' },
        { url: 'https://example.com/hook3' },
      ],
    });

    const deliveryPromise = channel.onSessionCreated!(makePayload());
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    await deliveryPromise;

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Webhook: 3/3 endpoint(s) failed'),
    );

    vi.useRealTimers();
  });

  it('should log partial failures with correct count', async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockRejectedValue(new Error('timeout'));

    const channel = new WebhookChannel({
      endpoints: [
        { url: 'https://example.com/hook1' },
        { url: 'https://example.com/hook2' },
      ],
    });

    const deliveryPromise = channel.onSessionCreated!(makePayload());
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    await deliveryPromise;

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Webhook: 1/2 endpoint(s) failed'),
    );

    vi.useRealTimers();
  });

  it('should NOT log aggregation when all endpoints succeed', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const channel = new WebhookChannel({
      endpoints: [
        { url: 'https://example.com/hook1' },
        { url: 'https://example.com/hook2' },
      ],
    });

    await channel.onSessionCreated!(makePayload());

    const aggregationCalls = consoleErrorSpy.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('endpoint(s) failed'),
    );
    expect(aggregationCalls).toHaveLength(0);
  });

  it('should include failure reasons in aggregated log', async () => {
    vi.useFakeTimers();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const channel = new WebhookChannel({
      endpoints: [
        { url: 'https://example.com/hook1' },
      ],
    });

    const deliveryPromise = channel.onSessionCreated!(makePayload());
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    await deliveryPromise;

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ECONNREFUSED'),
    );

    vi.useRealTimers();
  });

  it('should handle single endpoint failure', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook1' }],
    });

    const deliveryPromise = channel.onSessionCreated!(makePayload());
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    await deliveryPromise;

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Webhook: 1/1 endpoint(s) failed'),
    );

    vi.useRealTimers();
  });
});
