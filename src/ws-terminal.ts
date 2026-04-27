/**
 * ws-terminal.ts — WebSocket endpoint for live terminal streaming.
 *
 * WS /v1/sessions/:id/terminal
 *
 * Protocol:
 *   Server → Client: { type: "pane", content: "..." }      — full pane catchup
 *   Server → Client: { type: "stream", data: "..." }       — incremental PTY output
 *   Server → Client: { type: "status", status: "idle" }
 *   Server → Client: { type: "error", message: "..." }
 *   Client → Server: { type: "input", text: "..." }
 *   Client → Server: { type: "resize", cols: 80, rows: 24 }
 *
 * Issue #2202: Replaces 500ms capture-pane polling with real-time streaming
 * via tmux pipe-pane + FIFO. Status detection uses a slower poll (3s).
 *
 * Security (Issue #303, #503):
 *   - Auth validation via first-message handshake: client sends
 *     { type: "auth", token: "..." } as first message (#503)
 *   - Bearer header auth still works for non-browser clients
 *   - 5s auth timeout — connection dropped if not authenticated
 *   - Per-connection message rate limiting (10 msg/sec)
 *   - Shared PTY streams (one per session, not per connection)
 *   - Ping/pong keep-alive with dead connection detection
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SessionInfo, SessionManager } from './session.js';
import type { TmuxManager } from './tmux.js';
import type { AuthManager } from './services/auth/index.js';
import type WebSocket from 'ws';
import { clamp, wsInboundMessageSchema, isValidUUID } from './validation.js';
import { safeJsonParse } from './safe-json.js';
import { sanitizeOutput } from './sanitize-stream.js';
import { PtyStream } from './pty-stream.js';

const STATUS_POLL_INTERVAL_MS = 3_000;
const KEEPALIVE_INTERVAL_TICKS = 10; // 30s at 3s intervals
const KEEPALIVE_TIMEOUT_MS = 35_000; // 30s interval + 5s grace
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_MESSAGES = 10;
const AUTH_TIMEOUT_MS = 5_000;

// ── Message types ──────────────────────────────────────────────────

interface WsPaneMessage {
  type: 'pane';
  content: string;
}

interface WsStreamMessage {
  type: 'stream';
  data: string;
}

interface WsStatusMessage {
  type: 'status';
  status: string;
}

interface WsErrorMessage {
  type: 'error';
  message: string;
}

type WsOutboundMessage = WsPaneMessage | WsStreamMessage | WsStatusMessage | WsErrorMessage;

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
  closed: boolean;
  lastPongAt: number;
  messageTimestamps: number[];
  authenticated: boolean;
  authKeyId: string | null;
  authTimer: ReturnType<typeof setTimeout> | null;
  readonly: boolean;
}

/** Per-session streaming state (replaces the old polling SessionPoll). */
interface SessionStream {
  ptyStream: PtyStream | null;
  subscribers: Map<WebSocket, WsSubscriber>;
  statusTimer: ReturnType<typeof setInterval> | null;
  tickCount: number;
  lastStatus: string;
}

// ── Module state ───────────────────────────────────────────────────

const sessionStreams = new Map<string, SessionStream>();

/** Reset all internal state (for testing). */
export function _resetForTesting(): void {
  for (const stream of sessionStreams.values()) {
    if (stream.statusTimer) clearInterval(stream.statusTimer);
    if (stream.ptyStream) {
      stream.ptyStream.cleanup();
    }
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

// ── Route registration ─────────────────────────────────────────────

export function registerWsTerminalRoute(
  app: FastifyInstance,
  sessions: SessionManager,
  tmux: TmuxManager,
  auth: AuthManager,
): void {
  app.get<{ Params: { id: string } }>(
    '/v1/sessions/:id/terminal',
    {
      websocket: true,
      preHandler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!auth.authEnabled) return;

        // Bearer header auth still works for non-browser clients
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

        // No Bearer header — allow connection through; auth will be validated
        // via first-message handshake ({ type: "auth", token: "..." }).
        // Issue #503: tokens must NOT appear in URLs.
      },
    },
    (socket, req) => {
      const sessionId = req.params.id;
      // #412: Validate session ID is a UUID before lookup
      if (!isValidUUID(sessionId)) {
        sendError(socket, 'Invalid session ID — must be a UUID');
        socket.close();
        return;
      }

      // Check if already authenticated via Bearer header in preHandler
      const preAuthed = auth.authEnabled && req.headers?.authorization?.startsWith('Bearer ');
      const preAuthKeyId = preAuthed
        ? ((req as FastifyRequest & { authKeyId?: string | null }).authKeyId ?? null)
        : null;

      // #1130: When auth is required but not yet provided, do NOT check session
      // existence — that would leak whether a session ID is valid to unauthenticated clients.
      // For pre-authenticated clients (Bearer header) or when auth is disabled, check immediately.
      let session: SessionInfo | null = null;
      const deferSessionCheck = auth.authEnabled && !preAuthed;
      if (!deferSessionCheck) {
        session = sessions.getSession(sessionId);
        if (!session) {
          sendError(socket, 'Session not found');
          socket.close();
          return;
        }
        // Issue #2170: Ownership check for pre-authenticated connections
        if (preAuthed && !checkOwnership(session, preAuthKeyId, auth)) {
          sendError(socket, 'Forbidden — you do not own this session');
          socket.close();
          return;
        }
      }

      // Issue #2170: Read-only mode via query parameter
      const query = (req as FastifyRequest & { query?: Record<string, string | undefined> }).query ?? {};
      const isReadonly = query.readonly === 'true';
      const subscriber: WsSubscriber = {
        closed: false,
        lastPongAt: Date.now(),
        messageTimestamps: [],
        authenticated: !auth.authEnabled || !!preAuthed,
        authKeyId: preAuthKeyId ?? null,
        authTimer: null,
        readonly: isReadonly,
      };

      // If auth is required but not yet provided, set auth timeout
      if (auth.authEnabled && !subscriber.authenticated) {
        subscriber.authTimer = setTimeout(() => {
          if (!subscriber.closed && !subscriber.authenticated) {
            sendError(socket, 'Auth timeout — no auth message received');
            evictSubscriber(sessionId, socket, subscriber);
          }
        }, AUTH_TIMEOUT_MS);
      }

      // Register subscriber to the session stream (only after session is confirmed to exist)
      if (session) {
        addSubscriberToStream(sessionId, session, socket, subscriber, sessions, tmux);
      }

      // Handle pong responses for keep-alive
      socket.on('pong', () => {
        const sub = sessionStreams.get(sessionId)?.subscribers.get(socket);
        if (sub) sub.lastPongAt = Date.now();
      });

      // Handle incoming messages with rate limiting
      socket.on('message', async (data: Buffer | string) => {
        if (subscriber.closed) return;

        // Rate limit check
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
          // Handle auth handshake (Issue #503)
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
            // Auth successful
            subscriber.authenticated = true;
            subscriber.authKeyId = result.keyId;
            if (subscriber.authTimer) {
              clearTimeout(subscriber.authTimer);
              subscriber.authTimer = null;
            }

            // #1130: Now that the client is authenticated, check session existence.
            // This was deferred to avoid leaking valid session IDs to unauthenticated clients.
            const authedSession = sessions.getSession(sessionId);
            if (!authedSession) {
              sendError(socket, 'Session not found');
              evictSubscriber(sessionId, socket, subscriber);
              return;
            }

            // Issue #2170: Ownership check for handshake-authenticated connections
            if (!checkOwnership(authedSession, subscriber.authKeyId, auth)) {
              sendError(socket, 'Forbidden — you do not own this session');
              evictSubscriber(sessionId, socket, subscriber);
              return;
            }

            // Register subscriber to the session stream now that session is confirmed
            addSubscriberToStream(sessionId, authedSession, socket, subscriber, sessions, tmux);

            send(socket, { type: 'status', status: 'authenticated' });
            return;
          }

          // Reject non-auth messages when not yet authenticated
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
            // Issue #2170: Reject input in read-only mode
            if (subscriber.readonly) {
              sendError(socket, 'Forbidden — read-only connection cannot send input');
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

// ── Session stream management ──────────────────────────────────────

/**
 * Add a subscriber to a session's stream. Creates the stream (PTY + status timer)
 * if this is the first subscriber.
 */
function addSubscriberToStream(
  sessionId: string,
  session: SessionInfo,
  socket: WebSocket,
  subscriber: WsSubscriber,
  sessions: SessionManager,
  tmux: TmuxManager,
): void {
  let stream = sessionStreams.get(sessionId);

  if (!stream) {
    stream = {
      ptyStream: null,
      subscribers: new Map(),
      statusTimer: null,
      tickCount: 0,
      lastStatus: session.status,
    };
    sessionStreams.set(sessionId, stream);

    // Start PTY streaming for this session
    startPtyStream(sessionId, session, stream, sessions, tmux);

    // Start status poll (lightweight — checks session.status, no capture-pane)
    stream.statusTimer = setInterval(() => {
      stream!.tickCount++;
      tickStatus(sessionId, sessions, stream!);
    }, STATUS_POLL_INTERVAL_MS);
  }

  stream.subscribers.set(socket, subscriber);

  // Send catchup to the new subscriber if PTY stream is already active
  if (stream.ptyStream?.active) {
    const catchup = stream.ptyStream.getCatchup();
    if (catchup) {
      send(socket, { type: 'pane', content: sanitizeOutput(catchup) });
    }
  }
}

/**
 * Start the PTY stream for a session. Captures initial pane content as catchup,
 * then starts pipe-pane streaming for incremental updates.
 */
function startPtyStream(
  sessionId: string,
  session: SessionInfo,
  stream: SessionStream,
  sessions: SessionManager,
  tmux: TmuxManager,
): void {
  const pty = new PtyStream(session.windowId, tmux, {
    onData(chunk: string) {
      // Fan out incremental PTY output to all authenticated subscribers
      for (const [ws, sub] of [...stream.subscribers]) {
        if (!sub.closed && sub.authenticated) {
          send(ws, { type: 'stream', data: chunk });
        }
      }
    },
    onError(err: Error) {
      console.warn(`PTY stream error for session ${sessionId.slice(0, 8)}: ${err.message}`);
      // The status poll will detect dead sessions and evict subscribers.
    },
    onEnd() {
      // Pipe ended — session terminated or pipe-pane stopped.
      // Evict all subscribers so they reconnect cleanly.
      for (const [ws, sub] of [...stream.subscribers]) {
        if (!sub.closed) {
          sendError(ws, 'PTY stream ended — session may have terminated');
          evictSubscriber(sessionId, ws, sub);
        }
      }
    },
  });

  stream.ptyStream = pty;

  // Fire-and-forget: capture initial pane content, then start pipe-pane streaming.
  // Errors are caught and logged — the status poll handles subscriber eviction.
  (async () => {
    try {
      // Capture current pane content for catchup before streaming starts.
      // pipe-pane -o only streams NEW output, so this captures history.
      const initialPane = await tmux.capturePane(session.windowId);
      pty.setInitialCatchup(initialPane);

      // Send initial pane to all current subscribers as catchup
      for (const [ws, sub] of [...stream.subscribers]) {
        if (!sub.closed && sub.authenticated) {
          send(ws, { type: 'pane', content: sanitizeOutput(initialPane) });
        }
      }

      await pty.start();
    } catch (err) {
      console.error(`PTY stream start failed for session ${sessionId.slice(0, 8)}: ${(err as Error).message}`);
      // Evict all subscribers — streaming is unavailable
      for (const [ws, sub] of [...stream.subscribers]) {
        if (!sub.closed) {
          sendError(ws, 'Failed to start terminal streaming');
          evictSubscriber(sessionId, ws, sub);
        }
      }
    }
  })();
}

// ── Status + keepalive tick ────────────────────────────────────────

function tickStatus(
  sessionId: string,
  sessions: SessionManager,
  stream: SessionStream,
): void {
  const session = sessions.getSession(sessionId);
  if (!session) {
    // Session gone — evict all subscribers and stop the stream
    for (const [ws, sub] of [...stream.subscribers]) {
      if (!sub.closed) {
        sendError(ws, 'Session no longer exists');
        evictSubscriber(sessionId, ws, sub);
      }
    }
    stopStream(sessionId, stream);
    return;
  }

  // Fan out status changes
  const currentStatus = session.status;
  if (currentStatus !== stream.lastStatus) {
    stream.lastStatus = currentStatus;
    for (const [ws, sub] of [...stream.subscribers]) {
      if (!sub.closed && sub.authenticated) {
        send(ws, { type: 'status', status: currentStatus });
      }
    }
  }

  // Keep-alive check (every 10 ticks ≈ 30s)
  if (stream.tickCount % KEEPALIVE_INTERVAL_TICKS === 0) {
    const now = Date.now();
    for (const [ws, sub] of [...stream.subscribers]) {
      if (sub.closed) continue;

      // Evict dead connections
      if (now - sub.lastPongAt > KEEPALIVE_TIMEOUT_MS) {
        evictSubscriber(sessionId, ws, sub);
        continue;
      }

      // Send ping
      try {
        ws.ping();
      } catch { /* socket already closed */
        evictSubscriber(sessionId, ws, sub);
      }
    }
  }
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

// ── Ownership check (Issue #2170) ──────────────────────────────────

/**
 * Verify that the authenticated key is allowed to access this session.
 * Master/admin keys bypass the ownership check.
 */
function checkOwnership(
  session: SessionInfo,
  authKeyId: string | null,
  auth: AuthManager,
): boolean {
  // Master token always has access
  if (authKeyId === 'master') return true;
  // Admin role bypasses ownership check
  if (auth.getRole(authKeyId) === 'admin') return true;
  // No owner set on session — any authenticated key can access
  if (!session.ownerKeyId) return true;
  // Key matches owner
  return session.ownerKeyId === authKeyId;
}

// ── Subscriber management ──────────────────────────────────────────

function evictSubscriber(
  sessionId: string,
  socket: WebSocket,
  sub: WsSubscriber,
): void {
  if (sub.closed) return;
  sub.closed = true;

  // Clean up auth timer if pending
  if (sub.authTimer) {
    clearTimeout(sub.authTimer);
    sub.authTimer = null;
  }

  const stream = sessionStreams.get(sessionId);
  if (stream) {
    stream.subscribers.delete(socket);

    // If no more subscribers, clean up the stream
    if (stream.subscribers.size === 0) {
      stopStream(sessionId, stream);
    }
  }

  try {
    socket.close();
  } catch { /* ignore */ }
}

/** Stop a session's PTY stream and status timer. */
function stopStream(sessionId: string, stream: SessionStream): void {
  if (stream.statusTimer) {
    clearInterval(stream.statusTimer);
    stream.statusTimer = null;
  }

  if (stream.ptyStream) {
    stream.ptyStream.stop().catch(err =>
      console.warn(`Error stopping PTY stream for ${sessionId}: ${err.message}`),
    );
    stream.ptyStream = null;
  }

  sessionStreams.delete(sessionId);
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
