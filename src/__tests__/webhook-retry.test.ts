/**
 * webhook-retry.test.ts — Tests for Issue #25: webhook delivery with retry + backoff.
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

// Mock global fetch
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

describe('Webhook delivery with retry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should succeed on first attempt (no retry needed)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook' }],
    });

    await channel.onSessionCreated!(makePayload());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('should retry on 500 error with backoff', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook' }],
    });

    await channel.onSessionCreated!(makePayload());

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should retry on network error', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook' }],
    });

    await channel.onSessionCreated!(makePayload());

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry on 4xx client error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook' }],
    });

    await channel.onSessionCreated!(makePayload());

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should give up after max retries', async () => {
    // Use fake timers to avoid real delays from retry backoff
    vi.useFakeTimers();

    // Mock fetch to reject immediately
    mockFetch.mockRejectedValue(new Error('fail'));

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook' }],
    });

    // Start delivery (will be pending due to setTimeout in retry loop)
    const deliveryPromise = channel.onSessionCreated!(makePayload());

    // Advance timers through all retry delays (1s + 5s + 30s = 36s)
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }

    await deliveryPromise;

    expect(mockFetch).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it('should include session API links in payload', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook' }],
    });

    await channel.onStatusChange!(makePayload('status.working'));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Issue #1123: session.id and name are NOT secrets — keep them.
    // Only workDir is redacted (contains filesystem paths).
    expect(body.session.id).toBe('test-123');
    expect(body.session.name).toBe('test-session');
    expect(body.session.workDir).toBe('[REDACTED]');
  });

  it('should skip endpoint if event filter does not match', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const channel = new WebhookChannel({
      endpoints: [{
        url: 'https://example.com/hook',
        events: ['session.ended'],
      }],
    });

    await channel.onSessionCreated!(makePayload('session.created'));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should send to multiple endpoints independently', async () => {
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

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe('https://example.com/hook1');
    expect(mockFetch.mock.calls[1][0]).toBe('https://example.com/hook2');
  });

  it('should deliver status change events', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook' }],
    });

    const payload = makePayload('status.permission');
    await channel.onStatusChange!(payload);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event).toBe('status.permission');
    // Issue #1123: session.id and name are NOT secrets — keep them.
    expect(body.session.id).toBe('test-123');
    expect(body.session.name).toBe('test-session');
    expect(body.session.workDir).toBe('[REDACTED]');
  });

  it('should have correct MAX_RETRIES constant', () => {
    expect(WebhookChannel.MAX_RETRIES).toBe(3);
  });

  it('should have correct BASE_DELAY_MS constant', () => {
    expect(WebhookChannel.BASE_DELAY_MS).toBe(1000);
  });

  describe('Issue #588: Promise.allSettled error aggregation', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should log at error level when all endpoints fail', async () => {
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
      for (let i = 0; i < 40; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }
      await deliveryPromise;

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Webhook: 3/3 endpoint(s) failed (total)'),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ECONNREFUSED'),
      );

      vi.useRealTimers();
    });

    it('should log at warn level for partial failures', async () => {
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
      for (let i = 0; i < 40; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }
      await deliveryPromise;

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Webhook: 1/2 endpoint(s) failed'),
      );

      vi.useRealTimers();
    });

    it('should NOT log when all endpoints succeed', async () => {
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

      const aggregationCalls = [
        ...consoleErrorSpy.mock.calls,
        ...consoleWarnSpy.mock.calls,
      ].filter(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('endpoint(s) failed'),
      );
      expect(aggregationCalls).toHaveLength(0);
    });
  });
});
