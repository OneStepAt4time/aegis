/**
 * ws-terminal.test.ts — Tests for WebSocket terminal streaming endpoint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerWsTerminalRoute } from '../ws-terminal.js';
import type { SessionManager, SessionInfo } from '../session.js';
import type { TmuxManager } from '../tmux.js';
import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';

// --- Mock Factories ---

function makeMockWebSocket(overrides?: Partial<WebSocket>): WebSocket {
  const handlers: Record<string, Function[]> = {};
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
    on: vi.fn((event: string, handler: Function) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    off: vi.fn((event: string, handler: Function) => {
      if (handlers[event]) {
        handlers[event] = handlers[event].filter(h => h !== handler);
      }
    }),
    // Test helpers (not on real WS, but needed for test control)
    _handlers: handlers,
    _sent: sent,
    _setReadyState(state: number): void { readyState = state; },
    _emit(event: string, ...args: unknown[]): void {
      const eventHandlers = handlers[event] ?? [];
      for (const h of eventHandlers) h(...args);
    },
  } as unknown as WebSocket;

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

// Extract the WS handler from the registered route
function getWsHandler(app: FastifyInstance): (
  socket: WebSocket,
  req: { params: { id: string } },
) => void {
  const get = app.get as ReturnType<typeof vi.fn>;
  expect(get).toHaveBeenCalled();
  // The third argument is the websocket handler
  return get.mock.calls[0][2] as (
    socket: WebSocket,
    req: { params: { id: string } },
  ) => void;
}

// --- Tests ---

describe('ws-terminal', () => {
  let app: FastifyInstance;
  let sessions: Map<string, SessionInfo>;
  let sessionManager: SessionManager;
  let tmux: TmuxManager & { _paneContent: string };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessions = new Map();
    sessionManager = makeSessionManager(sessions);
    tmux = makeTmuxManager();
    app = makeMockFastify();
    registerWsTerminalRoute(app, sessionManager, tmux);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('connection handling', () => {
    it('should register GET /v1/sessions/:id/terminal with websocket option', () => {
      const get = app.get as ReturnType<typeof vi.fn>;
      expect(get).toHaveBeenCalledWith(
        '/v1/sessions/:id/terminal',
        { websocket: true },
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
      expect(JSON.parse(errorMsg!).message).toContain('Unknown message type');
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

      // Should not throw
      expect(ws.close).toHaveBeenCalledTimes(3);
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
});
