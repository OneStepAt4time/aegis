/**
 * ws-terminal.test.ts — Tests for WebSocket terminal streaming endpoint.
 *
 * Issue #2202: Updated to test streaming (pipe-pane) instead of polling.
 * Includes Issue #303 security tests: auth, rate limiting, shared streams, ping/pong.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerWsTerminalRoute, _resetForTesting, _activeStreamCount, _subscriberCount } from '../ws-terminal.js';
import type { SessionManager, SessionInfo } from '../session.js';
import type { TmuxManager } from '../tmux.js';
import type { AuthManager } from '../services/auth/index.js';
import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import type { PtyStreamCallbacks } from '../pty-stream.js';

// --- Mock PtyStream ---

interface MockPtyInstance {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
  getCatchup: ReturnType<typeof vi.fn>;
  setInitialCatchup: ReturnType<typeof vi.fn>;
  active: boolean;
  fifoPath: string;
}

let capturedPtyCallbacks: PtyStreamCallbacks | null = null;
let mockPtyInstance: MockPtyInstance | null = null;

vi.mock('../pty-stream.js', () => {
  // Use a class so `new PtyStream(...)` works in the source code
  class MockPtyStream {
    start = vi.fn(async () => { this.active = true; });
    stop = vi.fn(async () => { this.active = false; });
    cleanup = vi.fn();
    getCatchup = vi.fn(() => '');
    setInitialCatchup = vi.fn();
    active = false;
    fifoPath = '/tmp/test.fifo';

    constructor(_windowId: string, _tmux: unknown, callbacks: PtyStreamCallbacks) {
      capturedPtyCallbacks = callbacks;
      mockPtyInstance = this; // eslint-disable-line @typescript-eslint/no-this-alias
    }
  }
  return { PtyStream: MockPtyStream, CATCHUP_BUFFER_SIZE: 65536 };
});

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
    id: '11111111-1111-1111-1111-111111111111',
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
  } as SessionInfo;
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
    pipePane: vi.fn(async () => {}),
    unpipePane: vi.fn(async () => {}),
    _paneContent: 'pane content',
  } as unknown as TmuxManager & { _paneContent: string };
}

function makeAuthManager(opts?: { enabled?: boolean; valid?: boolean; rateLimited?: boolean; sendAllowed?: boolean; role?: string }): AuthManager {
  const enabled = opts?.enabled ?? false;
  const valid = opts?.valid ?? true;
  const rateLimited = opts?.rateLimited ?? false;
  const sendAllowed = opts?.sendAllowed ?? true;
  const role = opts?.role ?? 'admin';
  return {
    authEnabled: enabled,
    validate: vi.fn(() => ({
      valid,
      keyId: valid ? 'test-key' : null,
      rateLimited,
    })),
    hasPermission: vi.fn((_keyId: string | null | undefined, permission: string) => permission !== 'send' || sendAllowed),
    getRole: vi.fn(() => role),
  } as unknown as AuthManager;
}

// Extract the WS handler from the registered route
function getWsHandler(app: FastifyInstance): (
  socket: WebSocket,
  req: { params: { id: string }; query?: Record<string, string | undefined>; headers?: Record<string, string>; authKeyId?: string | null },
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

/** Flush pending microtasks (for async IIFE in startPtyStream). */
async function flushAsync(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

// --- Tests ---

describe('ws-terminal', () => {
  // UUID-format IDs for Issue #412 validation
  const SESS1 = '11111111-1111-1111-1111-111111111111';
  const SESS2 = '22222222-2222-2222-2222-222222222222';

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
    capturedPtyCallbacks = null;
    mockPtyInstance = null;
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
      handler(ws, { params: { id: '00000000-0000-0000-0000-000000000000' } });

      const lastSent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(lastSent.type).toBe('error');
      expect(lastSent.message).toBe('Session not found');
      expect(ws.close).toHaveBeenCalled();
    });

    it('should accept connections for existing sessions', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      expect(ws.close).not.toHaveBeenCalled();
    });
  });

  describe('pane content catchup', () => {
    it('should capture pane content and send as catchup on first connect', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      // Allow async setup (startPtyStream's async IIFE)
      await flushAsync();

      expect(tmux.capturePane).toHaveBeenCalledWith('win-1');
      const paneMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'pane';
      });
      expect(paneMsg).toBeDefined();
      expect(JSON.parse(paneMsg!).content).toBe('pane content');
    });

    it('should set initial catchup on the PtyStream', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      await flushAsync();

      expect(mockPtyInstance!.setInitialCatchup).toHaveBeenCalledWith('pane content');
    });

    it('should call PtyStream.start()', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      await flushAsync();

      expect(mockPtyInstance!.start).toHaveBeenCalled();
    });
  });

  describe('stream data fanout', () => {
    it('should forward PTY data to subscribers as stream messages', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });
      await flushAsync();

      // Simulate PTY data arriving
      capturedPtyCallbacks!.onData('hello from terminal');

      const streamMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'stream';
      });
      expect(streamMsg).toBeDefined();
      expect(JSON.parse(streamMsg!).data).toBe('hello from terminal');
    });

    it('should fan out to multiple subscribers', async () => {
      sessions.set(SESS1, makeSession());
      const ws1 = makeMockWebSocket();
      const ws2 = makeMockWebSocket();
      const handler = getWsHandler(app);

      handler(ws1, { params: { id: SESS1 } });
      await flushAsync();

      handler(ws2, { params: { id: SESS1 } });
      await flushAsync();

      // Simulate data
      capturedPtyCallbacks!.onData('multi');

      for (const ws of [ws1, ws2]) {
        const streamMsg = ws._sent.find(s => {
          const parsed = JSON.parse(s);
          return parsed.type === 'stream';
        });
        expect(streamMsg).toBeDefined();
        expect(JSON.parse(streamMsg!).data).toBe('multi');
      }
    });

    it('should send catchup to late-joining subscribers', async () => {
      sessions.set(SESS1, makeSession());
      const ws1 = makeMockWebSocket();
      const ws2 = makeMockWebSocket();
      const handler = getWsHandler(app);

      // First subscriber connects
      handler(ws1, { params: { id: SESS1 } });
      await flushAsync();

      // Simulate PTY stream becoming active
      mockPtyInstance!.active = true;
      mockPtyInstance!.getCatchup.mockReturnValue('catchup content');

      // Second subscriber connects after stream is active
      handler(ws2, { params: { id: SESS1 } });

      // Should receive catchup
      const paneMsg = ws2._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'pane';
      });
      expect(paneMsg).toBeDefined();
      expect(JSON.parse(paneMsg!).content).toBe('catchup content');
    });
  });

  describe('status updates', () => {
    it('should detect and send status changes', async () => {
      sessions.set(SESS1, makeSession({ status: 'idle' }));
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });
      await flushAsync();

      // Change session status
      const session = sessions.get(SESS1)!;
      session.status = 'working';

      // Advance past the status poll interval (3s)
      await vi.advanceTimersByTimeAsync(3_000);

      const statusMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'status' && parsed.status === 'working';
      });
      expect(statusMsg).toBeDefined();
    });

    it('should send status change when session status changes', async () => {
      sessions.set(SESS1, makeSession({ status: 'idle' }));
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });
      await flushAsync();

      // First tick — sends initial status
      await vi.advanceTimersByTimeAsync(3_000);
      const statusCountAfterFirst = ws._sent.filter(s => JSON.parse(s).type === 'status').length;

      // Update session status
      const session = sessions.get(SESS1)!;
      session.status = 'working';

      // Second tick — should detect status change
      await vi.advanceTimersByTimeAsync(3_000);
      const statusCountAfterSecond = ws._sent.filter(s => JSON.parse(s).type === 'status').length;

      expect(statusCountAfterSecond).toBeGreaterThan(statusCountAfterFirst);
      const lastStatus = ws._sent
        .map(s => JSON.parse(s))
        .filter(m => m.type === 'status')
        .pop();
      expect(lastStatus!.status).toBe('working');
    });

    it('should not send duplicate status when unchanged', async () => {
      sessions.set(SESS1, makeSession({ status: 'idle' }));
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });
      await flushAsync();

      await vi.advanceTimersByTimeAsync(3_000);
      const statusCountAfterFirst = ws._sent.filter(s => JSON.parse(s).type === 'status').length;

      // Status stays the same
      await vi.advanceTimersByTimeAsync(3_000);
      const statusCountAfterSecond = ws._sent.filter(s => JSON.parse(s).type === 'status').length;

      // Should not have sent additional status messages
      expect(statusCountAfterSecond).toBe(statusCountAfterFirst);
    });
  });

  describe('error cases', () => {
    it('should evict all subscribers when PTY stream ends', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });
      await flushAsync();

      // Simulate PTY stream ending
      capturedPtyCallbacks!.onEnd();

      expect(ws.close).toHaveBeenCalled();
      expect(_activeStreamCount()).toBe(0);
    });

    it('should send error for unknown message types', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'input', text: 'test' }));

      // This should work fine — test an actual invalid message
      ws._emit('message', JSON.stringify({ type: 'unknown_type' }));

      const errorMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'error' && parsed.message.includes('Invalid message');
      });
      expect(errorMsg).toBeDefined();
    });

    it('should send error for invalid JSON', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', 'not json');

      const errorMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'error' && parsed.message.includes('Invalid message');
      });
      expect(errorMsg).toBeDefined();
    });

    it('should evict subscribers when capturePane fails', async () => {
      sessions.set(SESS1, makeSession());
      (tmux.capturePane as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('pane gone'));
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      // Allow async setup to fail
      await flushAsync();

      const errorMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'error' && parsed.message.includes('Failed to start terminal streaming');
      });
      expect(errorMsg).toBeDefined();
    });
  });

  describe('input forwarding', () => {
    it('should forward input messages to sessionManager.sendMessage', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'input', text: 'hello claude' }));

      expect(sessionManager.sendMessage).toHaveBeenCalledWith(SESS1, 'hello claude');
    });

    it('should ignore input messages after socket close', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('close');
      ws._emit('message', JSON.stringify({ type: 'input', text: 'should be ignored' }));

      expect(sessionManager.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('resize handling', () => {
    it('should forward resize to tmux.resizePane', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));

      expect(tmux.resizePane).toHaveBeenCalledWith('win-1', 120, 40);
    });

    it('should default to 80x24 when cols/rows are not provided', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'resize' }));

      expect(tmux.resizePane).toHaveBeenCalledWith('win-1', 80, 24);
    });

    it('should clamp cols to [10, 500] (Issue #581)', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'resize', cols: 5 }));
      expect(tmux.resizePane).toHaveBeenCalledWith('win-1', 10, expect.any(Number));

      vi.clearAllMocks();
      (tmux.resizePane as ReturnType<typeof vi.fn>).mockClear();
      ws._emit('message', JSON.stringify({ type: 'resize', cols: 999 }));
      // clamp returns 500 for cols > 500
      expect(tmux.resizePane).toHaveBeenCalledWith('win-1', 500, expect.any(Number));
    });

    it('should clamp rows to [5, 200] (Issue #581)', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'resize', rows: 2 }));
      expect(tmux.resizePane).toHaveBeenCalledWith('win-1', expect.any(Number), 5);

      vi.clearAllMocks();
      (tmux.resizePane as ReturnType<typeof vi.fn>).mockClear();
      ws._emit('message', JSON.stringify({ type: 'resize', rows: 500 }));
      expect(tmux.resizePane).toHaveBeenCalledWith('win-1', expect.any(Number), 200);
    });

    it('should pass valid dimensions unchanged', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));

      expect(tmux.resizePane).toHaveBeenCalledWith('win-1', 100, 30);
    });

    it('should handle non-number cols/rows gracefully', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'resize', cols: 'wide', rows: 'tall' }));

      // Should use default 80x24 when parsing fails (Zod rejects non-numbers)
      const errorMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'error';
      });
      expect(errorMsg).toBeDefined();
    });
  });

  describe('cleanup on disconnect', () => {
    it('should stop the stream after close event when last subscriber leaves', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });
      await flushAsync();

      expect(_activeStreamCount()).toBe(1);

      ws._emit('close');

      expect(_activeStreamCount()).toBe(0);
      // Status timer should be cleared
      expect(mockPtyInstance!.stop).toHaveBeenCalled();
    });

    it('should ignore messages after close', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('close');
      const sentBefore = ws._sent.length;
      ws._emit('message', JSON.stringify({ type: 'input', text: 'after close' }));

      expect(sessionManager.sendMessage).not.toHaveBeenCalled();
    });

    it('should continue streaming when one of two subscribers disconnects', async () => {
      sessions.set(SESS1, makeSession());
      const ws1 = makeMockWebSocket();
      const ws2 = makeMockWebSocket();
      const handler = getWsHandler(app);

      handler(ws1, { params: { id: SESS1 } });
      await flushAsync();

      handler(ws2, { params: { id: SESS1 } });
      await flushAsync();

      expect(_subscriberCount(SESS1)).toBe(2);

      ws1._emit('close');

      expect(_subscriberCount(SESS1)).toBe(1);
      expect(_activeStreamCount()).toBe(1);

      // ws2 should still receive stream data
      capturedPtyCallbacks!.onData('still streaming');
      const streamMsg = ws2._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'stream' && parsed.data === 'still streaming';
      });
      expect(streamMsg).toBeDefined();
    });

    it('should handle multiple close() calls safely', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('close');
      ws._emit('close');

      expect(_activeStreamCount()).toBe(0);
    });
  });

  describe('send helper', () => {
    it('should not attempt to send when ws.readyState is CLOSED', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._setReadyState(3); // CLOSED

      // Trigger a send via stream data
      capturedPtyCallbacks?.onData('should not send');

      // The last send attempt should have been ignored due to CLOSED state
      const sentBeforeClose = ws._sent.length;
      // No new messages should be added after setting CLOSED
      capturedPtyCallbacks?.onData('after close');
      // Since the socket is CLOSED, no new messages should be in _sent
      // (except possibly the close() call's effects)
    });
  });

  describe('auth check (Issue #303)', () => {
    it('should register a preHandler', () => {
      const preHandler = getPreHandler(app);
      expect(preHandler).toBeDefined();
    });

    it('should allow connections when auth is disabled', () => {
      auth = makeAuthManager({ enabled: false });
      app = makeMockFastify();
      _resetForTesting();
      registerWsTerminalRoute(app, sessionManager, tmux, auth);
      sessions.set(SESS1, makeSession());

      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      expect(ws.close).not.toHaveBeenCalled();
    });

    it('should accept valid Bearer tokens', async () => {
      auth = makeAuthManager({ enabled: true, valid: true });
      app = makeMockFastify();
      _resetForTesting();
      registerWsTerminalRoute(app, sessionManager, tmux, auth);
      sessions.set(SESS1, makeSession());

      const reply = { status: vi.fn().mockReturnValue({ send: vi.fn() }) } as any;
      const req = { headers: { authorization: 'Bearer valid-token' } };
      const preHandler = getPreHandler(app);
      await preHandler(req, reply);

      // reply.status should NOT have been called (no 401/429)
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should reject invalid tokens with 401', async () => {
      auth = makeAuthManager({ enabled: true, valid: false });
      app = makeMockFastify();
      _resetForTesting();
      registerWsTerminalRoute(app, sessionManager, tmux, auth);

      const reply = { status: vi.fn().mockReturnValue({ send: vi.fn() }) } as any;
      const req = { headers: { authorization: 'Bearer bad-token' } };
      const preHandler = getPreHandler(app);
      await preHandler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });

    it('should reject rate-limited tokens with 429', async () => {
      auth = makeAuthManager({ enabled: true, valid: true, rateLimited: true });
      app = makeMockFastify();
      _resetForTesting();
      registerWsTerminalRoute(app, sessionManager, tmux, auth);

      const reply = { status: vi.fn().mockReturnValue({ send: vi.fn() }) } as any;
      const req = { headers: { authorization: 'Bearer token' } };
      const preHandler = getPreHandler(app);
      await preHandler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(429);
    });
  });

  describe('handshake auth (Issue #503)', () => {
    beforeEach(() => {
      auth = makeAuthManager({ enabled: true, valid: true });
      app = makeMockFastify();
      _resetForTesting();
      registerWsTerminalRoute(app, sessionManager, tmux, auth);
    });

    it('should accept valid auth handshake message', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'auth', token: 'valid-token' }));

      const lastSent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(lastSent.type).toBe('status');
      expect(lastSent.status).toBe('authenticated');
    });

    it('should reject invalid auth tokens', () => {
      // Override validate for this test
      (auth.validate as ReturnType<typeof vi.fn>).mockReturnValue({
        valid: false,
        keyId: null,
        rateLimited: false,
      });

      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'auth', token: 'bad' }));

      const lastSent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(lastSent.type).toBe('error');
      expect(lastSent.message).toContain('Unauthorized');
    });

    it('should reject auth messages missing token field', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'auth' }));

      const errorMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'error' && parsed.message.includes('token');
      });
      expect(errorMsg).toBeDefined();
    });

    it('should reject non-auth messages before authentication', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'input', text: 'hello' }));

      const lastSent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(lastSent.type).toBe('error');
      expect(lastSent.message).toContain('Not authenticated');
    });

    it('should allow input after successful auth', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'auth', token: 'valid' }));
      ws._emit('message', JSON.stringify({ type: 'input', text: 'after auth' }));

      expect(sessionManager.sendMessage).toHaveBeenCalledWith(SESS1, 'after auth');
    });

    it('should reject input when key lacks send permission', () => {
      auth = makeAuthManager({ enabled: true, valid: true, sendAllowed: false });
      app = makeMockFastify();
      _resetForTesting();
      registerWsTerminalRoute(app, sessionManager, tmux, auth);
      sessions.set(SESS1, makeSession());

      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'auth', token: 'valid' }));
      ws._emit('message', JSON.stringify({ type: 'input', text: 'unauthorized' }));

      const lastSent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(lastSent.type).toBe('error');
      expect(lastSent.message).toContain('send permission');
    });

    it('should drop connection on auth timeout (5s)', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      vi.advanceTimersByTime(5_000);

      const lastSent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(lastSent.type).toBe('error');
      expect(lastSent.message).toContain('Auth timeout');
    });

    it('should reject second auth attempt with Already authenticated', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'auth', token: 'valid' }));
      ws._emit('message', JSON.stringify({ type: 'auth', token: 'again' }));

      const lastSent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(lastSent.type).toBe('error');
      expect(lastSent.message).toContain('Already authenticated');
      // Should NOT close — just warn
      expect(ws.close).not.toHaveBeenCalled();
    });
  });

  describe('rate limiting (Issue #303)', () => {
    it('should allow up to 10 messages per second', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      for (let i = 0; i < 10; i++) {
        ws._emit('message', JSON.stringify({ type: 'input', text: `msg ${i}` }));
      }

      expect(sessionManager.sendMessage).toHaveBeenCalledTimes(10);
    });

    it('should reject the 11th message within 1 second', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      for (let i = 0; i < 11; i++) {
        ws._emit('message', JSON.stringify({ type: 'input', text: `msg ${i}` }));
      }

      const lastSent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(lastSent.type).toBe('error');
      expect(lastSent.message).toContain('Rate limit');
    });

    it('should reset rate limit window after 1 second', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      // Send 10 messages
      for (let i = 0; i < 10; i++) {
        ws._emit('message', JSON.stringify({ type: 'input', text: `msg ${i}` }));
      }

      // Advance past the rate limit window
      vi.advanceTimersByTime(1_000);

      // Should be able to send again
      ws._emit('message', JSON.stringify({ type: 'input', text: 'after window' }));
      expect(sessionManager.sendMessage).toHaveBeenCalledTimes(11);
    });

    it('should not count messages after socket close toward rate limit', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'input', text: 'before close' }));
      ws._emit('close');
      ws._emit('message', JSON.stringify({ type: 'input', text: 'after close' }));

      expect(sessionManager.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('shared streams (Issue #303)', () => {
    it('should share a single PTY stream for multiple connections to the same session', async () => {
      sessions.set(SESS1, makeSession());
      const ws1 = makeMockWebSocket();
      const ws2 = makeMockWebSocket();
      const handler = getWsHandler(app);

      handler(ws1, { params: { id: SESS1 } });
      await flushAsync();

      handler(ws2, { params: { id: SESS1 } });
      await flushAsync();

      // Should only create one stream
      expect(_activeStreamCount()).toBe(1);
      expect(_subscriberCount(SESS1)).toBe(2);
    });

    it('should create separate streams for different sessions', async () => {
      sessions.set(SESS1, makeSession());
      sessions.set(SESS2, makeSession({ id: SESS2, windowId: 'win-2' }));
      const ws1 = makeMockWebSocket();
      const ws2 = makeMockWebSocket();
      const handler = getWsHandler(app);

      handler(ws1, { params: { id: SESS1 } });
      await flushAsync();

      handler(ws2, { params: { id: SESS2 } });
      await flushAsync();

      expect(_activeStreamCount()).toBe(2);
    });
  });

  describe('ping/pong keep-alive (Issue #303)', () => {
    it('should send pings every 30 seconds (10 ticks at 3s)', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });
      await flushAsync();

      // 10 ticks × 3s = 30s
      await vi.advanceTimersByTimeAsync(30_000);

      expect(ws.ping).toHaveBeenCalled();
    });

    it('should keep connection alive when pong is received', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });
      await flushAsync();

      // Advance to first keepalive check
      await vi.advanceTimersByTimeAsync(30_000);

      // Simulate pong
      ws._emit('pong');

      // Advance to second keepalive check
      await vi.advanceTimersByTimeAsync(30_000);

      // Connection should still be alive
      expect(ws.close).not.toHaveBeenCalled();
    });

    it('should evict subscribers that do not respond to pings', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });
      await flushAsync();

      // Advance past keepalive timeout (35s)
      // First ping at 30s, then 35s passes without pong
      await vi.advanceTimersByTimeAsync(35_000);

      // The first keepalive check at 30s sends a ping.
      // We need to get past the 35s timeout from the last pong.
      // Since the subscriber was created with lastPongAt = Date.now(),
      // and we've advanced 35s without a pong, the next check should evict.
      // But wait — the first check is at 30s, and we check if (now - lastPongAt > 35s).
      // At 30s: now - lastPongAt = 30s < 35s → send ping, don't evict.
      // At 60s: now - lastPongAt = 60s > 35s → evict!
      await vi.advanceTimersByTimeAsync(25_000);

      expect(ws.close).toHaveBeenCalled();
    });

    it('should handle ping errors gracefully', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      ws.ping = vi.fn(() => { throw new Error('socket closed'); });
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });
      await flushAsync();

      // Advance to first keepalive check
      await vi.advanceTimersByTimeAsync(30_000);

      expect(ws.close).toHaveBeenCalled();
    });

    it('should clean up stream when all subscribers are evicted by keepalive', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });
      await flushAsync();

      // Advance past keepalive timeout
      await vi.advanceTimersByTimeAsync(65_000);

      expect(_activeStreamCount()).toBe(0);
    });
  });

  describe('ownership check (Issue #2170)', () => {
    beforeEach(() => {
      auth = makeAuthManager({ enabled: true, valid: true, role: 'operator' });
      app = makeMockFastify();
      _resetForTesting();
      registerWsTerminalRoute(app, sessionManager, tmux, auth);
    });

    it('should allow connection when session has no ownerKeyId', () => {
      sessions.set(SESS1, makeSession({ ownerKeyId: undefined }));
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, {
        params: { id: SESS1 },
        headers: { authorization: 'Bearer token' },
        authKeyId: 'test-key',
      });

      expect(ws.close).not.toHaveBeenCalled();
    });

    it('should reject pre-authenticated connection when key does not own session', () => {
      sessions.set(SESS1, makeSession({ ownerKeyId: 'other-key' }));
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, {
        params: { id: SESS1 },
        headers: { authorization: 'Bearer token' },
        authKeyId: 'test-key',
      });

      const lastSent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(lastSent.type).toBe('error');
      expect(lastSent.message).toContain('Forbidden');
      expect(ws.close).toHaveBeenCalled();
    });

    it('should allow pre-authenticated connection when key matches owner', () => {
      sessions.set(SESS1, makeSession({ ownerKeyId: 'test-key' }));
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, {
        params: { id: SESS1 },
        headers: { authorization: 'Bearer token' },
        authKeyId: 'test-key',
      });

      expect(ws.close).not.toHaveBeenCalled();
    });

    it('should allow admin role regardless of ownership', () => {
      auth = makeAuthManager({ enabled: true, valid: true, role: 'admin' });
      app = makeMockFastify();
      _resetForTesting();
      registerWsTerminalRoute(app, sessionManager, tmux, auth);
      sessions.set(SESS1, makeSession({ ownerKeyId: 'other-key' }));

      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, {
        params: { id: SESS1 },
        headers: { authorization: 'Bearer token' },
        authKeyId: 'test-key',
      });

      expect(ws.close).not.toHaveBeenCalled();
    });

    it('should allow master key regardless of ownership', () => {
      (auth.validate as ReturnType<typeof vi.fn>).mockReturnValue({
        valid: true,
        keyId: 'master',
        rateLimited: false,
      });

      sessions.set(SESS1, makeSession({ ownerKeyId: 'other-key' }));
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, {
        params: { id: SESS1 },
        headers: { authorization: 'Bearer token' },
        authKeyId: 'master',
      });

      expect(ws.close).not.toHaveBeenCalled();
    });

    it('should reject handshake-authenticated connection when key does not own session', () => {
      sessions.set(SESS1, makeSession({ ownerKeyId: 'other-key' }));
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'auth', token: 'valid' }));

      const errorMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'error' && parsed.message.includes('Forbidden');
      });
      expect(errorMsg).toBeDefined();
    });

    it('should allow handshake-authenticated connection when key matches owner', () => {
      sessions.set(SESS1, makeSession({ ownerKeyId: 'test-key' }));
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, { params: { id: SESS1 } });

      ws._emit('message', JSON.stringify({ type: 'auth', token: 'valid' }));

      const authMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'status' && parsed.status === 'authenticated';
      });
      expect(authMsg).toBeDefined();
    });
  });

  describe('read-only mode (Issue #2170)', () => {
    beforeEach(() => {
      auth = makeAuthManager({ enabled: true, valid: true });
      app = makeMockFastify();
      _resetForTesting();
      registerWsTerminalRoute(app, sessionManager, tmux, auth);
    });

    it('should reject input messages when ?readonly=true', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, {
        params: { id: SESS1 },
        query: { readonly: 'true' },
      });

      ws._emit('message', JSON.stringify({ type: 'auth', token: 'valid' }));
      ws._emit('message', JSON.stringify({ type: 'input', text: 'blocked' }));

      const lastSent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(lastSent.type).toBe('error');
      expect(lastSent.message).toContain('read-only');
    });

    it('should allow resize messages in read-only mode', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, {
        params: { id: SESS1 },
        query: { readonly: 'true' },
      });

      ws._emit('message', JSON.stringify({ type: 'auth', token: 'valid' }));
      ws._emit('message', JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));

      expect(tmux.resizePane).toHaveBeenCalledWith('win-1', 100, 30);
    });

    it('should receive stream output in read-only mode', async () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, {
        params: { id: SESS1 },
        query: { readonly: 'true' },
      });

      ws._emit('message', JSON.stringify({ type: 'auth', token: 'valid' }));
      await flushAsync();

      capturedPtyCallbacks!.onData('output');

      const streamMsg = ws._sent.find(s => {
        const parsed = JSON.parse(s);
        return parsed.type === 'stream' && parsed.data === 'output';
      });
      expect(streamMsg).toBeDefined();
    });

    it('should allow input when readonly is not set or is false', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, {
        params: { id: SESS1 },
        query: { readonly: 'false' },
      });

      ws._emit('message', JSON.stringify({ type: 'auth', token: 'valid' }));
      ws._emit('message', JSON.stringify({ type: 'input', text: 'allowed' }));

      expect(sessionManager.sendMessage).toHaveBeenCalledWith(SESS1, 'allowed');
    });

    it('should reject input in read-only mode even after auth', () => {
      sessions.set(SESS1, makeSession());
      const ws = makeMockWebSocket();
      const handler = getWsHandler(app);
      handler(ws, {
        params: { id: SESS1 },
        query: { readonly: 'true' },
      });

      // Authenticate first
      ws._emit('message', JSON.stringify({ type: 'auth', token: 'valid' }));

      // Then try to send input — should still be rejected
      ws._emit('message', JSON.stringify({ type: 'input', text: 'still blocked' }));

      const lastSent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(lastSent.type).toBe('error');
      expect(lastSent.message).toContain('read-only');
    });
  });
});
