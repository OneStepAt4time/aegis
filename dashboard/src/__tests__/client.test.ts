/**
 * client.test.ts — Tests for retry logic (Issue #298) and SSE token security (Issue #408).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkForUpdates, isRetryableError } from '../api/client';

describe('audit client helpers (#1923)', () => {
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

  it('fetchAuditLogs sends API-compatible filters and cursor params', async () => {
    const from = '2026-04-17T10:15:00.000Z';
    const to = '2026-04-17T10:45:00.000Z';

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      count: 1,
      total: 1,
      records: [{
        ts: '2026-04-17T10:30:00.000Z',
        actor: 'admin-key',
        action: 'session.kill',
        sessionId: '22222222-2222-2222-2222-222222222222',
        detail: 'Killed session two',
        prevHash: 'hash-1',
        hash: 'hash-2',
      }],
      filters: {
        actor: 'admin-key',
        action: 'session.kill',
        sessionId: '22222222-2222-2222-2222-222222222222',
        from,
        to,
      },
      pagination: {
        limit: 25,
        hasMore: true,
        nextCursor: 'cursor-page-2',
        reverse: true,
      },
      chain: {
        count: 1,
        firstHash: 'hash-2',
        lastHash: 'hash-2',
        badgeHash: 'badge-hash',
        firstTs: '2026-04-17T10:30:00.000Z',
        lastTs: '2026-04-17T10:30:00.000Z',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const { fetchAuditLogs } = await import('../api/client');

    await expect(fetchAuditLogs({
      limit: 25,
      cursor: 'cursor-page-1',
      actor: 'admin-key',
      action: 'session.kill',
      sessionId: '22222222-2222-2222-2222-222222222222',
      from,
      to,
      reverse: true,
    })).resolves.toMatchObject({
      total: 1,
      pagination: { nextCursor: 'cursor-page-2' },
      chain: { badgeHash: 'badge-hash' },
    });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl, 'http://localhost');
    expect(url.pathname).toBe('/v1/audit');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('cursor')).toBe('cursor-page-1');
    expect(url.searchParams.get('actor')).toBe('admin-key');
    expect(url.searchParams.get('action')).toBe('session.kill');
    expect(url.searchParams.get('sessionId')).toBe('22222222-2222-2222-2222-222222222222');
    expect(url.searchParams.get('from')).toBe(from);
    expect(url.searchParams.get('to')).toBe(to);
    expect(url.searchParams.get('reverse')).toBe('true');
    expect(url.searchParams.get('format')).toBe('json');
    expect(requestInit.headers).toEqual(expect.not.objectContaining({ Accept: expect.anything() }));
  });

  it('exportAuditLogs downloads the file and returns header metadata', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ts,actor,action,sessionId,detail,prevHash,hash\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="audit-export-2026-04-17.csv"',
        'X-Aegis-Audit-Record-Count': '1',
        'X-Aegis-Audit-First-Hash': 'first-hash',
        'X-Aegis-Audit-Last-Hash': 'last-hash',
        'X-Aegis-Audit-Chain-Badge': 'badge-hash',
        'X-Aegis-Audit-First-Ts': '2026-04-17T10:00:00.000Z',
        'X-Aegis-Audit-Last-Ts': '2026-04-17T10:30:00.000Z',
        'X-Aegis-Audit-Integrity-Valid': 'true',
        'X-Aegis-Audit-Integrity-File': 'audit-2026-04-17.log',
      },
    }));

    const link = document.createElement('a');
    const clickSpy = vi.spyOn(link, 'click').mockImplementation(() => {});
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(link);
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/fake');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const { exportAuditLogs, setTokenAccessor } = await import('../api/client');
    setTokenAccessor(() => 'stored-token');

    await expect(exportAuditLogs({
      format: 'csv',
      actor: 'admin-key',
      action: 'session.kill',
      sessionId: '22222222-2222-2222-2222-222222222222',
      verify: true,
      reverse: true,
    })).resolves.toEqual({
      filename: 'audit-export-2026-04-17.csv',
      format: 'csv',
      mimeType: 'text/csv; charset=utf-8',
      chain: {
        count: 1,
        firstHash: 'first-hash',
        lastHash: 'last-hash',
        badgeHash: 'badge-hash',
        firstTs: '2026-04-17T10:00:00.000Z',
        lastTs: '2026-04-17T10:30:00.000Z',
      },
      integrity: {
        valid: true,
        file: 'audit-2026-04-17.log',
      },
    });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl, 'http://localhost');
    expect(url.searchParams.get('format')).toBe('csv');
    expect(url.searchParams.get('verify')).toBe('true');
    expect(url.searchParams.get('actor')).toBe('admin-key');
    expect(url.searchParams.get('action')).toBe('session.kill');
    expect(url.searchParams.get('sessionId')).toBe('22222222-2222-2222-2222-222222222222');
    expect(requestInit.headers).toEqual(expect.objectContaining({
      Accept: 'text/csv',
      Authorization: 'Bearer stored-token',
    }));
    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(link.download).toBe('audit-export-2026-04-17.csv');
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:http://localhost/fake');
  });
});

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
      rate_limit: 0,
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

describe('dashboard OIDC session client (#1942)', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

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
    localStorage.clear();
  });

  it('treats /auth/session 404 as OIDC unavailable', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }));

    const { getDashboardSession } = await import('../api/client');

    await expect(getDashboardSession()).resolves.toEqual({ oidcAvailable: false, authenticated: false });
    expect(fetchMock).toHaveBeenCalledWith('/auth/session', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    }));
  });

  it('treats /auth/session 401 as OIDC available but unauthenticated', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: false }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));

    const { getDashboardSession } = await import('../api/client');

    await expect(getDashboardSession()).resolves.toEqual({ oidcAvailable: true, authenticated: false });
  });

  it('returns only dashboard identity fields for authenticated OIDC sessions', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      oidcAvailable: true,
      authenticated: true,
      authMethod: 'oidc',
      userId: 'user-123',
      email: 'dev@example.com',
      name: 'Dev User',
      tenantId: 'default',
      role: 'viewer',
      createdAt: 1,
      expiresAt: 2,
      idToken: 'secret-id-token',
      accessToken: 'secret-access-token',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const { getDashboardSession } = await import('../api/client');

    const result = await getDashboardSession();

    expect(result).toEqual({
      oidcAvailable: true,
      authenticated: true,
      authMethod: 'oidc',
      identity: {
        authenticated: true,
        userId: 'user-123',
        email: 'dev@example.com',
        name: 'Dev User',
        tenantId: 'default',
        role: 'viewer',
        createdAt: 1,
        expiresAt: 2,
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(localStorage.length).toBe(0);
  });

  it('treats clean /auth/session unauthenticated responses as token-auth mode without 404 noise', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ oidcAvailable: false, authenticated: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const { getDashboardSession } = await import('../api/client');

    await expect(getDashboardSession()).resolves.toEqual({ oidcAvailable: false, authenticated: false });
  });

  it('posts OIDC logout with cookies and no bearer token', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { logoutDashboardSession } = await import('../api/client');

    await expect(logoutDashboardSession()).resolves.toBe('logged-out');
    expect(fetchMock).toHaveBeenCalledWith('/auth/logout', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    }));
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(requestInit.headers).toEqual(expect.not.objectContaining({ Authorization: expect.anything() }));
  });
});

describe('dashboard cookie-backed API requests (#2351)', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  const healthPayload = {
    status: 'ok',
    version: '2.4.1',
    platform: 'win32',
    uptime: 12,
    sessions: { active: 0, total: 0 },
    timestamp: '2026-04-17T10:30:00.000Z',
  };

  beforeEach(() => {
    vi.resetModules();
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('sends the HttpOnly dashboard session cookie on API requests after token login upgrade', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ oidcAvailable: false, authenticated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true, role: 'admin' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        oidcAvailable: false,
        authenticated: true,
        authMethod: 'token',
        userId: 'api-key:key-1',
        tenantId: 'default',
        role: 'admin',
        createdAt: 1,
        expiresAt: 2,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(healthPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const [{ useAuthStore }, { getHealth }] = await Promise.all([
      import('../store/useAuthStore'),
      import('../api/client'),
    ]);

    await useAuthStore.getState().init();
    await expect(useAuthStore.getState().login('my-token')).resolves.toBe(true);
    await expect(getHealth()).resolves.toMatchObject({ version: '2.4.1' });

    const verifyInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(verifyInit.credentials).toBe('include');

    const healthInit = fetchMock.mock.calls[3][1] as RequestInit;
    expect(fetchMock.mock.calls[3][0]).toBe('/v1/health');
    expect(healthInit.credentials).toBe('include');
    expect(healthInit.headers).toEqual(expect.not.objectContaining({ Authorization: expect.anything() }));
    expect(useAuthStore.getState().token).toBeNull();
    expect(localStorage.getItem('aegis_token')).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it('includes credentials by default for API calls with no in-memory bearer token', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(healthPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const { getHealth, setTokenAccessor } = await import('../api/client');
    setTokenAccessor(() => null);

    await expect(getHealth()).resolves.toMatchObject({ status: 'ok' });

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(fetchMock.mock.calls[0][0]).toBe('/v1/health');
    expect(requestInit.credentials).toBe('include');
    expect(requestInit.headers).toEqual(expect.not.objectContaining({ Authorization: expect.anything() }));
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

describe('401 unauthorized handling (#1567)', () => {
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

  it('uses the registered in-memory token accessor for authenticated requests', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const { getPipelines, setTokenAccessor } = await import('../api/client');
    setTokenAccessor(() => 'memory-token');

    await expect(getPipelines()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith('/v1/pipelines', expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer memory-token',
      }),
    }));
  });

  it('triggers unauthorized handler when API returns 401', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));

    const { getPipelines, setTokenAccessor, setUnauthorizedHandler } = await import('../api/client');
    const onUnauthorized = vi.fn();
    setTokenAccessor(() => 'stale-token');
    setUnauthorizedHandler(onUnauthorized);

    await expect(getPipelines()).rejects.toThrow('Unauthorized');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
