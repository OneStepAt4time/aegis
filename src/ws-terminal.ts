/**
 * ws-terminal.ts — WebSocket endpoint for live terminal streaming.
 *
 * WS /v1/sessions/:id/terminal
 *
 * Protocol (v1 — real streaming):
 *   Server → Client: { type: "output", data: "<raw ANSI>" }     — incremental stream chunk
 *   Server → Client: { type: "snapshot", data: "<raw ANSI>" }  — full screen (reconnect recovery)
 *   Server → Client: { type: "mode", mode: "streaming"|"polling" }
 *   Server → Client: { type: "status", status: "idle" }
 *   Server → Client: { type: "error", message: "..." }
 *   Client → Server: { type: "input", text: "..." }
 *   Client → Server: { type: "resize", cols: 80, rows: 24 }
 *
 * Streaming mode (Unix): tmux pipe-pane -o 'cat' → child stdout → WS
 * Fallback mode (Windows / pipe-pane failure): capture-pane polling with -e flag
 *
 * Security (Issue #303, #503):
 *   - Auth validation via first-message handshake: client sends
 *     { type: "auth", token: "..." } as first message (#503)
 *   - Bearer header auth still works for non-browser clients
 *   - 5s auth timeout — connection dropped if not authenticated
 *   - Per-connection message rate limiting (10 msg/sec)
 *   - Shared stream per session (one pipe-pane or poll, not per connection)
 *   - Ping/pong keep-alive with dead connection detection
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SessionInfo, SessionManager } from './session.js';
import type { TmuxManager } from './tmux.js';
import type { AuthManager } from './services/auth/index.js';
import type WebSocket from 'ws';
import type { ChildProcess } from 'node:child_process';
import type { StreamSanitizer } from './sanitize-stream.js';
import { clamp, wsInboundMessageSchema, isValidUUID } from './validation.js';
import { safeJsonParse } from './safe-json.js';
import { sanitizeOutput, createStreamSanitizer } from './sanitize-stream.js';

const POLL_INTERVAL_MS = 500;
const KEEPALIVE_INTERVAL_TICKS = 60; // 30s at 500ms intervals
const KEEPALIVE_TIMEOUT_MS = 35_000; // 30s interval + 5s grace
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_MESSAGES = 10;
const AUTH_TIMEOUT_MS = 5_000;
const WS_BACKPRESSURE_THRESHOLD = 256 * 1024; // 256KB

// ── Message types ──────────────────────────────────────────────────

interface WsOutputMessage {
  type: 'output';
  data: string;
}

interface WsSnapshotMessage {
  type: 'snapshot';
  data: string;
}

interface WsModeMessage {
  type: 'mode';
  mode: 'streaming' | 'polling';
}

interface WsStatusMessage {
  type: 'status';
  status: string;
}

interface WsErrorMessage {
  type: 'error';
  message: string;
}

type WsOutboundMessage = WsOutputMessage | WsSnapshotMessage | WsModeMessage | WsStatusMessage | WsErrorMessage;

interface WsInputMessage {
  type: 'input';
  text: string;
}

interface WsResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

interface WsAuthMessage {
  type: 'auth';
  token: string;
}

// Inbound message types (validated via wsInboundMessageSchema)
type _WsInboundMessage = WsInputMessage | WsResizeMessage | WsAuthMessage;

// ── Internal types ─────────────────────────────────────────────────

interface WsSubscriber {
  lastContent: string;
  lastStatus: string;
  closed: boolean;
  lastPongAt: number;
  messageTimestamps: number[];
  authenticated: boolean;
  authKeyId: string | null;
  authTimer: ReturnType<typeof setTimeout> | null;
}

interface PaneStream {
  mode: 'streaming' | 'polling';
  child: ChildProcess | null;
  sanitizer: StreamSanitizer | null;
  subscribers: Map<WebSocket, WsSubscriber>;
  fallbackTimer: ReturnType<typeof setInterval> | null;
  tickCount: number;
}

// ── Module state ───────────────────────────────────────────────────

const sessionStreams = new Map<string, PaneStream>();

let sessionManager: SessionManager | null = null;

/** Reset all internal state (for testing). */
export function _resetForTesting(): void {
  sessionManager = null;
  for (const stream of sessionStreams.values()) {
    if (stream.fallbackTimer) clearInterval(stream.fallbackTimer);
    if (stream.child) { try { stream.child.kill(); } catch { /* ignore */ } }
    tmuxStopCleanup(stream);
  }
  sessionStreams.clear();
}

/** Get the number of active streams (for testing). */
export function _activeStreamCount(): number {
  return sessionStreams.size;
}

/** Get subscriber count for a session (for testing). */
export function _subscriberCount(sessionId: string): number {
  return sessionStreams.get(sessionId)?.subscribers.size ?? 0;
}

/** Get stream mode for a session (for testing). */
export function _streamMode(sessionId: string): string {
  return sessionStreams.get(sessionId)?.mode ?? 'none';
}

// ── Route registration ─────────────────────────────────────────────

export function registerWsTerminalRoute(
  app: FastifyInstance,
  sessions: SessionManager,
  tmux: TmuxManager,
  auth: AuthManager,
): void {
  sessionManager = sessions;

  app.get<{ Params: { id: string } }>(
    '/v1/sessions/:id/terminal',
    {
      websocket: true,
      preHandler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!auth.authEnabled) return;

        const header = req.headers.authorization;
        if (header?.startsWith('Bearer ')) {
          const token = header.slice(7);
          const result = auth.validate(token);
          if (!result.valid) {
            return reply.status(401).send({ error: 'Unauthorized — invalid API key' });
          }
          if (result.rateLimited) {
            return reply.status(429).send({ error: 'Rate limit exceeded' });
          }
          (req as FastifyRequest & { authKeyId?: string | null }).authKeyId = result.keyId;
          return;
        }

        // No Bearer header — allow through; auth validated via first-message handshake.
      },
    },
    (socket, req) => {
      const sessionId = req.params.id;
      if (!isValidUUID(sessionId)) {
        sendError(socket, 'Invalid session ID — must be a UUID');
        socket.close();
        return;
      }

      const preAuthed = auth.authEnabled && req.headers?.authorization?.startsWith('Bearer ');
      let session: SessionInfo | null = null;
      const deferSessionCheck = auth.authEnabled && !preAuthed;
      if (!deferSessionCheck) {
        session = sessions.getSession(sessionId);
        if (!session) {
          sendError(socket, 'Session not found');
          socket.close();
          return;
        }
      }

      const preAuthKeyId = preAuthed
        ? ((req as FastifyRequest & { authKeyId?: string | null }).authKeyId ?? null)
        : null;
      const subscriber: WsSubscriber = {
        lastContent: '',
        lastStatus: '',
        closed: false,
        lastPongAt: Date.now(),
        messageTimestamps: [],
        authenticated: !auth.authEnabled || !!preAuthed,
        authKeyId: preAuthKeyId ?? null,
        authTimer: null,
      };

      if (auth.authEnabled && !subscriber.authenticated) {
        subscriber.authTimer = setTimeout(() => {
          if (!subscriber.closed && !subscriber.authenticated) {
            sendError(socket, 'Auth timeout — no auth message received');
            evictSubscriber(sessionId, socket, subscriber);
          }
        }, AUTH_TIMEOUT_MS);
      }

      // Register subscriber to the session's stream (creates stream if needed)
      if (session) {
        registerSubscriber(sessionId, session, socket, subscriber, tmux);
      }

      socket.on('pong', () => {
        const sub = sessionStreams.get(sessionId)?.subscribers.get(socket);
        if (sub) sub.lastPongAt = Date.now();
      });

      socket.on('message', async (data: Buffer | string) => {
        if (subscriber.closed) return;

        if (!checkRateLimit(subscriber)) {
          sendError(socket, 'Rate limit exceeded — max 10 messages per second');
          evictSubscriber(sessionId, socket, subscriber);
          return;
        }

        const jsonParsed = safeJsonParse(data.toString(), 'WebSocket message');
        if (!jsonParsed.ok) {
          sendError(socket, `Invalid message: ${jsonParsed.error}`);
          return;
        }

        const parsed = wsInboundMessageSchema.safeParse(jsonParsed.data);
        if (!parsed.success) {
          sendError(socket, `Invalid message: ${parsed.error.issues.map(i => i.message).join(', ')}`);
          return;
        }

        const msg = parsed.data;

        try {
          if (msg.type === 'auth') {
            if (subscriber.authenticated) {
              sendError(socket, 'Already authenticated');
              return;
            }
            if (typeof msg.token !== 'string' || !msg.token) {
              sendError(socket, 'Auth message requires a token field');
              evictSubscriber(sessionId, socket, subscriber);
              return;
            }
            const result = auth.validate(msg.token);
            if (!result.valid) {
              sendError(socket, 'Unauthorized — invalid API key');
              evictSubscriber(sessionId, socket, subscriber);
              return;
            }
            if (result.rateLimited) {
              sendError(socket, 'Rate limit exceeded');
              evictSubscriber(sessionId, socket, subscriber);
              return;
            }
            subscriber.authenticated = true;
            subscriber.authKeyId = result.keyId;
            if (subscriber.authTimer) {
              clearTimeout(subscriber.authTimer);
              subscriber.authTimer = null;
            }

            const authedSession = sessions.getSession(sessionId);
            if (!authedSession) {
              sendError(socket, 'Session not found');
              evictSubscriber(sessionId, socket, subscriber);
              return;
            }

            registerSubscriber(sessionId, authedSession, socket, subscriber, tmux);
            send(socket, { type: 'status', status: 'authenticated' });
            return;
          }

          if (!subscriber.authenticated) {
            sendError(socket, 'Not authenticated — send { type: "auth", token: "..." } first');
            evictSubscriber(sessionId, socket, subscriber);
            return;
          }

          if (msg.type === 'input' && typeof msg.text === 'string') {
            if (!auth.hasPermission(subscriber.authKeyId, 'send')) {
              sendError(socket, 'Forbidden: missing send permission');
              return;
            }
            await sessions.sendMessage(sessionId, msg.text);
          } else if (msg.type === 'resize') {
            const resizeSession = sessions.getSession(sessionId);
            if (!resizeSession) {
              sendError(socket, 'Session no longer exists');
              evictSubscriber(sessionId, socket, subscriber);
              return;
            }
            const cols = clamp(msg.cols ?? 80, 10, 500, 80);
            const rows = clamp(msg.rows ?? 24, 5, 200, 24);
            await tmux.resizePane(resizeSession.windowId, cols, rows);
          }
        } catch (e) {
          sendError(socket, `Failed to process message: ${e instanceof Error ? e.message : String(e)}`);
        }
      });

      socket.on('close', () => {
        evictSubscriber(sessionId, socket, subscriber);
      });
    },
  );
}

// ── Subscriber & stream lifecycle ───────────────────────────────────

function registerSubscriber(
  sessionId: string,
  session: SessionInfo,
  socket: WebSocket,
  subscriber: WsSubscriber,
  tmux: TmuxManager,
): void {
  let stream = sessionStreams.get(sessionId);

  if (!stream) {
    stream = createPaneStream(sessionId, session, tmux);
    sessionStreams.set(sessionId, stream);
  }

  stream.subscribers.set(socket, subscriber);

  // Send current mode to this subscriber
  send(socket, { type: 'mode', mode: stream.mode });

  // Send snapshot for instant visual recovery
  sendSnapshot(socket, session, tmux).catch(() => { /* best-effort */ });
}

async function sendSnapshot(
  socket: WebSocket,
  session: SessionInfo,
  tmux: TmuxManager,
): Promise<void> {
  try {
    const content = await tmux.capturePane(session.windowId);
    const sanitized = sanitizeOutput(content);
    send(socket, { type: 'snapshot', data: sanitized });
  } catch {
    send(socket, { type: 'snapshot', data: '' });
  }
}

function createPaneStream(
  sessionId: string,
  session: SessionInfo,
  tmux: TmuxManager,
): PaneStream {
  const stream: PaneStream = {
    mode: 'polling',
    child: null,
    sanitizer: null,
    subscribers: new Map(),
    fallbackTimer: null,
    tickCount: 0,
  };

  const platform: 'win32' | 'darwin' | 'linux' =
    process.platform === 'win32' ? 'win32' :
    process.platform === 'darwin' ? 'darwin' : 'linux';

  // Try streaming mode on non-Windows platforms
  if (process.platform !== 'win32') {
    startStreamingMode(stream, sessionId, session, tmux, platform).catch(() => {
      startPollingFallback(stream, sessionId, tmux);
    });
  } else {
    startPollingFallback(stream, sessionId, tmux);
  }

  return stream;
}

async function startStreamingMode(
  stream: PaneStream,
  sessionId: string,
  session: SessionInfo,
  tmux: TmuxManager,
  platform: 'win32' | 'darwin' | 'linux',
): Promise<void> {
  const child = await tmux.startPipePane(session.windowId);

  stream.mode = 'streaming';
  stream.child = child;
  stream.sanitizer = createStreamSanitizer(platform);

  child.stdout!.on('data', (chunk: Buffer) => {
    const sanitized = stream.sanitizer!.feed(chunk.toString());
    if (sanitized) {
      broadcastData(stream, { type: 'output', data: sanitized });
    }
  });

  child.stderr!.on('data', () => { /* ignore stderr */ });

  child.on('exit', (code) => {
    stream.child = null;
    stream.sanitizer = null;
    console.log(`[ws-terminal] pipe-pane exited for ${sessionId} with code ${code ?? 'unknown'}, falling back to polling`);
    transitionToFallback(stream, sessionId, tmux);
  });

  child.on('error', (err) => {
    stream.child = null;
    stream.sanitizer = null;
    console.warn(`[ws-terminal] pipe-pane error for ${sessionId}: ${(err as Error).message}, falling back to polling`);
    transitionToFallback(stream, sessionId, tmux);
  });
}

function transitionToFallback(stream: PaneStream, sessionId: string, tmux: TmuxManager): void {
  if (stream.mode === 'polling') return; // already in fallback
  stream.mode = 'polling';

  // Flush any remaining buffered data from sanitizer
  if (stream.sanitizer) {
    const remaining = stream.sanitizer.flush();
    stream.sanitizer = null;
    if (remaining) broadcastData(stream, { type: 'output', data: remaining });
  }

  // Notify subscribers of mode change
  broadcastData(stream, { type: 'mode', mode: 'polling' });

  startPollingFallback(stream, sessionId, tmux);
}

function startPollingFallback(stream: PaneStream, sessionId: string, tmux: TmuxManager): void {
  if (stream.fallbackTimer) return; // already polling

  stream.mode = 'polling';
  stream.fallbackTimer = setInterval(async () => {
    stream.tickCount++;
    await tickPoll(sessionId, tmux, stream);
  }, POLL_INTERVAL_MS);
}

// ── Poll tick (fallback mode only) ───────────────────────────────────

async function tickPoll(
  sessionId: string,
  tmux: TmuxManager,
  stream: PaneStream,
): Promise<void> {
  const sessions = getSessionManagerFor(sessionId);
  if (!sessions) {
    stopStream(sessionId, stream);
    return;
  }

  const session = sessions.getSession(sessionId);
  if (!session) {
    stopStream(sessionId, stream);
    return;
  }

  let content: string;
  try {
    content = await tmux.capturePane(session.windowId);
  } catch {
    stopStream(sessionId, stream);
    return;
  }

  const sanitized = sanitizeOutput(content);
  const currentStatus = session.status;

  for (const [socket, sub] of [...stream.subscribers]) {
    if (sub.closed || !sub.authenticated) continue;

    if (sanitized !== sub.lastContent) {
      sub.lastContent = sanitized;
      send(socket, { type: 'output', data: sanitized });
    }

    if (currentStatus !== sub.lastStatus) {
      sub.lastStatus = currentStatus;
      send(socket, { type: 'status', status: currentStatus });
    }
  }

  // Keep-alive check (every 60 ticks ≈ 30s)
  if (stream.tickCount % KEEPALIVE_INTERVAL_TICKS === 0) {
    runKeepAlive(stream, sessionId);
  }
}

// ── Broadcast helpers ───────────────────────────────────────────────

function broadcastData(stream: PaneStream, msg: WsOutboundMessage): void {
  for (const [socket, sub] of [...stream.subscribers]) {
    if (sub.closed || !sub.authenticated) continue;
    if (socket.bufferedAmount > WS_BACKPRESSURE_THRESHOLD) continue;
    send(socket, msg);
  }
}

function runKeepAlive(stream: PaneStream, sessionId: string): void {
  const now = Date.now();
  for (const [socket, sub] of [...stream.subscribers]) {
    if (sub.closed) continue;

    if (now - sub.lastPongAt > KEEPALIVE_TIMEOUT_MS) {
      evictSubscriber(sessionId, socket, sub);
      continue;
    }

    try {
      socket.ping();
    } catch {
      evictSubscriber(sessionId, socket, sub);
    }
  }
}

// ── Stream cleanup ──────────────────────────────────────────────────

function stopStream(sessionId: string, stream: PaneStream): void {
  if (stream.fallbackTimer) {
    clearInterval(stream.fallbackTimer);
    stream.fallbackTimer = null;
  }

  for (const [socket, sub] of [...stream.subscribers]) {
    if (!sub.closed) {
      sendError(socket, 'Session no longer exists');
      evictSubscriber(sessionId, socket, sub);
    }
  }

  sessionStreams.delete(sessionId);
}

async function tmuxStopCleanup(stream: PaneStream): Promise<void> {
  // Don't call stopPipePane here — it requires a session reference we may not have.
  // The child process is killed directly. The tmux pipe-pane redirect will
  // naturally stop when the cat process dies.
  if (stream.child) {
    try { stream.child.kill(); } catch { /* ignore */ }
    stream.child = null;
  }
  stream.sanitizer = null;
}

// ── Subscriber management ──────────────────────────────────────────

function evictSubscriber(
  sessionId: string,
  socket: WebSocket,
  sub: WsSubscriber,
): void {
  if (sub.closed) return;
  sub.closed = true;

  if (sub.authTimer) {
    clearTimeout(sub.authTimer);
    sub.authTimer = null;
  }

  const stream = sessionStreams.get(sessionId);
  if (stream) {
    stream.subscribers.delete(socket);

    // If no more subscribers, clean up the stream
    if (stream.subscribers.size === 0) {
      cleanupEmptyStream(sessionId, stream);
    }
  }

  try {
    socket.close();
  } catch { /* ignore */ }
}

async function cleanupEmptyStream(sessionId: string, stream: PaneStream): Promise<void> {
  // Stop polling timer
  if (stream.fallbackTimer) {
    clearInterval(stream.fallbackTimer);
    stream.fallbackTimer = null;
  }

  // Kill pipe-pane child process
  if (stream.child) {
    try { stream.child.kill(); } catch { /* ignore */ }
    stream.child = null;
  }
  stream.sanitizer = null;

  sessionStreams.delete(sessionId);
}

// ── Rate limiting ──────────────────────────────────────────────────

function checkRateLimit(sub: WsSubscriber): boolean {
  const now = Date.now();
  sub.messageTimestamps = sub.messageTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

  if (sub.messageTimestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
    return false;
  }

  sub.messageTimestamps.push(now);
  return true;
}

// ── Helpers ────────────────────────────────────────────────────────

function send(ws: WebSocket, msg: WsOutboundMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendError(ws: WebSocket, message: string): void {
  send(ws, { type: 'error', message });
}

function getSessionManagerFor(_sessionId: string): SessionManager | null {
  return sessionManager;
}
