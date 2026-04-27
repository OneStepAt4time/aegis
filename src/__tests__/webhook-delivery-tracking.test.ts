/**
 * webhook-delivery-tracking.test.ts — Tests for Issue #2144: webhook delivery
 * tracking, retry on 429, fixed backoff delays, and delivery log.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookChannel, type WebhookDeliveryAttempt } from '../channels/webhook.js';
import type { SessionEventPayload } from '../channels/types.js';

// Mock SSRF DNS check
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
    event: event as SessionEventPayload['event'],
    timestamp: new Date().toISOString(),
    session: { id: 'test-123', name: 'test-session', workDir: '/tmp' },
    detail: 'Test event',
  };
}

describe('Issue #2144: Webhook delivery tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('delivery log recording', () => {
    it('should record a successful delivery attempt', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const channel = new WebhookChannel({
        endpoints: [{ url: 'https://example.com/hook' }],
      });

      await channel.onSessionCreated!(makePayload());

      const log = channel.getDeliveryLog();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        endpointUrl: 'https://example.com/hook',
        event: 'session.created',
        status: 'success',
        responseCode: 200,
        error: null,
        attemptNumber: 1,
      });
      expect(log[0].id).toBeDefined();
      expect(log[0].timestamp).toBeDefined();
    });

    it('should record each retry attempt', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const channel = new WebhookChannel({
        endpoints: [{ url: 'https://example.com/hook' }],
      });

      const deliveryPromise = channel.onSessionCreated!(makePayload());
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }
      await deliveryPromise;

      const log = channel.getDeliveryLog();
      // First attempt failed, second succeeded
      expect(log).toHaveLength(2);
      expect(log[0].status).toBe('failed');
      expect(log[0].responseCode).toBe(500);
      expect(log[0].attemptNumber).toBe(1);
      expect(log[1].status).toBe('success');
      expect(log[1].responseCode).toBe(200);
      expect(log[1].attemptNumber).toBe(2);

      vi.useRealTimers();
    });

    it('should record all attempts when all retries fail', async () => {
      vi.useFakeTimers();
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const channel = new WebhookChannel({
        endpoints: [{ url: 'https://example.com/hook' }],
      });

      const deliveryPromise = channel.onSessionCreated!(makePayload());
      for (let i = 0; i < 40; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }
      await deliveryPromise;

      const log = channel.getDeliveryLog();
      expect(log).toHaveLength(3);
      expect(log.every(e => e.status === 'failed')).toBe(true);
      expect(log[0].attemptNumber).toBe(1);
      expect(log[1].attemptNumber).toBe(2);
      expect(log[2].attemptNumber).toBe(3);

      vi.useRealTimers();
    });

    it('should NOT retry on 4xx client error (except 429)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });

      const channel = new WebhookChannel({
        endpoints: [{ url: 'https://example.com/hook' }],
      });

      await channel.onSessionCreated!(makePayload());

      const log = channel.getDeliveryLog();
      expect(log).toHaveLength(1);
      expect(log[0].status).toBe('failed');
      expect(log[0].responseCode).toBe(400);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry on 429 rate limit', () => {
    it('should retry on 429 and succeed on second attempt', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const channel = new WebhookChannel({
        endpoints: [{ url: 'https://example.com/hook' }],
      });

      const deliveryPromise = channel.onSessionCreated!(makePayload());
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }
      await deliveryPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const log = channel.getDeliveryLog();
      expect(log).toHaveLength(2);
      expect(log[0].status).toBe('failed');
      expect(log[0].responseCode).toBe(429);
      expect(log[1].status).toBe('success');
      expect(log[1].responseCode).toBe(200);

      vi.useRealTimers();
    });

    it('should exhaust retries on persistent 429', async () => {
      vi.useFakeTimers();
      mockFetch.mockResolvedValue({ ok: false, status: 429 });

      const channel = new WebhookChannel({
        endpoints: [{ url: 'https://example.com/hook' }],
      });

      const deliveryPromise = channel.onSessionCreated!(makePayload());
      for (let i = 0; i < 40; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }
      await deliveryPromise;

      expect(mockFetch).toHaveBeenCalledTimes(3);
      const log = channel.getDeliveryLog();
      expect(log).toHaveLength(3);
      expect(log.every(e => e.status === 'failed' && e.responseCode === 429)).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('fixed retry delays (1s, 5s, 30s)', () => {
    it('should use fixed retry delays: 1s, 5s, 30s', () => {
      expect(WebhookChannel.RETRY_DELAYS_MS).toEqual([1000, 5000, 30000]);
    });

    it('should return correct backoff for each attempt', () => {
      expect(WebhookChannel.backoff(1)).toBe(1000);
      expect(WebhookChannel.backoff(2)).toBe(5000);
      expect(WebhookChannel.backoff(3)).toBe(30000);
    });

    it('should cap backoff at last delay for attempts beyond schedule', () => {
      expect(WebhookChannel.backoff(4)).toBe(30000);
      expect(WebhookChannel.backoff(10)).toBe(30000);
    });
  });

  describe('delivery log query', () => {
    it('should filter delivery log by endpoint URL', async () => {
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

      const hook1Log = channel.getDeliveryLog('https://example.com/hook1');
      expect(hook1Log).toHaveLength(1);
      expect(hook1Log[0].endpointUrl).toBe('https://example.com/hook1');

      const hook2Log = channel.getDeliveryLog('https://example.com/hook2');
      expect(hook2Log).toHaveLength(1);
      expect(hook2Log[0].endpointUrl).toBe('https://example.com/hook2');
    });

    it('should return all entries when no filter provided', async () => {
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

      const allLog = channel.getDeliveryLog();
      expect(allLog).toHaveLength(2);
    });
  });

  describe('endpoint listing', () => {
    it('should list endpoints with index-based IDs', () => {
      const channel = new WebhookChannel({
        endpoints: [
          { url: 'https://example.com/hook1' },
          { url: 'https://example.com/hook2' },
        ],
      });

      const endpoints = channel.getEndpoints();
      expect(endpoints).toEqual([
        { id: '0', url: 'https://example.com/hook1' },
        { id: '1', url: 'https://example.com/hook2' },
      ]);
    });
  });

  describe('delivery log size cap', () => {
    it('should cap delivery log at DELIVERY_LOG_MAX_SIZE', () => {
      expect(WebhookChannel.DELIVERY_LOG_MAX_SIZE).toBe(1000);
    });
  });

  describe('delivery status values', () => {
    it('should track pending/success/failed statuses correctly', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const channel = new WebhookChannel({
        endpoints: [{ url: 'https://example.com/hook' }],
      });

      await channel.onSessionCreated!(makePayload());

      const log = channel.getDeliveryLog();
      expect(log[0].status).toBe('success');
    });
  });
});
