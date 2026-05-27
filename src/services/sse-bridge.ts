import { type EventBus, type BusEvent } from '../event-bus.js';

export function createSSEBridge(eventBus: EventBus, fastifyServer: any) {
  const clients: Set<{ res: any; lastEventId?: number }> = new Set();

  function sendSSE(res: any, event: BusEvent) {
    try {
      res.write(`id: ${event.id}\n`);
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify({ channel: event.channel, data: event.data, timestamp: event.timestamp })}\n\n`);
    } catch (e) {
      // ignore
    }
  }

  // subscribe to global and session:*
  const unsubGlobal = eventBus.subscribe('global', (e) => {
    for (const c of clients) sendSSE(c.res, e);
  });
  const unsubSessions = eventBus.subscribe('session:*', (e) => {
    for (const c of clients) sendSSE(c.res, e);
  });

  function register(server: any) {
    server.get('/sse', async (req: any, reply: any) => {
      const raw = reply.raw;
      raw.setHeader('Content-Type', 'text/event-stream');
      raw.setHeader('Cache-Control', 'no-cache');
      raw.setHeader('Connection', 'keep-alive');
      raw.write('\n');
      const client = { res: raw, lastEventId: req.query?.lastEventId ? Number(req.query.lastEventId) : undefined };
      clients.add(client);

      // heartbeat
      const hb = setInterval(() => {
        try { raw.write(': hb\n\n'); } catch (e) {}
      }, 30000);

      req.raw.on('close', () => {
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
