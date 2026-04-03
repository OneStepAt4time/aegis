import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MemoryBridge } from './memory-bridge.js';
import { z } from 'zod';

const setMemorySchema = z.object({
  key: z.string().max(256),
  value: z.string().max(100 * 1024),
  ttlSeconds: z.number().int().positive().max(86400 * 30).optional(),
}).strict();

const getMemorySchema = z.object({
  prefix: z.string().optional(),
});

export function registerMemoryRoutes(app: FastifyInstance, bridge: MemoryBridge): void {
  // POST /v1/memory — write a memory entry
  app.post('/v1/memory', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = setMemorySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }
    const { key, value, ttlSeconds } = parsed.data;
    try {
      const entry = bridge.set(key, value, ttlSeconds);
      return { ok: true, entry };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Invalid key format')) return reply.status(400).send({ error: msg });
      if (msg.includes('exceeds maximum size')) return reply.status(413).send({ error: msg });
      throw e;
    }
  });

  // GET /v1/memory/:key — read a memory entry
  app.get('/v1/memory/:key', async (req: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) => {
    const key = decodeURIComponent(req.params.key);
    const entry = bridge.get(key);
    if (!entry) return reply.status(404).send({ error: `Key not found: ${key}` });
    return { entry };
  });

  // GET /v1/memory — list entries, optionally filtered by prefix
  app.get('/v1/memory', async (req: FastifyRequest<{ Querystring: { prefix?: string } }>, reply: FastifyReply) => {
    const { prefix } = req.query;
    const entries = bridge.list(prefix);
    return { entries };
  });

  // DELETE /v1/memory/:key — delete a memory entry
  app.delete('/v1/memory/:key', async (req: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) => {
    const key = decodeURIComponent(req.params.key);
    const deleted = bridge.delete(key);
    if (!deleted) return reply.status(404).send({ error: `Key not found: ${key}` });
    return { ok: true };
  });
}
