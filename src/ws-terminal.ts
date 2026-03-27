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
 * Security (Issue #303):
 *   - Auth validation via preHandler (Bearer header or ?token=)
 *   - Per-connection message rate limiting (10 msg/sec)
 *   - Shared tmux capture polls (one per session, not per connection)
 *   - Ping/pong keep-alive with dead connection detection
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SessionManager } from './session.js';
import type { TmuxManager } from './tmux.js';
import type { AuthManager } from './auth.js';
import type WebSocket from 'ws';
import { clamp } from './validation.js';

const POLL_INTERVAL_MS = 500;
const KEEPALIVE_INTERVAL_TICKS = 60; // 30s at 500ms intervals
const KEEPALIVE_TIMEOUT_MS = 35_000; // 30s interval + 5s grace
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_MESSAGES = 10;

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

type WsInboundMessage = WsInputMessage | WsResizeMessage;

// ── Internal types ─────────────────────────────────────────────────

interface WsSubscriber {
  lastContent: string;
  lastStatus: string;
  closed: boolean;
  lastPongAt: number;
  messageTimestamps: number[];
}

interface SessionPoll {
  timer: ReturnType<typeof setInterval>;
  tickCount: number;
  subscribers: Map<WebSocket, WsSubscriber>;
}

// ── Module state ───────────────────────────────────────────────────

const sessionPolls = new Map<string, SessionPoll>();

/** Reset all internal state (for testing). */
export function _resetForTesting(): void {
  for (const poll of sessionPolls.values()) {
    clearInterval(poll.timer);
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

        let token: string | undefined;
        const header = req.headers.authorization;
        if (header?.startsWith('Bearer ')) {
          token = header.slice(7);
        } else {
          token = (req.query as Record<string, string>).token;
        }

        if (!token) {
          return reply.status(401).send({ error: 'Unauthorized — Bearer token or ?token= required' });
        }

        const result = auth.validate(token);
        if (!result.valid) {
          return reply.status(401).send({ error: 'Unauthorized — invalid API key' });
        }
        if (result.rateLimited) {
          return reply.status(429).send({ error: 'Rate limit exceeded' });
        }
      },
    },
    (socket, req) => {
      const sessionId = req.params.id;
      const session = sessions.getSession(sessionId);

      if (!session) {
        sendError(socket, 'Session not found');
        socket.close();
        return;
      }

      // Create subscriber
      const subscriber: WsSubscriber = {
        lastContent: '',
        lastStatus: '',
        closed: false,
        lastPongAt: Date.now(),
        messageTimestamps: [],
      };

      // Get or create shared session poll
      let poll = sessionPolls.get(sessionId);
      if (!poll) {
        poll = {
          timer: null as unknown as ReturnType<typeof setInterval>,
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

      // Handle pong responses for keep-alive
      socket.on('pong', () => {
        const sub = poll?.subscribers.get(socket);
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

        try {
          const msg: WsInboundMessage = JSON.parse(data.toString());

          if (msg.type === 'input' && typeof msg.text === 'string') {
            await sessions.sendMessage(sessionId, msg.text);
          } else if (msg.type === 'resize') {
            const cols = clamp(typeof msg.cols === 'number' ? msg.cols : 80, 1, 1000, 80);
            const rows = clamp(typeof msg.rows === 'number' ? msg.rows : 24, 1, 1000, 24);
            await tmux.resizePane(session.windowId, cols, rows);
          } else {
            sendError(socket, `Unknown message type: ${(msg as { type: string }).type}`);
          }
        } catch (e) {
          sendError(socket, `Invalid message: ${(e as Error).message}`);
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
    // Session gone — evict all subscribers
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
  } catch {
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
    if (sub.closed) continue;

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
      } catch {
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

  const poll = sessionPolls.get(sessionId);
  if (poll) {
    poll.subscribers.delete(socket);

    // If no more subscribers, clean up the poll timer
    if (poll.subscribers.size === 0) {
      clearInterval(poll.timer);
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
