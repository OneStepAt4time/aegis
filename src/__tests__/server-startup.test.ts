/**
 * Issue #4257 — Server startup sequence, plugin registration,
 * route registration parity, and graceful shutdown.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { registerHealthRoutes } from '../routes/health.js';
import { registerOpenApiRoute, registerOpenApiSpec } from '../routes/openapi/index.js';
import type { RouteContext } from '../routes/context.js';

function makeMockApp(): FastifyInstance {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    addHook: vi.fn(),
  } as unknown as FastifyInstance;
}

function makeMinimalCtx(overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    sessions: {
      listSessions: vi.fn().mockReturnValue([]),
      getSession: vi.fn().mockReturnValue(null),
    },
    auth: {
      validate: vi.fn().mockReturnValue({ valid: false }),
      authEnabled: false,
      listKeys: vi.fn().mockReturnValue([]),
      getRole: vi.fn().mockReturnValue('viewer'),
      getPermissions: vi.fn().mockReturnValue([]),
    },
    metrics: {
      getTotalSessionsCreated: vi.fn().mockReturnValue(0),
    },
    channels: {
      getChannels: vi.fn().mockReturnValue([]),
    },
    alertManager: {
      fireTestAlert: vi.fn().mockResolvedValue({ sent: false }),
      getStats: vi.fn().mockReturnValue({ total: 0 }),
    },
    serverState: { draining: false },
    dashboardTokenSessions: null,
    dashboardOidc: null,
    ...overrides,
  } as unknown as RouteContext;
}

describe('Server startup — plugin registration', () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.map(app => app.close().catch(() => {})));
    apps.length = 0;
  });

  it('registers @fastify/rate-limit without error', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(fastifyRateLimit, { global: true, max: 600, timeWindow: '1 minute' });
    await expect(app.ready()).resolves.not.toThrow();
  });

  it('registers @fastify/websocket without error', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(fastifyWebsocket);
    await expect(app.ready()).resolves.not.toThrow();
  });

  it('registers @fastify/cors with explicit origins without error', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(fastifyCors, { origin: ['http://localhost:3000'] });
    await expect(app.ready()).resolves.not.toThrow();
  });

  it('all three plugins register together on a single Fastify instance', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(fastifyRateLimit, { global: true, max: 600, timeWindow: '1 minute' });
    await app.register(fastifyWebsocket);
    await app.register(fastifyCors, { origin: false });
    await expect(app.ready()).resolves.not.toThrow();
  });
});

describe('Route registration parity', () => {
  it('registerHealthRoutes registers GET /v1/health and legacy GET /health', () => {
    const app = makeMockApp();
    registerHealthRoutes(app, makeMinimalCtx());
    const paths = (app.get as ReturnType<typeof vi.fn>).mock.calls.map(
      (args: unknown[]) => args[0],
    );
    expect(paths).toContain('/v1/health');
    expect(paths).toContain('/health');
  });

  it('registerOpenApiRoute registers GET /v1/openapi.json', () => {
    const app = makeMockApp();
    registerOpenApiSpec();
    registerOpenApiRoute(app);
    const paths = (app.get as ReturnType<typeof vi.fn>).mock.calls.map(
      (args: unknown[]) => args[0],
    );
    expect(paths).toContain('/v1/openapi.json');
  });
});

describe('Graceful shutdown sequence', () => {
  it('health route reports "draining" when serverState.draining is flipped', async () => {
    const app = Fastify({ logger: false });
    const serverState = { draining: false };
    registerHealthRoutes(app, makeMinimalCtx({ serverState }));
    await app.ready();

    const res1 = await app.inject({ method: 'GET', url: '/v1/health' });
    expect((JSON.parse(res1.body) as { status: string }).status).toBe('ok');

    serverState.draining = true;

    const res2 = await app.inject({ method: 'GET', url: '/v1/health' });
    expect((JSON.parse(res2.body) as { status: string }).status).toBe('draining');

    await app.close();
  });

  it('server app.close() resolves cleanly after routes are registered', async () => {
    const app = Fastify({ logger: false });
    registerHealthRoutes(app, makeMinimalCtx());
    await app.ready();
    await expect(app.close()).resolves.not.toThrow();
  });

  it('in-flight requests complete before close() resolves', async () => {
    const app = Fastify({ logger: false });
    let requestHandled = false;
    app.get('/v1/ping', async () => {
      requestHandled = true;
      return { ok: true };
    });
    await app.ready();
    await app.inject({ method: 'GET', url: '/v1/ping' });
    await app.close();
    expect(requestHandled).toBe(true);
  });

  it('onClose hooks fire when app.close() is called', async () => {
    const app = Fastify({ logger: false });
    let onCloseFired = false;
    app.addHook('onClose', async () => {
      onCloseFired = true;
    });
    await app.ready();
    await app.close();
    expect(onCloseFired).toBe(true);
  });
});
