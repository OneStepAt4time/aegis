/**
 * client.test.ts — Tests for retry logic (Issue #298) and SSE token security (Issue #408).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkForUpdates, isRetryableError } from '../api/client';

describe('getSessionStatusCounts', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('uses the aggregated session stats endpoint in a single request', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      active: 3,
      byStatus: {
        idle: 1,
        working: 1,
        permission_prompt: 1,
      },
      totalCreated: 3,
      totalCompleted: 1,
      totalFailed: 0,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const { getSessionStatusCounts } = await import('../api/client');

    await expect(getSessionStatusCounts()).resolves.toEqual({
      all: 3,
      idle: 1,
      working: 1,
      compacting: 0,
      context_warning: 0,
      waiting_for_input: 0,
      permission_prompt: 1,
      plan_mode: 0,
      ask_question: 0,
      bash_approval: 0,
      settings: 0,
      error: 0,
      unknown: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/stats', expect.objectContaining({
      headers: expect.not.objectContaining({ 'Content-Type': 'application/json' }),
    }));
  });
});

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

describe('checkForUpdates', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses the npm registry latest endpoint and returns up-to-date state', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ version: '2.15.5' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await checkForUpdates('2.15.5');

    expect(fetchMock).toHaveBeenCalledWith('https://registry.npmjs.org/@onestepat4time%2Faegis/latest', {
      headers: { Accept: 'application/json' },
    });
    expect(result).toEqual({
      currentVersion: '2.15.5',
      latestVersion: '2.15.5',
      updateAvailable: false,
      releaseUrl: 'https://www.npmjs.com/package/@onestepat4time%2Faegis',
    });
  });

  it('detects when a newer npm package version is available', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ version: '2.16.0' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await checkForUpdates('2.15.5');

    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe('2.16.0');
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
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    MockRES = vi.fn().mockImplementation(function () { return { close: vi.fn() }; });
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

describe('SSE unmount race condition (#416)', () => {
  // #416: Verify that if the component unmounts during async token fetch,
  // the in-flight fetch is aborted and no ResilientEventSource leaks.

  const BEARER_TOKEN = 'long-lived-bearer-token-12345';
  const SSE_TOKEN = 'short-lived-sse-token-67890';

  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;
  let MockRES: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    MockRES = vi.fn().mockImplementation(function () { return { close: vi.fn() }; });
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

  it('subscribeSSE: cleanup before token fetch resolves prevents ResilientEventSource creation', async () => {
    // Token fetch never resolves (pending forever)
    fetchMock.mockReturnValue(new Promise(() => {}));

    const { subscribeSSE } = await import('../api/client');

    const unsubscribe = subscribeSSE('session-1', () => {}, BEARER_TOKEN);

    // Unmount immediately — before token fetch resolves
    unsubscribe();

    // Advance timers to flush any pending microtasks
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(10000);

    expect(MockRES).not.toHaveBeenCalled();
  });

  it('subscribeSSE: cleanup closes ResilientEventSource if created after token fetch', async () => {
    const closeFn = vi.fn();
    MockRES.mockImplementation(function () { return { close: closeFn }; });
    fetchMock.mockResolvedValueOnce(mockSSERequest(SSE_TOKEN));

    const { subscribeSSE } = await import('../api/client');

    const unsubscribe = subscribeSSE('session-1', () => {}, BEARER_TOKEN);

    // Wait for token fetch to resolve and RES to be created
    await vi.waitFor(() => {
      expect(MockRES).toHaveBeenCalledTimes(1);
    });

    // Now unmount
    unsubscribe();

    expect(closeFn).toHaveBeenCalled();
  });

  it('subscribeSSE: abort signal cancels in-flight token fetch', async () => {
    // Simulate a slow fetch that captures the AbortSignal
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, opts?: RequestInit) => {
      capturedSignal = opts?.signal as AbortSignal | undefined;
      return new Promise(() => {});
    });

    const { subscribeSSE } = await import('../api/client');

    const unsubscribe = subscribeSSE('session-1', () => {}, BEARER_TOKEN);

    // Give the fetch call a chance to execute
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    unsubscribe();

    // The AbortSignal should have been aborted
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('subscribeSSE: repeated async mount/unmount cycles do not leak EventSource listeners', async () => {
    const pendingFetches: Array<{
      resolve: (response: Response) => void;
      signal?: AbortSignal;
    }> = [];

    fetchMock.mockImplementation((_url: string, opts?: RequestInit) => {
      return new Promise<Response>((resolve) => {
        pendingFetches.push({
          resolve,
          signal: opts?.signal as AbortSignal | undefined,
        });
      });
    });

    const { subscribeSSE } = await import('../api/client');

    const unsubscribeA = subscribeSSE('session-1', () => {}, BEARER_TOKEN);
    const unsubscribeB = subscribeSSE('session-1', () => {}, BEARER_TOKEN);

    unsubscribeA();
    unsubscribeB();

    expect(pendingFetches).toHaveLength(2);
    expect(pendingFetches[0].signal?.aborted).toBe(true);
    expect(pendingFetches[1].signal?.aborted).toBe(true);

    pendingFetches[0].resolve(mockSSERequest(SSE_TOKEN));
    pendingFetches[1].resolve(mockSSERequest(SSE_TOKEN));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(MockRES).not.toHaveBeenCalled();
  });

  it('subscribeGlobalSSE: cleanup before token fetch resolves prevents ResilientEventSource creation', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    const { subscribeGlobalSSE } = await import('../api/client');

    const unsubscribe = subscribeGlobalSSE(() => {}, BEARER_TOKEN);

    unsubscribe();

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(10000);

    expect(MockRES).not.toHaveBeenCalled();
  });

  it('subscribeGlobalSSE: cleanup closes ResilientEventSource if already created', async () => {
    const closeFn = vi.fn();
    MockRES.mockImplementation(function () { return { close: closeFn }; });
    fetchMock.mockResolvedValueOnce(mockSSERequest(SSE_TOKEN));

    const { subscribeGlobalSSE } = await import('../api/client');

    const unsubscribe = subscribeGlobalSSE(() => {}, BEARER_TOKEN);

    await vi.waitFor(() => {
      expect(MockRES).toHaveBeenCalledTimes(1);
    });

    unsubscribe();

    expect(closeFn).toHaveBeenCalled();
  });

  it('subscribeGlobalSSE: abort signal cancels in-flight token fetch', async () => {
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, opts?: RequestInit) => {
      capturedSignal = opts?.signal as AbortSignal | undefined;
      return new Promise(() => {});
    });

    const { subscribeGlobalSSE } = await import('../api/client');

    const unsubscribe = subscribeGlobalSSE(() => {}, BEARER_TOKEN);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    unsubscribe();

    expect(capturedSignal?.aborted).toBe(true);
  });
});
