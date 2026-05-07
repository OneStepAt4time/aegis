/**
 * acp-chat-client.test.ts — Tests for the ACP chat API client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock getAuthHeaders
vi.mock('../api/client.js', () => ({
  getAuthHeaders: vi.fn((extra = {}) => ({
    'Content-Type': 'application/json',
    ...extra,
  })),
}));

import { sendPrompt } from '../api/acp-chat-client.js';

describe('acp-chat-client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('sendPrompt', () => {
    it('sends POST to /v1/sessions/:id/send with text body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, delivered: true, attempts: 1 }),
      });

      const result = await sendPrompt('sess-123', 'Hello, agent!');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/v1/sessions/sess-123/send');
      expect(options.method).toBe('POST');
      expect(options.credentials).toBe('include');
      expect(JSON.parse(options.body)).toEqual({ text: 'Hello, agent!' });
      expect(result).toEqual({ ok: true, delivered: true, attempts: 1 });
    });

    it('encodes sessionId safely', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, delivered: true, attempts: 1 }),
      });

      await sendPrompt('sess/special+chars', 'test');

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe('/v1/sessions/sess%2Fspecial%2Bchars/send');
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(sendPrompt('sess-123', 'test')).rejects.toThrow(
        'Failed to send prompt: 401',
      );
    });

    it('throws on network error with status text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal error'),
      });

      await expect(sendPrompt('sess-123', 'test')).rejects.toThrow(
        'Failed to send prompt: 500 — Internal error',
      );
    });

    it('handles text() failure gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: () => Promise.reject(new Error('parse error')),
      });

      await expect(sendPrompt('sess-123', 'test')).rejects.toThrow(
        'Failed to send prompt: 502',
      );
    });

    it('passes AbortSignal through to fetch', async () => {
      const controller = new AbortController();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, delivered: true, attempts: 1 }),
      });

      await sendPrompt('sess-123', 'test', controller.signal);

      const options = mockFetch.mock.calls[0][1];
      expect(options.signal).toBe(controller.signal);
    });
  });
});
