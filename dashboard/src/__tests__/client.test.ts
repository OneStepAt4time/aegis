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

    expect(fetchMock).toHaveBeenCalledWith('https://registry.npmjs.org/@onestepat4time/aegis/latest', {
      headers: { Accept: 'application/json' },
    });
    expect(result).toEqual({
      currentVersion: '2.15.5',
      latestVersion: '2.15.5',
      updateAvailable: false,
      releaseUrl: 'https://www.npmjs.com/package/@onestepat4time/aegis',
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

describe('client REST functions', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function okBody(): Response {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('getHealth calls /v1/health', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getHealth } = await import('../api/client.js');
    await expect(getHealth()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith('/v1/health', expect.any(Object));
  });

  it('getMetrics calls /v1/metrics', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getMetrics } = await import('../api/client.js');
    await expect(getMetrics()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith('/v1/metrics', expect.any(Object));
  });

  it('getSessions calls /v1/sessions', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getSessions } = await import('../api/client.js');
    await expect(getSessions()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions', expect.any(Object));
  });

  it('getSession calls /v1/sessions/:id', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getSession } = await import('../api/client.js');
    await expect(getSession('s1')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1', expect.any(Object));
  });

  it('sendMessage sends POST to /v1/sessions/:id/send', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { sendMessage } = await import('../api/client.js');
    await expect(sendMessage('s1', 'hello')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1/send', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: 'hello' }),
    }));
  });

  it('killSession sends DELETE to /v1/sessions/:id', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { killSession } = await import('../api/client.js');
    await killSession('s1');
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('approve sends POST to /v1/sessions/:id/approve', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { approve } = await import('../api/client.js');
    await approve('s1');
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1/approve', expect.objectContaining({ method: 'POST' }));
  });

  it('reject sends POST to /v1/sessions/:id/reject', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { reject } = await import('../api/client.js');
    await reject('s1');
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1/reject', expect.objectContaining({ method: 'POST' }));
  });

  it('interrupt sends POST to /v1/sessions/:id/interrupt', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { interrupt } = await import('../api/client.js');
    await interrupt('s1');
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1/interrupt', expect.objectContaining({ method: 'POST' }));
  });

  it('escape sends POST to /v1/sessions/:id/escape', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { escape } = await import('../api/client.js');
    await escape('s1');
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1/escape', expect.objectContaining({ method: 'POST' }));
  });

  it('sendCommand sends POST to /v1/sessions/:id/command', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { sendCommand } = await import('../api/client.js');
    await sendCommand('s1', '/clear');
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1/command', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ command: '/clear' }),
    }));
  });

  it('sendBash sends POST to /v1/sessions/:id/bash', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { sendBash } = await import('../api/client.js');
    await sendBash('s1', 'ls');
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1/bash', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ command: 'ls' }),
    }));
  });

  it('getSessionMessages calls /v1/sessions/:id/read', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getSessionMessages } = await import('../api/client.js');
    await expect(getSessionMessages('s1')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1/read', expect.any(Object));
  });

  it('getSessionSummary calls /v1/sessions/:id/summary', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getSessionSummary } = await import('../api/client.js');
    await getSessionSummary('s1');
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1/summary', expect.any(Object));
  });

  it('getSessionMetrics calls /v1/sessions/:id/metrics', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getSessionMetrics } = await import('../api/client.js');
    await expect(getSessionMetrics('s1')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1/metrics', expect.any(Object));
  });

  it('getSessionLatency calls /v1/sessions/:id/latency', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getSessionLatency } = await import('../api/client.js');
    await expect(getSessionLatency('s1')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1/latency', expect.any(Object));
  });

  it('getSessionPane calls /v1/sessions/:id/pane', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getSessionPane } = await import('../api/client.js');
    await getSessionPane('s1');
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1/pane', expect.any(Object));
  });

  it('getScreenshot calls /v1/sessions/:id/screenshot', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getScreenshot } = await import('../api/client.js');
    await getScreenshot('s1');
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1/screenshot', expect.any(Object));
  });

  it('forkSession sends POST to /v1/sessions/:id/fork', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { forkSession } = await import('../api/client.js');
    await expect(forkSession('s1')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1/fork', expect.objectContaining({ method: 'POST' }));
  });

  it('getPipelines calls /v1/pipelines', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getPipelines } = await import('../api/client.js');
    await getPipelines();
    expect(fetchMock).toHaveBeenCalledWith('/v1/pipelines', expect.any(Object));
  });

  it('getPipeline calls /v1/pipelines/:id', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getPipeline } = await import('../api/client.js');
    await getPipeline('p1');
    expect(fetchMock).toHaveBeenCalledWith('/v1/pipelines/p1', expect.any(Object));
  });

  it('getTemplates calls /v1/templates', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getTemplates } = await import('../api/client.js');
    await getTemplates();
    expect(fetchMock).toHaveBeenCalledWith('/v1/templates', expect.any(Object));
  });

  it('getTemplate calls /v1/templates/:id', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getTemplate } = await import('../api/client.js');
    await getTemplate('t1');
    expect(fetchMock).toHaveBeenCalledWith('/v1/templates/t1', expect.any(Object));
  });

  it('deleteTemplate sends DELETE to /v1/templates/:id', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { deleteTemplate } = await import('../api/client.js');
    await deleteTemplate('t1');
    expect(fetchMock).toHaveBeenCalledWith('/v1/templates/t1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('getAuthKeys calls /v1/auth/keys', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getAuthKeys } = await import('../api/client.js');
    await expect(getAuthKeys()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith('/v1/auth/keys', expect.any(Object));
  });

  it('revokeAuthKey sends DELETE to /v1/auth/keys/:id', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { revokeAuthKey } = await import('../api/client.js');
    await revokeAuthKey('k1');
    expect(fetchMock).toHaveBeenCalledWith('/v1/auth/keys/k1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('verifyToken sends POST to /v1/auth/verify', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { verifyToken } = await import('../api/client.js');
    await verifyToken('my-token');
    expect(fetchMock).toHaveBeenCalledWith('/v1/auth/verify', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: 'my-token' }),
    }));
  });

  it('createAuthKey sends POST to /v1/auth/keys', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { createAuthKey } = await import('../api/client.js');
    await expect(createAuthKey('test-key')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith('/v1/auth/keys', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'test-key' }),
    }));
  });

  it('getAllSessionsHealth calls /v1/sessions/health', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getAllSessionsHealth } = await import('../api/client.js');
    await expect(getAllSessionsHealth()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/health', expect.any(Object));
  });

  it('getSessionHealth calls /v1/sessions/:id/health', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { getSessionHealth } = await import('../api/client.js');
    await expect(getSessionHealth('s1')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith('/v1/sessions/s1/health', expect.any(Object));
  });

  it('fetchAuditLogs calls /v1/audit', async () => {
    fetchMock.mockResolvedValueOnce(okBody());
    const { fetchAuditLogs } = await import('../api/client.js');
    await fetchAuditLogs();
    expect(fetchMock).toHaveBeenCalledWith('/v1/audit', expect.any(Object));
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
