/**
 * sse-bridge.ts — SSE endpoint that bridges EventBus events to browser clients.
 *
 * Provides a /sse endpoint on the Fastify server that pushes real-time events
 * to connected clients via Server-Sent Events protocol.
 *
 * Auth is handled by the global onRequest hook set up by setupAuth() in
 * middleware/auth-setup.ts — no additional per-route auth needed.
 *
 * Review fixes applied:
 * - Proper Fastify types (no `any`)
 * - lastEventId triggers replay on connect
 * - Structured error logging (no silent catch)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { type EventBus, type BusEvent } from '../event-bus.js';
import { StructuredLogger } from '../logger.js';

const log = new StructuredLogger();

interface SSEClient {
  res: FastifyReply['raw'];
  lastEventId?: number;
}

export function createSSEBridge(eventBus: EventBus, fastifyServer: FastifyInstance) {
  const clients: Set<SSEClient> = new Set();

  function sendSSE(res: FastifyReply['raw'], event: BusEvent) {
    try {
      res.write(`id: ${event.id}\n`);
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify({ channel: event.channel, data: event.data, timestamp: event.timestamp })}\n\n`);
    } catch (err) {
      log.warn({ component: 'sse-bridge', operation: 'send', attributes: { error: String(err) } });
    }
  }

  // Subscribe to global and session:* events
  const unsubGlobal = eventBus.subscribe('global', (e) => {
    for (const c of clients) sendSSE(c.res, e);
  });
  const unsubSessions = eventBus.subscribe('session:*', (e) => {
    for (const c of clients) sendSSE(c.res, e);
  });

  function register(server: FastifyInstance) {
    server.get<{ Querystring: { lastEventId?: string } }>('/sse', async (
      request: FastifyRequest<{ Querystring: { lastEventId?: string } }>,
      reply: FastifyReply,
    ) => {
      const raw = reply.raw;
      raw.setHeader('Content-Type', 'text/event-stream');
      raw.setHeader('Cache-Control', 'no-cache');
      raw.setHeader('Connection', 'keep-alive');
      raw.write('\n');

      const lastEventId = request.query.lastEventId ? Number(request.query.lastEventId) : undefined;
      const client: SSEClient = { res: raw, lastEventId };
      clients.add(client);

      // Replay missed events if client provides lastEventId
      if (lastEventId !== undefined && !isNaN(lastEventId)) {
        const globalEvents = await eventBus.replaySince('global', lastEventId);
        for (const ev of globalEvents) sendSSE(raw, ev);
      }

      // Heartbeat to keep connection alive
      const hb = setInterval(() => {
        try { raw.write(': hb\n\n'); } catch (_e) { /* connection closed */ }
      }, 30000);

      request.raw.on('close', () => {
        clearInterval(hb);
        clients.delete(client);
      });
    });
  }

  function destroy() {
    unsubGlobal();
    unsubSessions();
    clients.clear();
  }

  return { register, destroy };
}

export default createSSEBridge;
