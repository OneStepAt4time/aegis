/**
 * session-read-404-2539.test.ts — Tests for Issue #2539.
 *
 * Regression test for: GET /v1/sessions/:id/read returning 404 for sessions
 * that exist in the sessions list. Root cause: double lookup race + catch-all
 * mapping all errors to 404.
 *
 * Fix: route now calls readMessagesFromSession(session) with the already-
 * resolved SessionInfo (no second state lookup), and maps non-404 errors to
 * 500 instead of 404.
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

const SESSION_ID = 'aaaaaaaa-2539-2539-2539-aaaaaaaaaaaa';

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

function getHandler(app: FastifyInstance, method: 'get', path: string) {
  const mockMethod = app[method] as ReturnType<typeof vi.fn>;
  const call = mockMethod.mock.calls.find((args: unknown[]) => args[0] === path);
  if (!call) throw new Error(`Missing route registration for GET ${path}`);
  const handlerOrOptions = call[1];
  if (typeof handlerOrOptions === 'function') {
    return handlerOrOptions as (req: unknown, reply: unknown) => Promise<unknown>;
  }
  return (handlerOrOptions as { handler: (req: unknown, reply: unknown) => Promise<unknown> }).handler;
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: SESSION_ID,
    windowId: '@2539',
    windowName: 'cc-2539-test',
    workDir: '/tmp/test-2539',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  } as SessionInfo;
}

function makeContext(session: SessionInfo | null, readResult?: { messages: unknown[] }) {
  const readMessagesFromSession = vi.fn(async () => readResult ?? { messages: [], status: 'idle', statusText: null, interactiveContent: null });

  const sessions = {
    getSession: vi.fn(() => session),
    readMessages: vi.fn(async () => ({ messages: [] })),
    readMessagesFromSession,
    sendMessage: vi.fn(async () => ({ delivered: true, attempts: 1 })),
    killSession: vi.fn(async () => {}),
    getLatencyMetrics: vi.fn(() => ({ permission_response_ms: null })),
    approve: vi.fn(async () => {}),
    reject: vi.fn(async () => {}),
    escape: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
    sendInitialPrompt: vi.fn(async () => ({ delivered: true, attempts: 1 })),
    submitAnswer: vi.fn(() => true),
    save: vi.fn(async () => {}),
    releaseSessionClaim: vi.fn(),
    listSessions: vi.fn(() => (session ? [session] : [])),
    getHealth: vi.fn(async () => ({ alive: true, windowExists: true })),
  };

  const auth = {
    authEnabled: false,
    hasPermission: vi.fn(() => true),
    getRole: vi.fn(() => 'admin'),
    getAuditActor: vi.fn(() => 'system'),
    getKey: vi.fn(() => null),
  };

  const ctx = {
    sessions,
    tmux: { capturePane: vi.fn(async () => '') },
    auth,
    quotas: { checkSessionQuota: vi.fn(() => ({ allowed: true })), checkSendQuota: vi.fn(() => ({ allowed: true })) },
    config: { enforceSessionOwnership: false, envDenylist: [], envAdminAllowlist: [] },
    metrics: {
      cleanupSession: vi.fn(), sessionCreated: vi.fn(), sessionFailed: vi.fn(), promptSent: vi.fn(),
      recordPermissionResponse: vi.fn(), getGlobalMetrics: vi.fn(() => ({ sessions: { total_created: 0 } })),
      getSessionMetrics: vi.fn(() => null), getSessionLatency: vi.fn(() => ({})),
    },
    monitor: { removeSession: vi.fn(), getStallInfo: vi.fn(() => ({ stalled: false })) },
    eventBus: { emitEnded: vi.fn(), emitStatus: vi.fn(), subscribe: vi.fn(() => vi.fn()) },
    channels: { message: vi.fn(async () => {}), sessionEnded: vi.fn(async () => {}), sessionCreated: vi.fn(async () => {}), statusChange: vi.fn(async () => {}) },
    jsonlWatcher: {},
    pipelines: {},
    toolRegistry: { cleanupSession: vi.fn(), getSessionTools: vi.fn(() => []), getToolDefinitions: vi.fn(() => []), processEntries: vi.fn() },
    getAuditLogger: vi.fn(() => ({ log: vi.fn(async () => {}) })),
    alertManager: {},
    swarmMonitor: {},
    sseLimiter: { acquire: vi.fn(() => ({ allowed: true, connectionId: 'c1' })), release: vi.fn(), unregisterWriter: vi.fn() },
    memoryBridge: null,
    requestKeyMap: new Map<string, string>(),
    validateWorkDir: vi.fn(async (d: string) => d),
    serverState: { draining: false },
  } as unknown as RouteContext;

  return { ctx, sessions, readMessagesFromSession };
}

describe('Issue #2539: /read returns 404 for sessions that exist in /sessions list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns messages when session exists (happy path)', async () => {
    const session = makeSession();
    const { ctx, sessions, readMessagesFromSession } = makeContext(session, {
      messages: [{ role: 'assistant', content: 'hello' }],
    });

    const app = makeMockApp();
    registerSessionActionRoutes(app, ctx);
    const handler = getHandler(app, 'get', '/v1/sessions/:id/read');
    const reply = makeReply();

    const result = await handler(
      { params: { id: SESSION_ID }, authKeyId: null },
      reply,
    );

    // Should call readMessagesFromSession, NOT readMessages
    expect(readMessagesFromSession).toHaveBeenCalledWith(session);
    expect(sessions.readMessages).not.toHaveBeenCalled();

    // Should not have sent an error status
    expect(reply.status).not.toHaveBeenCalledWith(404);
    expect(reply.status).not.toHaveBeenCalledWith(500);
    expect(result).toEqual(expect.objectContaining({ messages: expect.any(Array) }));
  });

  it('returns 404 only when session genuinely does not exist', async () => {
    // session = null means getSession() returns null → 404 from withOwnership
    const { ctx } = makeContext(null);
    const app = makeMockApp();
    registerSessionActionRoutes(app, ctx);
    const handler = getHandler(app, 'get', '/v1/sessions/:id/read');
    const reply = makeReply();

    await handler({ params: { id: SESSION_ID }, authKeyId: null }, reply);

    expect(reply.status).toHaveBeenCalledWith(404);
  });

  it('returns 500 (not 404) when a transient error occurs during read', async () => {
    // Session exists in state, but reading fails (e.g., tmux pane not ready yet)
    const session = makeSession();
    const { ctx, readMessagesFromSession } = makeContext(session);

    // Simulate a transient error (tmux not ready, pane not found, etc.)
    readMessagesFromSession.mockRejectedValueOnce(new Error('tmux: no pane: @2539'));

    const app = makeMockApp();
    registerSessionActionRoutes(app, ctx);
    const handler = getHandler(app, 'get', '/v1/sessions/:id/read');
    const reply = makeReply();

    await handler({ params: { id: SESSION_ID }, authKeyId: null }, reply);

    // Must NOT be 404 — the session exists, the error is transient
    expect(reply.status).not.toHaveBeenCalledWith(404);
    // Must be 500 — the read failed for an internal reason
    expect(reply.status).toHaveBeenCalledWith(500);
  });

  it('uses readMessagesFromSession to avoid TOCTOU double lookup', async () => {
    // Verifies that after withOwnership resolves the session, we do not look it
    // up again via readMessages(id) — which would re-enter this.state.sessions[id]
    // and could race with a concurrent killSession.
    const session = makeSession();
    const { ctx, sessions, readMessagesFromSession } = makeContext(session);

    const app = makeMockApp();
    registerSessionActionRoutes(app, ctx);
    const handler = getHandler(app, 'get', '/v1/sessions/:id/read');
    const reply = makeReply();

    await handler({ params: { id: SESSION_ID }, authKeyId: null }, reply);

    // readMessagesFromSession must be called with the already-resolved session
    expect(readMessagesFromSession).toHaveBeenCalledTimes(1);
    expect(readMessagesFromSession).toHaveBeenCalledWith(session);

    // The old double-lookup path must not be called
    expect(sessions.readMessages).not.toHaveBeenCalled();
  });
});
