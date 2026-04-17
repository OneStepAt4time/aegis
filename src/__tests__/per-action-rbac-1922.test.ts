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
import { registerSessionRoutes } from '../routes/sessions.js';

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
    workDir: 'D:\\repo',
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
  const auditLog = vi.fn(async () => {});
  const sessions = {
    getSession: vi.fn(() => ownedSession),
    sendMessage: vi.fn(async () => ({ delivered: true, attempts: 1 })),
    createSession: vi.fn(async (options: { workDir: string; name?: string; ownerKeyId?: string | null }) => makeSession({
      id: '22222222-2222-2222-2222-222222222222',
      workDir: options.workDir,
      windowName: options.name ?? 'created-session',
      ownerKeyId: options.ownerKeyId ?? undefined,
    })),
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
  };

  const ctx = {
    sessions,
    tmux: {
      capturePane: vi.fn(async () => ''),
      resizePane: vi.fn(async () => {}),
    },
    auth: {
      authEnabled: true,
      hasPermission: vi.fn((_keyId: string | null | undefined, permission: PermissionName) => granted[permission] ?? false),
      getRole: vi.fn((keyId: string | null | undefined) => (keyId === 'master' ? 'admin' : 'viewer')),
    },
    config: {
      enforceSessionOwnership: true,
      envDenylist: [],
      envAdminAllowlist: [],
    },
    metrics: {
      sessionCreated: vi.fn(),
      promptSent: vi.fn(),
      recordPermissionResponse: vi.fn(),
      getGlobalMetrics: vi.fn(() => ({
        sessions: {
          total_created: 0,
          completed: 0,
          failed: 0,
        },
      })),
    },
    monitor: {
      getStallInfo: vi.fn(() => ({ stalled: false })),
    },
    eventBus: {
      emitEnded: vi.fn(),
    },
    channels: {
      message: vi.fn(async () => {}),
      sessionEnded: vi.fn(async () => {}),
      sessionCreated: vi.fn(async () => {}),
    },
    jsonlWatcher: {},
    pipelines: {},
    toolRegistry: {},
    getAuditLogger: vi.fn(() => ({ log: auditLog })),
    alertManager: {},
    swarmMonitor: {},
    sseLimiter: {},
    memoryBridge: null,
    requestKeyMap: new Map<string, string>(),
    validateWorkDir: vi.fn(async (workDir: string) => workDir),
    serverState: { draining: false },
  } as unknown as RouteContext;

  return { ctx, sessions, auditLog };
}

describe('Per-action RBAC routes (#1922)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects send without send permission', async () => {
    const app = makeMockApp();
    const { ctx, sessions } = makeContext({ send: false });
    registerSessionActionRoutes(app, ctx);

    const handler = getHandler(app, 'post', '/v1/sessions/:id/send');
    const reply = makeReply();
    await handler({
      params: { id: '11111111-1111-1111-1111-111111111111' },
      authKeyId: 'key-owner',
      body: { text: 'hello' },
    }, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(sessions.sendMessage).not.toHaveBeenCalled();
  });

  it('allows send for a viewer key when send permission is present', async () => {
    const app = makeMockApp();
    const { ctx, sessions } = makeContext({ send: true });
    registerSessionActionRoutes(app, ctx);

    const handler = getHandler(app, 'post', '/v1/sessions/:id/send');
    const reply = makeReply();
    const result = await handler({
      params: { id: '11111111-1111-1111-1111-111111111111' },
      authKeyId: 'key-owner',
      body: { text: 'hello' },
    }, reply);

    expect(result).toEqual({ ok: true, delivered: true, attempts: 1 });
    expect(sessions.sendMessage).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111', 'hello');
  });

  it('rejects kill without kill permission', async () => {
    const app = makeMockApp();
    const { ctx, sessions } = makeContext({ kill: false });
    registerSessionActionRoutes(app, ctx);

    const handler = getHandler(app, 'delete', '/v1/sessions/:id');
    const reply = makeReply();
    await handler({
      params: { id: '11111111-1111-1111-1111-111111111111' },
      authKeyId: 'key-owner',
    }, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(sessions.killSession).not.toHaveBeenCalled();
  });

  it('rejects spawn without create permission', async () => {
    const app = makeMockApp();
    const { ctx, sessions } = makeContext({ create: false });
    registerSessionActionRoutes(app, ctx);

    const handler = getHandler(app, 'post', '/v1/sessions/:id/spawn');
    const reply = makeReply();
    await handler({
      params: { id: '11111111-1111-1111-1111-111111111111' },
      authKeyId: 'key-owner',
      body: { name: 'child' },
    }, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it('records the matched create permission in session.create audit logs', async () => {
    const app = makeMockApp();
    const { ctx, sessions, auditLog } = makeContext({ create: true });
    registerSessionRoutes(app, ctx);

    const handler = getHandler(app, 'post', '/v1/sessions');
    const reply = makeReply();
    await handler({
      authKeyId: 'key-owner',
      matchedPermission: null,
      body: { workDir: 'D:\\repo', name: 'new-session' },
    }, reply);

    expect(sessions.createSession).toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledWith(
      'key-owner',
      'session.create',
      expect.stringContaining('permission=create'),
      '22222222-2222-2222-2222-222222222222',
    );
  });
});
