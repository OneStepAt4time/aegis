/**
 * route-aliases-2461.test.ts — Tests for Issue #2461:
 *   POST /v1/sessions/:id/input  → alias for /send
 *   POST /v1/sessions/:id/kill   → alias for DELETE /v1/sessions/:id
 *   POST /v1/sessions/:id/terminate → alias for DELETE /v1/sessions/:id
 *   POST /v1/sessions/:id/stop   → alias for DELETE /v1/sessions/:id
 *   GET  /v1/sessions/:id/stream → alias for /events SSE
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_file: string, _args: string[], _options: unknown, callback?: (error: Error | null) => void) => {
    callback?.(new Error('claude unavailable'));
  }),
}));

import type { FastifyInstance } from 'fastify';
import type { SessionInfo } from '../session.js';
import type { RouteContext } from '../routes/context.js';
import { registerSessionActionRoutes } from '../routes/session-actions.js';
import { registerSessionDataRoutes } from '../routes/session-data.js';

type RouteMethod = 'post' | 'get' | 'put' | 'delete';
type PermissionName = 'create' | 'send' | 'approve' | 'reject' | 'kill';

function makeMockApp(): FastifyInstance {
  return {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  } as unknown as FastifyInstance;
}

function makeReply() {
  const body: { statusCode?: number; payload?: unknown } = {};
  const send = vi.fn((payload: unknown) => {
    body.payload = payload;
    return payload;
  });
  const status = vi.fn((statusCode: number) => {
    body.statusCode = statusCode;
    return { send };
  });
  return { send, status, body };
}

function getHandler(app: FastifyInstance, method: RouteMethod, path: string) {
  const mockMethod = app[method] as ReturnType<typeof vi.fn>;
  const call = mockMethod.mock.calls.find((args: unknown[]) => args[0] === path);
  if (!call) {
    throw new Error(`Missing route registration for ${method.toUpperCase()} ${path}`);
  }
  const handlerOrOptions = call[1];
  if (typeof handlerOrOptions === 'function') {
    return handlerOrOptions as (req: unknown, reply: unknown) => Promise<unknown>;
  }
  return (handlerOrOptions as { handler: (req: unknown, reply: unknown) => Promise<unknown> }).handler;
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    windowId: '@1',
    windowName: 'cc-test',
    workDir: '/home/user/repo',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ownerKeyId: 'key-owner',
    ...overrides,
  } as SessionInfo;
}

function makeContext(granted: Partial<Record<PermissionName, boolean>> = {}) {
  const ownedSession = makeSession();
  const auth = {
    authEnabled: true,
    hasPermission: vi.fn((_keyId: string | null | undefined, permission: PermissionName) => granted[permission] ?? false),
    getRole: vi.fn((keyId: string | null | undefined) => (keyId === 'master' ? 'admin' : 'viewer')),
    getAuditActor: vi.fn((keyId: string | null | undefined, fallbackActor = 'system') => {
      if (keyId === null || keyId === undefined) return fallbackActor;
      return keyId === 'master' ? 'master' : `actor:${keyId}`;
    }),
    getKey: vi.fn(() => null),
  };
  const sessions = {
    getSession: vi.fn(() => ownedSession),
    sendMessage: vi.fn(async () => ({ delivered: true, attempts: 1 })),
    createSession: vi.fn(async () => makeSession()),
    findIdleSessionByWorkDir: vi.fn(async () => null),
    killSession: vi.fn(async () => {}),
    getLatencyMetrics: vi.fn(() => ({ permission_response_ms: null })),
    approve: vi.fn(async () => {}),
    reject: vi.fn(async () => {}),
    escape: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
    sendInitialPrompt: vi.fn(async () => ({ delivered: true, attempts: 1 })),
    readMessages: vi.fn(async () => ({ messages: [] })),
    submitAnswer: vi.fn(() => true),
    save: vi.fn(async () => {}),
    releaseSessionClaim: vi.fn(),
    listSessions: vi.fn(() => [ownedSession]),
    getHealth: vi.fn(async () => ({ alive: true, windowExists: true })),
  };

  const ctx = {
    sessions,
    tmux: {
      capturePane: vi.fn(async () => ''),
      resizePane: vi.fn(async () => {}),
    },
    auth,
    quotas: {
      checkSessionQuota: vi.fn(() => ({ allowed: true })),
      checkSendQuota: vi.fn(() => ({ allowed: true })),
    },
    config: {
      enforceSessionOwnership: true,
      envDenylist: [],
      envAdminAllowlist: [],
    },
    metrics: {
      cleanupSession: vi.fn(),
      sessionCreated: vi.fn(),
      sessionFailed: vi.fn(),
      promptSent: vi.fn(),
      recordPermissionResponse: vi.fn(),
      getGlobalMetrics: vi.fn(() => ({
        sessions: { total_created: 0, completed: 0, failed: 0 },
      })),
      getSessionMetrics: vi.fn(() => null),
      getSessionLatency: vi.fn(() => ({})),
    },
    monitor: {
      removeSession: vi.fn(),
      getStallInfo: vi.fn(() => ({ stalled: false })),
    },
    eventBus: {
      emitEnded: vi.fn(),
      emitStatus: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    },
    channels: {
      message: vi.fn(async () => {}),
      sessionEnded: vi.fn(async () => {}),
      sessionCreated: vi.fn(async () => {}),
      statusChange: vi.fn(async () => {}),
    },
    jsonlWatcher: {},
    pipelines: {},
    toolRegistry: {
      cleanupSession: vi.fn(),
      getSessionTools: vi.fn(() => []),
      getToolDefinitions: vi.fn(() => []),
      processEntries: vi.fn(),
    },
    getAuditLogger: vi.fn(() => ({ log: vi.fn(async () => {}) })),
    alertManager: {},
    swarmMonitor: {},
    sseLimiter: {
      acquire: vi.fn(() => ({ allowed: true, connectionId: 'test-conn' })),
      release: vi.fn(),
      unregisterWriter: vi.fn(),
    },
    memoryBridge: null,
    requestKeyMap: new Map<string, string>(),
    validateWorkDir: vi.fn(async (workDir: string) => workDir),
    serverState: { draining: false },
  } as unknown as RouteContext;

  return { ctx, sessions, auth };
}

describe('Issue #2461: Route alias registrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /v1/sessions/:id/input (alias for /send)', () => {
    it('registers the /input route', () => {
      const app = makeMockApp();
      const { ctx } = makeContext({ send: true });
      registerSessionActionRoutes(app, ctx);
      const handler = getHandler(app, 'post', '/v1/sessions/:id/input');
      expect(handler).toBeDefined();
    });

    it('delivers message via /input just like /send', async () => {
      const app = makeMockApp();
      const { ctx, sessions } = makeContext({ send: true });
      registerSessionActionRoutes(app, ctx);

      const handler = getHandler(app, 'post', '/v1/sessions/:id/input');
      const reply = makeReply();
      const result = await handler({
        params: { id: '11111111-1111-1111-1111-111111111111' },
        authKeyId: 'key-owner',
        body: { text: 'hello from input' },
      }, reply);

      expect(sessions.sendMessage).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        'hello from input',
      );
      expect(result).toEqual(expect.objectContaining({ ok: true, delivered: true }));
    });

    it('rejects without send permission', async () => {
      const app = makeMockApp();
      const { ctx, sessions } = makeContext({ send: false });
      registerSessionActionRoutes(app, ctx);

      const handler = getHandler(app, 'post', '/v1/sessions/:id/input');
      const reply = makeReply();
      await handler({
        params: { id: '11111111-1111-1111-1111-111111111111' },
        authKeyId: 'key-owner',
        body: { text: 'hello' },
      }, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
      expect(sessions.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('POST /v1/sessions/:id/kill (alias for DELETE)', () => {
    it('registers the /kill route', () => {
      const app = makeMockApp();
      const { ctx } = makeContext({ kill: true });
      registerSessionActionRoutes(app, ctx);
      const handler = getHandler(app, 'post', '/v1/sessions/:id/kill');
      expect(handler).toBeDefined();
    });

    it('kills the session', async () => {
      const app = makeMockApp();
      const { ctx, sessions } = makeContext({ kill: true });
      registerSessionActionRoutes(app, ctx);

      const handler = getHandler(app, 'post', '/v1/sessions/:id/kill');
      const reply = makeReply();
      const result = await handler({
        params: { id: '11111111-1111-1111-1111-111111111111' },
        authKeyId: 'key-owner',
      }, reply);

      expect(sessions.killSession).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
      expect(result).toEqual({ ok: true });
    });

    it('rejects without kill permission', async () => {
      const app = makeMockApp();
      const { ctx, sessions } = makeContext({ kill: false });
      registerSessionActionRoutes(app, ctx);

      const handler = getHandler(app, 'post', '/v1/sessions/:id/kill');
      const reply = makeReply();
      await handler({
        params: { id: '11111111-1111-1111-1111-111111111111' },
        authKeyId: 'key-owner',
      }, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
      expect(sessions.killSession).not.toHaveBeenCalled();
    });
  });

  describe('POST /v1/sessions/:id/terminate (alias for DELETE)', () => {
    it('registers the /terminate route', () => {
      const app = makeMockApp();
      const { ctx } = makeContext({ kill: true });
      registerSessionActionRoutes(app, ctx);
      const handler = getHandler(app, 'post', '/v1/sessions/:id/terminate');
      expect(handler).toBeDefined();
    });

    it('kills the session', async () => {
      const app = makeMockApp();
      const { ctx, sessions } = makeContext({ kill: true });
      registerSessionActionRoutes(app, ctx);

      const handler = getHandler(app, 'post', '/v1/sessions/:id/terminate');
      const reply = makeReply();
      const result = await handler({
        params: { id: '11111111-1111-1111-1111-111111111111' },
        authKeyId: 'key-owner',
      }, reply);

      expect(sessions.killSession).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('POST /v1/sessions/:id/stop (alias for DELETE)', () => {
    it('registers the /stop route', () => {
      const app = makeMockApp();
      const { ctx } = makeContext({ kill: true });
      registerSessionActionRoutes(app, ctx);
      const handler = getHandler(app, 'post', '/v1/sessions/:id/stop');
      expect(handler).toBeDefined();
    });

    it('kills the session', async () => {
      const app = makeMockApp();
      const { ctx, sessions } = makeContext({ kill: true });
      registerSessionActionRoutes(app, ctx);

      const handler = getHandler(app, 'post', '/v1/sessions/:id/stop');
      const reply = makeReply();
      const result = await handler({
        params: { id: '11111111-1111-1111-1111-111111111111' },
        authKeyId: 'key-owner',
      }, reply);

      expect(sessions.killSession).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('GET /v1/sessions/:id/stream (alias for /events SSE)', () => {
    it('registers the /stream route', () => {
      const app = makeMockApp();
      const { ctx } = makeContext();
      registerSessionDataRoutes(app, ctx);
      const handler = getHandler(app, 'get', '/v1/sessions/:id/stream');
      expect(handler).toBeDefined();
    });

    it('registers the /events route (unchanged)', () => {
      const app = makeMockApp();
      const { ctx } = makeContext();
      registerSessionDataRoutes(app, ctx);
      const handler = getHandler(app, 'get', '/v1/sessions/:id/events');
      expect(handler).toBeDefined();
    });

    it('uses the same handler for /stream and /events', () => {
      const app = makeMockApp();
      const { ctx } = makeContext();
      registerSessionDataRoutes(app, ctx);
      const streamHandler = getHandler(app, 'get', '/v1/sessions/:id/stream');
      const eventsHandler = getHandler(app, 'get', '/v1/sessions/:id/events');
      expect(streamHandler).toBe(eventsHandler);
    });
  });
});
