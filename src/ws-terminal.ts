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
 */

import type { FastifyInstance } from 'fastify';
import type { SessionManager } from './session.js';
import type { TmuxManager } from './tmux.js';
import type WebSocket from 'ws';

const POLL_INTERVAL_MS = 500;

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

export function registerWsTerminalRoute(
  app: FastifyInstance,
  sessions: SessionManager,
  tmux: TmuxManager,
): void {
  app.get<{ Params: { id: string } }>('/v1/sessions/:id/terminal', { websocket: true }, (socket, req) => {
    const sessionId = req.params.id;
    const session = sessions.getSession(sessionId);

    if (!session) {
      sendError(socket, 'Session not found');
      socket.close();
      return;
    }

    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let lastContent = '';
    let lastStatus = '';
    let closed = false;

    // Start polling pane content
    pollTimer = setInterval(async () => {
      if (closed) return;
      try {
        const content = await tmux.capturePane(session.windowId);
        if (content !== lastContent) {
          lastContent = content;
          send(socket, { type: 'pane', content });
        }

        // Also emit status changes
        const currentStatus = session.status;
        if (currentStatus !== lastStatus) {
          lastStatus = currentStatus;
          send(socket, { type: 'status', status: currentStatus });
        }
      } catch {
        // Session may have been killed
        if (!closed) {
          sendError(socket, 'Failed to capture pane — session may have ended');
          close();
        }
      }
    }, POLL_INTERVAL_MS);

    // Handle incoming messages
    socket.on('message', async (data: Buffer | string) => {
      if (closed) return;
      try {
        const msg: WsInboundMessage = JSON.parse(data.toString());

        if (msg.type === 'input' && typeof msg.text === 'string') {
          await sessions.sendMessage(sessionId, msg.text);
        } else if (msg.type === 'resize') {
          const cols = typeof msg.cols === 'number' ? msg.cols : 80;
          const rows = typeof msg.rows === 'number' ? msg.rows : 24;
          await tmux.resizePane(session.windowId, cols, rows);
        } else {
          sendError(socket, `Unknown message type: ${(msg as { type: string }).type}`);
        }
      } catch (e) {
        sendError(socket, `Invalid message: ${(e as Error).message}`);
      }
    });

    socket.on('close', close);

    function close(): void {
      if (closed) return;
      closed = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }
  });
}

function send(ws: WebSocket, msg: WsOutboundMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendError(ws: WebSocket, message: string): void {
  send(ws, { type: 'error', message });
}
