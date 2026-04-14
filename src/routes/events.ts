/**
 * routes/events.ts — Global SSE event stream.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SSEWriter } from '../sse-writer.js';
import type { GlobalSSEEvent } from '../events.js';
import type { RouteContext } from './context.js';
import { registerWithLegacy } from './context.js';

export function registerEventRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { sessions, eventBus, sseLimiter } = ctx;

  // Global SSE event stream — aggregates events from ALL active sessions
  registerWithLegacy(app, 'get', '/v1/events', async (req: FastifyRequest, reply: FastifyReply) => {
    const clientIp = req.ip;
    const acquireResult = sseLimiter.acquire(clientIp);
    if (!acquireResult.allowed) {
      const status = acquireResult.reason === 'per_ip_limit' ? 429 : 503;
      return reply.status(status).send({
        error: acquireResult.reason === 'per_ip_limit'
          ? `Per-IP connection limit reached (${acquireResult.current}/${acquireResult.limit})`
          : `Global connection limit reached (${acquireResult.current}/${acquireResult.limit})`,
        reason: acquireResult.reason,
      });
    }

    let unsubscribe: (() => void) | undefined;
    const connectionId = acquireResult.connectionId;
    let writer: SSEWriter;

    const pendingEvents: GlobalSSEEvent[] = [];
    let subscriptionReady = false;

    const handler = (event: GlobalSSEEvent): void => {
      if (!subscriptionReady) { pendingEvents.push(event); return; }
      const id = event.id != null ? `id: ${event.id}\n` : '';
      writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      unsubscribe = eventBus.subscribeGlobal(handler);
    } catch (err) {
      req.log.error({ err }, 'Global SSE subscription failed');
      sseLimiter.release(connectionId);
      return reply.status(500).send({ error: 'Failed to create SSE subscription' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    writer = new SSEWriter(reply.raw, req.raw, () => {
      unsubscribe?.();
      sseLimiter.release(connectionId);
    });

    subscriptionReady = true;
    for (const event of pendingEvents) {
      const id = event.id != null ? `id: ${event.id}\n` : '';
      writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
    }

    writer.write(`data: ${JSON.stringify({
      event: 'connected',
      timestamp: new Date().toISOString(),
      data: { activeSessions: sessions.listSessions().length },
    })}\n\n`);

    // Issue #301: Replay missed global events if client sends Last-Event-ID
    const lastEventId = req.headers['last-event-id'];
    if (lastEventId) {
      const missed = eventBus.getGlobalEventsSince(parseInt(lastEventId as string, 10) || 0);
      for (const { id, event: globalEvent } of missed) {
        writer.write(`id: ${id}\ndata: ${JSON.stringify(globalEvent)}\n\n`);
      }
    }

    writer.startHeartbeat(30_000, 90_000, () =>
      `data: ${JSON.stringify({ event: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`
    );

    await reply;
  });
}
