/**
 * Tests for services/sse-bridge.ts — SSE endpoint auth, tenant scoping, connection limiting.
 *
 * Issue #4393: /sse endpoint was unauthenticated and unscoped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerSSEBridge } from '../services/sse-bridge.js';
import type { RouteContext } from '../routes/context.js';

// Mock isGlobalEventVisibleToRequest — always visible in basic tests
vi.mock('../routes/events.js', () => ({
  isGlobalEventVisibleToRequest: vi.fn(() => true),
}));

function makeRouteCtx(overrides: Record<string, any> = {}): RouteContext {
  return {
    sessions: {
      getSession: vi.fn(),
      listSessions: vi.fn(() => []),
      approve: vi.fn(),
    } as any,
    auth: {} as any,
    quotas: {} as any,
    config: {} as any,
    metrics: {} as any,
    monitor: {} as any,
    eventBus: {
      subscribeGlobal: vi.fn(() => vi.fn()),
      getGlobalEventsSince: vi.fn(() => []),
    } as any,
    channels: {} as any,
    jsonlWatcher: {} as any,
    pipelines: {} as any,
    toolRegistry: {} as any,
    getAuditLogger: vi.fn(() => undefined),
    alertManager: {} as any,
    sseLimiter: {
      acquire: vi.fn(() => ({ allowed: true, connectionId: 'c1', current: 1, limit: 10 })),
      release: vi.fn(),
      registerWriter: vi.fn(),
      unregisterWriter: vi.fn(),
    } as any,
    memoryBridge: null,
    requestKeyMap: new Map(),
    validateWorkDir: vi.fn(async () => '/tmp'),
    draining: false,
    ...overrides,
  } as any;
}

function createMockFastify() {
  const routes: Array<{ method: string; url: string; handler: (req: any, reply: any) => any }> = [];
  return {
    get: vi.fn((url: string, optsOrHandler: any, handler?: (req: any, reply: any) => any) => {
      const actualHandler = typeof optsOrHandler === 'function' ? optsOrHandler : handler!;
      routes.push({ method: 'GET', url, handler: actualHandler });
    }),
    _routes: routes,
  } as any;
}

function createMockReqReply(overrides: Record<string, any> = {}) {
  const written: string[] = [];
  const headers: Record<string, string> = {};
  const closeHandlers: Array<() => void> = [];
  const raw = {
    writeHead: vi.fn((_status: number, hdrs: Record<string, string>) => { Object.assign(headers, hdrs); }),
    write: vi.fn((data: string) => { written.push(data); return true; }),
    _written: written,
    _headers: headers,
  };
  return {
    request: {
      ip: '127.0.0.1',
      id: 'test-req',
      tenantId: undefined,
      authKeyId: undefined,
      authRole: undefined,
      raw: { on: vi.fn((event: string, handler: () => void) => { if (event === 'close') closeHandlers.push(handler); }) },
      ...overrides,
    },
    reply: {
      raw,
      status: vi.fn(function(this: any, _code: number) { return this; }),
      send: vi.fn(function(this: any, _body: any) { return this; }),
      _closeHandlers: closeHandlers,
      _written: written,
    },
    written,
  };
}

describe('SSE Bridge (#4393)', () => {
  let routeCtx: RouteContext;
  let mockFastify: ReturnType<typeof createMockFastify>;

  beforeEach(() => {
    vi.clearAllMocks();
    routeCtx = makeRouteCtx();
    mockFastify = createMockFastify();
  });

  it('registers /v1/sse route (not /sse)', () => {
    registerSSEBridge(mockFastify, routeCtx);
    expect(mockFastify.get).toHaveBeenCalledWith('/v1/sse', expect.any(Function));
  });

  it('rejects connection when SSE limiter denies (per-IP limit)', async () => {
    (routeCtx.sseLimiter.acquire as any).mockReturnValue({
      allowed: false,
      reason: 'per_ip_limit',
      current: 11,
      limit: 10,
    });

    registerSSEBridge(mockFastify, routeCtx);
    const handler = mockFastify._routes[0].handler;
    const { request, reply } = createMockReqReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(429);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ reason: 'per_ip_limit' }));
  });

  it('rejects connection when SSE limiter denies (global limit)', async () => {
    (routeCtx.sseLimiter.acquire as any).mockReturnValue({
      allowed: false,
      reason: 'global_limit',
      current: 101,
      limit: 100,
    });

    registerSSEBridge(mockFastify, routeCtx);
    const handler = mockFastify._routes[0].handler;
    const { request, reply } = createMockReqReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(503);
  });

  it('subscribes to global events and forwards to client', async () => {
    const unsubscribe = vi.fn();
    (routeCtx.eventBus.subscribeGlobal as any).mockReturnValue(unsubscribe);

    registerSSEBridge(mockFastify, routeCtx);
    const handler = mockFastify._routes[0].handler;
    const { request, reply, written } = createMockReqReply();

    await handler(request, reply);

    // Should have subscribed
    expect(routeCtx.eventBus.subscribeGlobal).toHaveBeenCalledWith(expect.any(Function));

    // Simulate an event
    const subscribeHandler = (routeCtx.eventBus.subscribeGlobal as any).mock.calls[0][0];
    subscribeHandler({ id: 1, event: 'status.dead', sessionId: 's1' });

    expect(written.join('')).toContain('status.dead');

    // Cleanup
    for (const h of reply._closeHandlers) h();
    expect(unsubscribe).toHaveBeenCalled();
    expect(routeCtx.sseLimiter.release).toHaveBeenCalledWith('c1');
  });

  it('sends connected event on successful connection', async () => {
    registerSSEBridge(mockFastify, routeCtx);
    const handler = mockFastify._routes[0].handler;
    const { request, reply, written } = createMockReqReply();

    await handler(request, reply);

    expect(written.join('')).toContain('connected');
  });

  it('sets correct SSE headers', async () => {
    registerSSEBridge(mockFastify, routeCtx);
    const handler = mockFastify._routes[0].handler;
    const { request, reply } = createMockReqReply();

    await handler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }));
  });

  it('returns 500 if subscription fails', async () => {
    (routeCtx.eventBus.subscribeGlobal as any).mockImplementation(() => {
      throw new Error('subscription failed');
    });

    registerSSEBridge(mockFastify, routeCtx);
    const handler = mockFastify._routes[0].handler;
    const { request, reply } = createMockReqReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(routeCtx.sseLimiter.release).toHaveBeenCalledWith('c1');
  });

  it('uses request tenant context for event filtering', async () => {
    const { isGlobalEventVisibleToRequest } = await import('../routes/events.js');
    const mockVisible = vi.mocked(isGlobalEventVisibleToRequest);
    mockVisible.mockReturnValue(false); // Block all events

    registerSSEBridge(mockFastify, routeCtx);
    const handler = mockFastify._routes[0].handler;
    const { request, reply, written } = createMockReqReply({
      tenantId: 'tenant-42',
      authKeyId: 'key-1',
    });

    await handler(request, reply);

    // Fire an event — should be filtered out
    const subscribeHandler = (routeCtx.eventBus.subscribeGlobal as any).mock.calls[0][0];
    subscribeHandler({ id: 1, sessionId: 's1' });

    // The event data should NOT be written (only the initial connected event)
    const output = written.join('');
    expect(output).not.toContain('"sessionId"');
    expect(output).toContain('connected'); // Initial event still sent
  });
});
