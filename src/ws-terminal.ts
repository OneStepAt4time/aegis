/**
 * ws-terminal.ts — WebSocket endpoint for live terminal streaming.
 *
 * WS /v1/sessions/:id/terminal
 *
 * Protocol:
 *   Server → Client: { type: "pane", content: "..." }
 *   Server → Client: { type: "status", status: "idle" }
 *   Server → Client: { type: "error", message: "..." }
 *   Client → Server: { type: "input", text: "..." }
 *   Client → Server: { type: "resize", cols: 80, rows: 24 }
 *
 * Security (Issue #303, #503):
 *   - Auth validation via first-message handshake: client sends
 *     { type: "auth", token: "..." } as first message (#503)
 *   - Bearer header auth still works for non-browser clients
 *   - 5s auth timeout — connection dropped if not authenticated
 *   - Per-connection message rate limiting (10 msg/sec)
 *   - Shared tmux capture polls (one per session, not per connection)
 *   - Ping/pong keep-alive with dead connection detection
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SessionInfo, SessionManager } from './session.js';
import type { TmuxManager } from './tmux.js';
import type { AuthManager } from './auth.js';
import type WebSocket from 'ws';
import { clamp, wsInboundMessageSchema, isValidUUID } from './validation.js';
import { safeJsonParse } from './safe-json.js';

const POLL_INTERVAL_MS = 500;
const KEEPALIVE_INTERVAL_TICKS = 60; // 30s at 500ms intervals
const KEEPALIVE_TIMEOUT_MS = 35_000; // 30s interval + 5s grace
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_MESSAGES = 10;
const AUTH_TIMEOUT_MS = 5_000;

// ── Message types ──────────────────────────────────────────────────

interface WsPaneMessage {
  type: 'pane';
  content: string;
}

interface WsStatusMessage {
  type: 'status';
  status: string;
}

interface WsErrorMessage {
  type: 'error';
  message: string;
}

type WsOutboundMessage = WsPaneMessage | WsStatusMessage | WsErrorMessage;

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

type WsInboundMessage = WsInputMessage | WsResizeMessage | WsAuthMessage;

// ── Internal types ─────────────────────────────────────────────────

interface WsSubscriber {
  lastContent: string;
  lastStatus: string;
  closed: boolean;
  lastPongAt: number;
  messageTimestamps: number[];
  authenticated: boolean;
  authTimer: ReturnType<typeof setTimeout> | null;
}

interface SessionPoll {
  timer: ReturnType<typeof setInterval> | null;
  tickCount: number;
  subscribers: Map<WebSocket, WsSubscriber>;
}

// ── Module state ───────────────────────────────────────────────────

const sessionPolls = new Map<string, SessionPoll>();

/** Reset all internal state (for testing). */
export function _resetForTesting(): void {
  for (const poll of sessionPolls.values()) {
    if (poll.timer) clearInterval(poll.timer);
  }
  sessionPolls.clear();
}

/** Get the number of active shared polls (for testing). */
export function _activePollCount(): number {
  return sessionPolls.size;
}

/** Get subscriber count for a session (for testing). */
export function _subscriberCount(sessionId: string): number {
  return sessionPolls.get(sessionId)?.subscribers.size ?? 0;
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
      }

      // Create subscriber
      const subscriber: WsSubscriber = {
        lastContent: '',
        lastStatus: '',
        closed: false,
        lastPongAt: Date.now(),
        messageTimestamps: [],
        authenticated: !auth.authEnabled || !!preAuthed,
        authTimer: null,
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

      // Get or create shared session poll (only after session is confirmed to exist)
      if (session) {
        let poll = sessionPolls.get(sessionId);
        if (!poll) {
          poll = {
            timer: null,
            tickCount: 0,
            subscribers: new Map(),
          };
          sessionPolls.set(sessionId, poll);

          // Start the shared poll timer
          poll.timer = setInterval(async () => {
            poll!.tickCount++;
            await tickPoll(sessionId, sessions, tmux, poll!);
          }, POLL_INTERVAL_MS);
        }
        poll.subscribers.set(socket, subscriber);
      }

      // Handle pong responses for keep-alive
      socket.on('pong', () => {
        const sub = sessionPolls.get(sessionId)?.subscribers.get(socket);
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

            // Register subscriber to the session poll now that session is confirmed
            let authedPoll = sessionPolls.get(sessionId);
            if (!authedPoll) {
              authedPoll = {
                timer: null,
                tickCount: 0,
                subscribers: new Map(),
              };
              sessionPolls.set(sessionId, authedPoll);

              authedPoll.timer = setInterval(async () => {
                authedPoll!.tickCount++;
                await tickPoll(sessionId, sessions, tmux, authedPoll!);
              }, POLL_INTERVAL_MS);
            }
            authedPoll.subscribers.set(socket, subscriber);

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

// ── Shared poll logic ──────────────────────────────────────────────

async function tickPoll(
  sessionId: string,
  sessions: SessionManager,
  tmux: TmuxManager,
  poll: SessionPoll,
): Promise<void> {
  const session = sessions.getSession(sessionId);
  if (!session) {
    // Session gone — evict all subscribers and stop the poll
    if (poll.timer) clearInterval(poll.timer);
    poll.timer = null;
    for (const [socket, sub] of [...poll.subscribers]) {
      if (!sub.closed) {
        sendError(socket, 'Session no longer exists');
        evictSubscriber(sessionId, socket, sub);
      }
    }
    return;
  }

  let content: string;
  try {
    content = await tmux.capturePane(session.windowId);
  } catch { /* pane gone — evict all subscribers and stop the poll */
    if (poll.timer) clearInterval(poll.timer);
    poll.timer = null;
    for (const [socket, sub] of [...poll.subscribers]) {
      if (!sub.closed) {
        sendError(socket, 'Failed to capture pane — session may have ended');
        evictSubscriber(sessionId, socket, sub);
      }
    }
    return;
  }

  const currentStatus = session.status;

  // Fan out to all subscribers with per-subscriber deduplication
  for (const [socket, sub] of [...poll.subscribers]) {
    if (sub.closed || !sub.authenticated) continue;

    if (content !== sub.lastContent) {
      sub.lastContent = content;
      send(socket, { type: 'pane', content });
    }

    if (currentStatus !== sub.lastStatus) {
      sub.lastStatus = currentStatus;
      send(socket, { type: 'status', status: currentStatus });
    }
  }

  // Keep-alive check (every 60 ticks ≈ 30s)
  if (poll.tickCount % KEEPALIVE_INTERVAL_TICKS === 0) {
    const now = Date.now();
    for (const [socket, sub] of [...poll.subscribers]) {
      if (sub.closed) continue;

      // Evict dead connections
      if (now - sub.lastPongAt > KEEPALIVE_TIMEOUT_MS) {
        evictSubscriber(sessionId, socket, sub);
        continue;
      }

      // Send ping
      try {
        socket.ping();
      } catch { /* socket already closed */
        evictSubscriber(sessionId, socket, sub);
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

  const poll = sessionPolls.get(sessionId);
  if (poll) {
    poll.subscribers.delete(socket);

    // If no more subscribers, clean up the poll timer
    if (poll.subscribers.size === 0) {
      if (poll.timer) clearInterval(poll.timer);
      sessionPolls.delete(sessionId);
    }
  }

  try {
    socket.close();
  } catch { /* ignore */ }
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
