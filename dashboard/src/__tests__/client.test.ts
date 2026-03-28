/**
 * client.test.ts — Tests for retry logic (Issue #298) and SSE token security (Issue #408).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isRetryableError } from '../api/client';

describe('isRetryableError', () => {
  it('returns false for AbortError (should not retry)', () => {
    const error = new DOMException('The operation was aborted', 'AbortError');
    expect(isRetryableError(error)).toBe(false);
  });

  it('returns false for errors with HTTP status in message', () => {
    const error = new Error('HTTP 500 Internal Server Error');
    expect(isRetryableError(error)).toBe(false);
  });

  it('returns true for network errors', () => {
    const error = new Error('fetch failed');
    expect(isRetryableError(error)).toBe(true);
  });

  it('returns true for timeout errors', () => {
    const error = new Error('NetworkError: Failed to fetch');
    expect(isRetryableError(error)).toBe(true);
  });

  it('returns false for errors without a message', () => {
    const error = new Error('');
    expect(isRetryableError(error)).toBe(false);
  });
});

describe('SSE bearer token fallback (#408)', () => {
  // #408: Verify that when SSE token creation fails, the code NEVER falls back
  // to using the long-lived bearer token in the SSE URL query parameter.

  const BEARER_TOKEN = 'long-lived-bearer-token-12345';
  const SSE_TOKEN = 'short-lived-sse-token-67890';

  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;
  let MockRES: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    MockRES = vi.fn().mockImplementation(() => ({ close: vi.fn() }));
    vi.doMock('../api/resilient-eventsource', () => ({
      ResilientEventSource: MockRES,
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function mockSSERequest(token: string): Response {
    return new Response(
      JSON.stringify({ token, expiresAt: Date.now() + 60000 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  function mockFailedSSERequest(): Response {
    return new Response(
      JSON.stringify({ error: 'Internal Server Error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('subscribeSSE uses short-lived SSE token, not bearer token', async () => {
    fetchMock.mockResolvedValueOnce(mockSSERequest(SSE_TOKEN));

    const { subscribeSSE } = await import('../api/client');

    subscribeSSE('session-1', () => {}, BEARER_TOKEN);

    await vi.waitFor(() => {
      expect(MockRES).toHaveBeenCalled();
    });

    const calledUrl = MockRES.mock.calls[0][0] as string;
    expect(calledUrl).toContain(SSE_TOKEN);
    expect(calledUrl).not.toContain(BEARER_TOKEN);
  });

  it('subscribeSSE must NOT fall back to bearer token when SSE token creation fails', async () => {
    fetchMock.mockResolvedValue(mockFailedSSERequest());

    const { subscribeSSE } = await import('../api/client');

    const onGiveUp = vi.fn();
    subscribeSSE('session-1', () => {}, BEARER_TOKEN, { onGiveUp });

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(10000);

    expect(MockRES).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalled();
  });

  it('subscribeGlobalSSE must NOT fall back to bearer token when SSE token creation fails', async () => {
    fetchMock.mockResolvedValue(mockFailedSSERequest());

    const { subscribeGlobalSSE } = await import('../api/client');

    const onGiveUp = vi.fn();
    subscribeGlobalSSE(() => {}, BEARER_TOKEN, { onGiveUp });

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(10000);

    expect(MockRES).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalled();
  });

  it('subscribeSSE retries SSE token creation and succeeds on later attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(mockFailedSSERequest())
      .mockResolvedValueOnce(mockFailedSSERequest())
      .mockResolvedValueOnce(mockSSERequest(SSE_TOKEN));

    const { subscribeSSE } = await import('../api/client');

    subscribeSSE('session-1', () => {}, BEARER_TOKEN);

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(10000);

    expect(MockRES).toHaveBeenCalledTimes(1);
    const calledUrl = MockRES.mock.calls[0][0] as string;
    expect(calledUrl).toContain(SSE_TOKEN);
    expect(calledUrl).not.toContain(BEARER_TOKEN);
  });
});
