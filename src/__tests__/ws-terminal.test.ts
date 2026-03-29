/**
 * ws-terminal.test.ts — Tests for WebSocket terminal streaming endpoint.
 * Includes Issue #303 security tests: auth, rate limiting, shared polls, ping/pong.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerWsTerminalRoute, _resetForTesting, _activePollCount, _subscriberCount } from '../ws-terminal.js';
import type { SessionManager, SessionInfo } from '../session.js';
import type { TmuxManager } from '../tmux.js';
import type { AuthManager } from '../auth.js';
import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';

// --- Mock Types ---

interface MockWebSocket extends WebSocket {
  _sent: string[];
  _setReadyState(state: number): void;
  _emit(event: string, ...args: unknown[]): void;
}

// --- Mock Factories ---

function makeMockWebSocket(): MockWebSocket {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const sent: string[] = [];
  let readyState = 1; // OPEN

  const ws = {
    OPEN: 1,
    CLOSED: 3,
    send: vi.fn((data: string) => { sent.push(data); }),
    close: vi.fn(() => {
      readyState = 3;
      const closeHandlers = handlers['close'] ?? [];
      for (const h of closeHandlers) h();
    }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (handlers[event]) {
        handlers[event] = handlers[event].filter(h => h !== handler);
      }
    }),
    ping: vi.fn(),
    _sent: sent,
    _setReadyState(state: number): void { readyState = state; },
    _emit(event: string, ...args: unknown[]): void {
      const eventHandlers = handlers[event] ?? [];
      for (const h of eventHandlers) h(...args);
    },
  } as unknown as MockWebSocket;

  // Use a getter so the source's ws.readyState check reads the mutable variable
  Object.defineProperty(ws, 'readyState', {
    get(): number { return readyState; },
    configurable: true,
  });

  return ws;
}

function makeMockFastify(overrides?: Partial<FastifyInstance>): FastifyInstance {
  return {
    get: vi.fn(),
    ...overrides,
  } as unknown as FastifyInstance;
}

function makeSession(overrides?: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'sess-1',
    windowId: 'win-1',
    windowName: 'sess-1',
    workDir: '/tmp',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  };
}

function makeSessionManager(sessions: Map<string, SessionInfo>): SessionManager {
  return {
    getSession: vi.fn((id: string) => sessions.get(id) ?? null),
    sendMessage: vi.fn(async () => ({ delivered: true, attempts: 1 })),
  } as unknown as SessionManager;
}

function makeTmuxManager(): TmuxManager & { _paneContent: string } {
  return {
    capturePane: vi.fn(async () => 'pane content'),
    resizePane: vi.fn(async () => {}),
    _paneContent: 'pane content',
  } as unknown as TmuxManager & { _paneContent: string };
}

function makeAuthManager(opts?: { enabled?: boolean; valid?: boolean; rateLimited?: boolean }): AuthManager {
  const enabled = opts?.enabled ?? false;
  const valid = opts?.valid ?? true;
  const rateLimited = opts?.rateLimited ?? false;
  return {
    authEnabled: enabled,
    validate: vi.fn(() => ({
      valid,
      keyId: valid ? 'test-key' : null,
      rateLimited,
    })),
  } as unknown as AuthManager;
}

// Extract the WS handler from the registered route
function getWsHandler(app: FastifyInstance): (
  socket: WebSocket,
  req: { params: { id: string }; query?: Record<string, string>; headers?: Record<string, string> },
) => void {
  const get = app.get as ReturnType<typeof vi.fn>;
  expect(get).toHaveBeenCalled();
  // app.get(path, options, handler) — handler is 3rd arg
  return get.mock.calls[0][2] as (
    socket: WebSocket,
    req: { params: { id: string } },
  ) => void;
}

// Extract the preHandler from the registered route options
function getPreHandler(app: FastifyInstance): (req: any, reply: any) => Promise<void> {
  const get = app.get as ReturnType<typeof vi.fn>;
  expect(get).toHaveBeenCalled();
  const options = get.mock.calls[0][1] as Record<string, unknown>;
  return options.preHandler as (req: any, reply: any) => Promise<void>;
}

// --- Tests ---

describe('ws-terminal', () => {
  let app: FastifyInstance;
  let sessions: Map<string, SessionInfo>;
  let sessionManager: SessionManager;
  let tmux: TmuxManager & { _paneContent: string };
  let auth: AuthManager;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessions = new Map();
    sessionManager = makeSessionManager(sessions);
    tmux = makeTmuxManager();
    auth = makeAuthManager();
    app = makeMockFastify();
    _resetForTesting();
    registerWsTerminalRoute(app, sessionManager, tmux, auth);
  });

  afterEach(() => {
    _resetForTesting();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('connection handling', () => {
    it('should register GET /v1/sessions/:id/terminal with websocket option', () => {
      const get = app.get as ReturnType<typeof vi.fn>;
      expect(get).toHaveBeenCalledWith(
        '/v1/sessions/:id/terminal',
        expect.objectContaining({ websocket: true }),
        expect.any(Function),
      );
    });

    it('should reject connections for non-existent sessions', () => {
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'no-such-session' } });

      const lastSent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(lastSent.type).toBe('error');
      expect(lastSent.message).toBe('Session not found');
      expect(ws.close).toHaveBeenCalled();
    });

    it('should accept connections for existing sessions', () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      expect(ws.close).not.toHaveBeenCalled();
    });
  });

  describe('pane content streaming', () => {
    it('should send pane content on first poll', async () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      // Advance past the first poll interval
      await vi.advanceTimersByTimeAsync(500);

      expect(tmux.capturePane).toHaveBeenCalledWith('win-1');
      const paneMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'pane';
      });
      expect(paneMsg).toBeDefined();
      expect(JSON.parse(paneMsg!).content).toBe('pane content');
    });

    it('should not send duplicate pane content when unchanged', async () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      await vi.advanceTimersByTimeAsync(500);
      const countAfterFirst = ws._sent.filter(s => JSON.parse(s).type === 'pane').length;

      // capturePane still returns the same content
      await vi.advanceTimersByTimeAsync(500);
      const countAfterSecond = ws._sent.filter(s => JSON.parse(s).type === 'pane').length;

      expect(countAfterSecond).toBe(countAfterFirst);
    });

    it('should send updated pane content when it changes', async () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      await vi.advanceTimersByTimeAsync(500);
      const countAfterFirst = ws._sent.filter(s => JSON.parse(s).type === 'pane').length;

      // Change pane content
      (tmux.capturePane as ReturnType<typeof vi.fn>).mockResolvedValueOnce('new content');

      await vi.advanceTimersByTimeAsync(500);
      const countAfterSecond = ws._sent.filter(s => JSON.parse(s).type === 'pane').length;

      expect(countAfterSecond).toBe(countAfterFirst + 1);
      const lastPane = ws._sent
        .map(s => JSON.parse(s))
        .filter(m => m.type === 'pane')
        .pop();
      expect(lastPane!.content).toBe('new content');
    });
  });

  describe('status updates', () => {
    it('should emit status on first poll', async () => {
      sessions.set('sess-1', makeSession({ status: 'idle' }));
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      await vi.advanceTimersByTimeAsync(500);

      const statusMsg = ws._sent.find(s => JSON.parse(s).type === 'status');
      expect(statusMsg).toBeDefined();
      expect(JSON.parse(statusMsg!).status).toBe('idle');
    });

    it('should emit status changes when session status changes', async () => {
      const session = makeSession({ status: 'idle' });
      sessions.set('sess-1', session);
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      await vi.advanceTimersByTimeAsync(500);
      const countAfterFirst = ws._sent.filter(s => JSON.parse(s).type === 'status').length;

      // Change status
      session.status = 'working';

      await vi.advanceTimersByTimeAsync(500);
      const countAfterSecond = ws._sent.filter(s => JSON.parse(s).type === 'status').length;

      expect(countAfterSecond).toBe(countAfterFirst + 1);
      const lastStatus = ws._sent
        .map(s => JSON.parse(s))
        .filter(m => m.type === 'status')
        .pop();
      expect(lastStatus!.status).toBe('working');
    });

    it('should not send duplicate status when unchanged', async () => {
      sessions.set('sess-1', makeSession({ status: 'idle' }));
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      await vi.advanceTimersByTimeAsync(500);
      const countAfterFirst = ws._sent.filter(s => JSON.parse(s).type === 'status').length;

      await vi.advanceTimersByTimeAsync(500);
      const countAfterSecond = ws._sent.filter(s => JSON.parse(s).type === 'status').length;

      expect(countAfterSecond).toBe(countAfterFirst);
    });
  });

  describe('error cases', () => {
    it('should close and send error when capturePane throws', async () => {
      sessions.set('sess-1', makeSession());
      (tmux.capturePane as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('pane dead'),
      );

      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      await vi.advanceTimersByTimeAsync(500);

      const errorMsg = ws._sent.find(s => JSON.parse(s).type === 'error');
      expect(errorMsg).toBeDefined();
      expect(JSON.parse(errorMsg!).message).toContain('Failed to capture pane');
    });

    it('should send error for unknown message type', () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      ws._emit('message', Buffer.from(JSON.stringify({ type: 'bogus' })));

      const errorMsg = ws._sent.find(s => JSON.parse(s).type === 'error');
      expect(errorMsg).toBeDefined();
      expect(JSON.parse(errorMsg!).message).toContain('Invalid message');
    });

    it('should send error for invalid JSON', () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      ws._emit('message', Buffer.from('not json'));

      const errorMsg = ws._sent.find(s => JSON.parse(s).type === 'error');
      expect(errorMsg).toBeDefined();
      expect(JSON.parse(errorMsg!).message).toContain('Invalid message');
    });

    it('should not send error for non-JSON when socket is closed', () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      // Close first, then send message
      ws.close();
      ws._emit('message', Buffer.from('not json'));

      // No error should be sent — the handler returns early when closed
      const errorMsgs = ws._sent.filter(s => JSON.parse(s).type === 'error');
      expect(errorMsgs).toHaveLength(0);
    });
  });

  describe('input forwarding', () => {
    it('should forward input messages to session manager', () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      ws._emit('message', Buffer.from(JSON.stringify({ type: 'input', text: 'hello' })));

      expect(sessionManager.sendMessage).toHaveBeenCalledWith('sess-1', 'hello');
    });

    it('should not forward input when socket is closed', () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      ws.close();
      ws._emit('message', Buffer.from(JSON.stringify({ type: 'input', text: 'hello' })));

      expect(sessionManager.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('resize handling', () => {
    it('should forward resize to tmux manager with given dimensions', () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      ws._emit('message', Buffer.from(JSON.stringify({ type: 'resize', cols: 120, rows: 40 })));

      expect(tmux.resizePane).toHaveBeenCalledWith('win-1', 120, 40);
    });

    it('should default cols/rows to 80x24 when not numbers', () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      ws._emit('message', Buffer.from(JSON.stringify({ type: 'resize' })));

      expect(tmux.resizePane).toHaveBeenCalledWith('win-1', 80, 24);
    });
  });

  describe('cleanup on disconnect', () => {
    it('should stop polling after close event', async () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      await vi.advanceTimersByTimeAsync(500);
      const captureCallsBefore = (tmux.capturePane as ReturnType<typeof vi.fn>).mock.calls.length;

      ws.close();

      await vi.advanceTimersByTimeAsync(2000);
      const captureCallsAfter = (tmux.capturePane as ReturnType<typeof vi.fn>).mock.calls.length;

      // No new capture calls after close
      expect(captureCallsAfter).toBe(captureCallsBefore);
    });

    it('should not process messages after close', () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      ws.close();
      ws._emit('message', Buffer.from(JSON.stringify({ type: 'input', text: 'ignored' })));

      expect(sessionManager.sendMessage).not.toHaveBeenCalled();
    });

    it('should not send error on capturePane failure after close', async () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      // Close before the first poll fires
      ws.close();

      // Make capturePane throw
      (tmux.capturePane as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('dead'),
      );

      await vi.advanceTimersByTimeAsync(500);

      // No error should have been sent — the poll returns early when closed
      const errorMsgs = ws._sent.filter(s => JSON.parse(s).type === 'error');
      expect(errorMsgs).toHaveLength(0);
    });

    it('should handle close being called multiple times', () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      ws.close();
      ws.close();
      ws.close();

      // Should not throw (3 user calls + 1 from evictSubscriber)
      expect(ws.close).toHaveBeenCalledTimes(4);
    });
  });

  describe('send helper', () => {
    it('should not send when socket is not open', () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      ws._setReadyState(3); // CLOSED
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      // Simulate a message that would trigger an error response
      ws._emit('message', Buffer.from(JSON.stringify({ type: 'bogus' })));

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  // ── Issue #303: Security tests ─────────────────────────────────

  describe('auth check (Issue #303)', () => {
    it('should register preHandler on the WS route', () => {
      const get = app.get as ReturnType<typeof vi.fn>;
      const options = get.mock.calls[0][1] as Record<string, unknown>;
      expect(options.preHandler).toBeTypeOf('function');
    });

    it('should allow connections when auth is not enabled', async () => {
      const authDisabled = makeAuthManager({ enabled: false });
      const localApp = makeMockFastify();
      registerWsTerminalRoute(localApp, sessionManager, tmux, authDisabled);

      const preHandler = getPreHandler(localApp);
      const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      await preHandler({ headers: {}, query: {} }, reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should accept valid Bearer token', async () => {
      const authEnabled = makeAuthManager({ enabled: true, valid: true });
      const localApp = makeMockFastify();
      registerWsTerminalRoute(localApp, sessionManager, tmux, authEnabled);

      const preHandler = getPreHandler(localApp);
      const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      await preHandler(
        { headers: { authorization: 'Bearer valid-token' }, query: {} },
        reply,
      );

      expect(authEnabled.validate).toHaveBeenCalledWith('valid-token');
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should accept ?token= query param', async () => {
      const authEnabled = makeAuthManager({ enabled: true, valid: true });
      const localApp = makeMockFastify();
      registerWsTerminalRoute(localApp, sessionManager, tmux, authEnabled);

      const preHandler = getPreHandler(localApp);
      const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      // Issue #503: ?token= in URL is no longer supported — tokens must be
      // sent via first-message handshake. The preHandler allows the
      // connection through without Bearer header; auth happens in-message.
      await preHandler(
        { headers: {}, query: { token: 'query-token' } },
        reply,
      );

      // preHandler does NOT validate query tokens — it allows the connection
      // through for handshake auth
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should prefer Bearer header over ?token=', async () => {
      const authEnabled = makeAuthManager({ enabled: true, valid: true });
      const localApp = makeMockFastify();
      registerWsTerminalRoute(localApp, sessionManager, tmux, authEnabled);

      const preHandler = getPreHandler(localApp);
      const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      await preHandler(
        { headers: { authorization: 'Bearer header-token' }, query: { token: 'query-token' } },
        reply,
      );

      expect(authEnabled.validate).toHaveBeenCalledWith('header-token');
    });

    it('should allow connections without Bearer header for handshake auth (Issue #503)', async () => {
      const authEnabled = makeAuthManager({ enabled: true, valid: true });
      const localApp = makeMockFastify();
      registerWsTerminalRoute(localApp, sessionManager, tmux, authEnabled);

      const preHandler = getPreHandler(localApp);
      const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      // Issue #503: Without Bearer header, connection is allowed through.
      // Auth is validated via first-message handshake.
      await preHandler({ headers: {}, query: {} }, reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should reject connections with invalid token', async () => {
      const authEnabled = makeAuthManager({ enabled: true, valid: false });
      const localApp = makeMockFastify();
      registerWsTerminalRoute(localApp, sessionManager, tmux, authEnabled);

      const preHandler = getPreHandler(localApp);
      const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      await preHandler(
        { headers: { authorization: 'Bearer bad-token' }, query: {} },
        reply,
      );

      expect(reply.status).toHaveBeenCalledWith(401);
    });

    it('should reject connections when rate limited', async () => {
      const authLimited = makeAuthManager({ enabled: true, valid: true, rateLimited: true });
      const localApp = makeMockFastify();
      registerWsTerminalRoute(localApp, sessionManager, tmux, authLimited);

      const preHandler = getPreHandler(localApp);
      const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      await preHandler(
        { headers: { authorization: 'Bearer valid-but-limited' }, query: {} },
        reply,
      );

      expect(reply.status).toHaveBeenCalledWith(429);
    });
  });

  // ── Issue #503: First-message handshake auth ──────────────────────

  describe('handshake auth (Issue #503)', () => {
    it('should accept valid auth message and send status', () => {
      const authEnabled = makeAuthManager({ enabled: true, valid: true });
      const localApp = makeMockFastify();
      registerWsTerminalRoute(localApp, sessionManager, tmux, authEnabled);

      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(localApp);
      handler(ws, { params: { id: 'sess-1' } });

      // Send auth message
      ws._emit('message', Buffer.from(JSON.stringify({ type: 'auth', token: 'valid-token' })));

      expect(authEnabled.validate).toHaveBeenCalledWith('valid-token');
      const statusMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'status' && parsed.status === 'authenticated';
      });
      expect(statusMsg).toBeDefined();
    });

    it('should reject invalid auth token and close connection', () => {
      const authEnabled = makeAuthManager({ enabled: true, valid: false });
      const localApp = makeMockFastify();
      registerWsTerminalRoute(localApp, sessionManager, tmux, authEnabled);

      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(localApp);
      handler(ws, { params: { id: 'sess-1' } });

      ws._emit('message', Buffer.from(JSON.stringify({ type: 'auth', token: 'bad-token' })));

      const errorMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'error' && parsed.message.includes('invalid API key');
      });
      expect(errorMsg).toBeDefined();
      expect(ws.close).toHaveBeenCalled();
    });

    it('should reject auth message with missing token field', () => {
      const authEnabled = makeAuthManager({ enabled: true, valid: true });
      const localApp = makeMockFastify();
      registerWsTerminalRoute(localApp, sessionManager, tmux, authEnabled);

      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(localApp);
      handler(ws, { params: { id: 'sess-1' } });

      ws._emit('message', Buffer.from(JSON.stringify({ type: 'auth' })));

      const errorMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'error' && parsed.message.includes('token field');
      });
      expect(errorMsg).toBeDefined();
      expect(ws.close).toHaveBeenCalled();
    });

    it('should reject non-auth messages when not yet authenticated', () => {
      const authEnabled = makeAuthManager({ enabled: true, valid: true });
      const localApp = makeMockFastify();
      registerWsTerminalRoute(localApp, sessionManager, tmux, authEnabled);

      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(localApp);
      handler(ws, { params: { id: 'sess-1' } });

      // Try to send input before authenticating
      ws._emit('message', Buffer.from(JSON.stringify({ type: 'input', text: 'hello' })));

      expect(sessionManager.sendMessage).not.toHaveBeenCalled();
      const errorMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'error' && parsed.message.includes('Not authenticated');
      });
      expect(errorMsg).toBeDefined();
      expect(ws.close).toHaveBeenCalled();
    });

    it('should allow input messages after successful auth', () => {
      const authEnabled = makeAuthManager({ enabled: true, valid: true });
      const localApp = makeMockFastify();
      registerWsTerminalRoute(localApp, sessionManager, tmux, authEnabled);

      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(localApp);
      handler(ws, { params: { id: 'sess-1' } });

      // Auth first
      ws._emit('message', Buffer.from(JSON.stringify({ type: 'auth', token: 'valid-token' })));

      // Now send input
      ws._emit('message', Buffer.from(JSON.stringify({ type: 'input', text: 'hello' })));

      expect(sessionManager.sendMessage).toHaveBeenCalledWith('sess-1', 'hello');
    });

    it('should drop connection on auth timeout', () => {
      const authEnabled = makeAuthManager({ enabled: true, valid: true });
      const localApp = makeMockFastify();
      registerWsTerminalRoute(localApp, sessionManager, tmux, authEnabled);

      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(localApp);
      handler(ws, { params: { id: 'sess-1' } });

      // Don't send auth message — advance past timeout
      vi.advanceTimersByTime(5_000);

      const errorMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'error' && parsed.message.includes('Auth timeout');
      });
      expect(errorMsg).toBeDefined();
      expect(ws.close).toHaveBeenCalled();
    });

    it('should not require handshake when auth is disabled', () => {
      const authDisabled = makeAuthManager({ enabled: false });
      const localApp = makeMockFastify();
      registerWsTerminalRoute(localApp, sessionManager, tmux, authDisabled);

      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(localApp);
      handler(ws, { params: { id: 'sess-1' } });

      // Send input without auth — should go through
      ws._emit('message', Buffer.from(JSON.stringify({ type: 'input', text: 'hello' })));

      expect(sessionManager.sendMessage).toHaveBeenCalledWith('sess-1', 'hello');
    });
  });

  describe('rate limiting (Issue #303)', () => {
    it('should allow up to 10 messages per second', () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      // Send 10 messages — all should go through
      for (let i = 0; i < 10; i++) {
        ws._emit('message', Buffer.from(JSON.stringify({ type: 'input', text: `msg-${i}` })));
      }

      expect(sessionManager.sendMessage).toHaveBeenCalledTimes(10);
    });

    it('should reject the 11th message within 1 second', () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      // Send 10 messages
      for (let i = 0; i < 10; i++) {
        ws._emit('message', Buffer.from(JSON.stringify({ type: 'input', text: `msg-${i}` })));
      }

      // 11th should be rejected
      ws._emit('message', Buffer.from(JSON.stringify({ type: 'input', text: 'msg-10' })));

      // sendMessage called 10 times (not 11)
      expect(sessionManager.sendMessage).toHaveBeenCalledTimes(10);

      // Error sent about rate limit
      const rateLimitError = ws._sent
        .map(s => JSON.parse(s))
        .find(m => m.type === 'error' && m.message.includes('Rate limit'));
      expect(rateLimitError).toBeDefined();
    });

    it('should close the socket on rate limit violation', () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      // Send 11 messages to trigger rate limit
      for (let i = 0; i < 11; i++) {
        ws._emit('message', Buffer.from(JSON.stringify({ type: 'input', text: `msg-${i}` })));
      }

      expect(ws.close).toHaveBeenCalled();
    });

    it('should reset the rate limit window after 1 second', async () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      // Send 10 messages
      for (let i = 0; i < 10; i++) {
        ws._emit('message', Buffer.from(JSON.stringify({ type: 'input', text: `msg-${i}` })));
      }
      expect(sessionManager.sendMessage).toHaveBeenCalledTimes(10);

      // Advance past the rate limit window
      await vi.advanceTimersByTimeAsync(1100);

      // Should be able to send again
      ws._emit('message', Buffer.from(JSON.stringify({ type: 'input', text: 'after-window' })));
      expect(sessionManager.sendMessage).toHaveBeenCalledTimes(11);
    });

    it('should not count rate limit after socket is closed', () => {
      sessions.set('sess-1', makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: 'sess-1' } });

      ws.close();

      // These should be ignored (not counted for rate limiting)
      for (let i = 0; i < 15; i++) {
        ws._emit('message', Buffer.from(JSON.stringify({ type: 'input', text: `msg-${i}` })));
      }

      expect(sessionManager.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('shared polls (Issue #303)', () => {
    it('should share a single poll for multiple connections to the same session', async () => {
      sessions.set('sess-1', makeSession());
      const handler = getWsHandler(app);

      // Connect two sockets to the same session
      const ws1 = makeMockWebSocket();
      const ws2 = makeMockWebSocket();
      handler(ws1, { params: { id: 'sess-1' } });
      handler(ws2, { params: { id: 'sess-1' } });

      // Both should be active subscribers
      expect(_subscriberCount('sess-1')).toBe(2);

      await vi.advanceTimersByTimeAsync(500);

      // capturePane should be called only once per tick (shared poll)
      const captureCallCount = (tmux.capturePane as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(captureCallCount).toBe(1);
    });

    it('should deliver pane content to all subscribers', async () => {
      sessions.set('sess-1', makeSession());
      const handler = getWsHandler(app);

      const ws1 = makeMockWebSocket();
      const ws2 = makeMockWebSocket();
      handler(ws1, { params: { id: 'sess-1' } });
      handler(ws2, { params: { id: 'sess-1' } });

      await vi.advanceTimersByTimeAsync(500);

      // Both should receive pane content
      const pane1 = ws1._sent.find(s => JSON.parse(s).type === 'pane');
      const pane2 = ws2._sent.find(s => JSON.parse(s).type === 'pane');
      expect(pane1).toBeDefined();
      expect(pane2).toBeDefined();
    });

    it('should continue polling when one of two subscribers disconnects', async () => {
      sessions.set('sess-1', makeSession());
      const handler = getWsHandler(app);

      const ws1 = makeMockWebSocket();
      const ws2 = makeMockWebSocket();
      handler(ws1, { params: { id: 'sess-1' } });
      handler(ws2, { params: { id: 'sess-1' } });

      await vi.advanceTimersByTimeAsync(500);
      expect(_subscriberCount('sess-1')).toBe(2);

      // Disconnect first subscriber
      ws1.close();
      expect(_subscriberCount('sess-1')).toBe(1);

      // Change content
      (tmux.capturePane as ReturnType<typeof vi.fn>).mockResolvedValueOnce('updated');

      await vi.advanceTimersByTimeAsync(500);

      // Second subscriber should still get updates
      const lastPane = ws2._sent
        .map(s => JSON.parse(s))
        .filter(m => m.type === 'pane')
        .pop();
      expect(lastPane!.content).toBe('updated');

      // Poll should still be active
      expect(_activePollCount()).toBe(1);
    });

    it('should clean up the poll timer when last subscriber disconnects', async () => {
      sessions.set('sess-1', makeSession());
      const handler = getWsHandler(app);

      const ws = makeMockWebSocket();
      handler(ws, { params: { id: 'sess-1' } });

      await vi.advanceTimersByTimeAsync(500);
      expect(_activePollCount()).toBe(1);

      ws.close();
      expect(_activePollCount()).toBe(0);
      expect(_subscriberCount('sess-1')).toBe(0);
    });

    it('should create separate polls for different sessions', async () => {
      sessions.set('sess-1', makeSession({ id: 'sess-1', windowId: 'win-1' }));
      sessions.set('sess-2', makeSession({ id: 'sess-2', windowId: 'win-2' }));
      const handler = getWsHandler(app);

      const ws1 = makeMockWebSocket();
      const ws2 = makeMockWebSocket();
      handler(ws1, { params: { id: 'sess-1' } });
      handler(ws2, { params: { id: 'sess-2' } });

      expect(_activePollCount()).toBe(2);
      expect(_subscriberCount('sess-1')).toBe(1);
      expect(_subscriberCount('sess-2')).toBe(1);
    });

    it('should deduplicate pane content per subscriber independently', async () => {
      sessions.set('sess-1', makeSession());
      const handler = getWsHandler(app);

      // First subscriber connects and gets content
      const ws1 = makeMockWebSocket();
      handler(ws1, { params: { id: 'sess-1' } });

      await vi.advanceTimersByTimeAsync(500);
      const ws1PaneCount = ws1._sent.filter(s => JSON.parse(s).type === 'pane').length;
      expect(ws1PaneCount).toBe(1);

      // Second subscriber connects later — should get content on its first poll
      const ws2 = makeMockWebSocket();
      handler(ws2, { params: { id: 'sess-1' } });

      await vi.advanceTimersByTimeAsync(500);

      // ws2 should receive the pane content
      const ws2PaneCount = ws2._sent.filter(s => JSON.parse(s).type === 'pane').length;
      expect(ws2PaneCount).toBe(1);

      // ws1 should NOT get duplicate (content unchanged)
      const ws1PaneCountAfter = ws1._sent.filter(s => JSON.parse(s).type === 'pane').length;
      expect(ws1PaneCountAfter).toBe(1);
    });
  });

  describe('ping/pong keep-alive (Issue #303)', () => {
    it('should send pings to subscribers every 60 ticks (30s)', async () => {
      sessions.set('sess-1', makeSession());
      const handler = getWsHandler(app);
      const ws = makeMockWebSocket();
      handler(ws, { params: { id: 'sess-1' } });

      // Advance 59 ticks — no ping yet
      await vi.advanceTimersByTimeAsync(500 * 59);
      expect(ws.ping).not.toHaveBeenCalled();

      // Advance one more tick — ping sent
      await vi.advanceTimersByTimeAsync(500);
      expect(ws.ping).toHaveBeenCalled();
    });

    it('should keep connection alive when pong is received', async () => {
      sessions.set('sess-1', makeSession());
      const handler = getWsHandler(app);
      const ws = makeMockWebSocket();
      handler(ws, { params: { id: 'sess-1' } });

      // Advance to first ping (60 ticks = 30s)
      await vi.advanceTimersByTimeAsync(500 * 60);
      expect(ws.ping).toHaveBeenCalledTimes(1);

      // Simulate pong response
      ws._emit('pong');

      // Advance to second ping — connection should still be alive
      await vi.advanceTimersByTimeAsync(500 * 60);
      expect(ws.ping).toHaveBeenCalledTimes(2);
      expect(ws.close).not.toHaveBeenCalled();
    });

    it('should evict subscribers that do not respond to pings', async () => {
      sessions.set('sess-1', makeSession());
      const handler = getWsHandler(app);
      const ws = makeMockWebSocket();
      handler(ws, { params: { id: 'sess-1' } });

      // Advance to first ping (30s)
      await vi.advanceTimersByTimeAsync(500 * 60);
      expect(ws.ping).toHaveBeenCalledTimes(1);

      // Do NOT send pong — advance past keepalive timeout (35s from last pong)
      // Total advance: 30s (first ping) + 35s = 65s
      // But we need to reach tick 120 for the second keep-alive check
      await vi.advanceTimersByTimeAsync(500 * 60); // tick 120 — second keep-alive check

      // Connection should be evicted (lastPongAt is too old)
      expect(_subscriberCount('sess-1')).toBe(0);
    });

    it('should handle ping errors gracefully', async () => {
      sessions.set('sess-1', makeSession());
      const handler = getWsHandler(app);
      const ws = makeMockWebSocket();
      handler(ws, { params: { id: 'sess-1' } });

      // Make ping throw
      (ws.ping as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('socket closed');
      });

      // Advance to first keep-alive check
      await vi.advanceTimersByTimeAsync(500 * 60);

      // Subscriber should be evicted
      expect(_subscriberCount('sess-1')).toBe(0);
    });

    it('should clean up poll when all subscribers are evicted by keep-alive', async () => {
      sessions.set('sess-1', makeSession());
      const handler = getWsHandler(app);

      const ws1 = makeMockWebSocket();
      const ws2 = makeMockWebSocket();
      handler(ws1, { params: { id: 'sess-1' } });
      handler(ws2, { params: { id: 'sess-1' } });

      expect(_activePollCount()).toBe(1);

      // Make both pings throw to evict both
      (ws1.ping as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('dead'); });
      (ws2.ping as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('dead'); });

      await vi.advanceTimersByTimeAsync(500 * 60);

      // Poll should be cleaned up
      expect(_activePollCount()).toBe(0);
    });
  });
});
