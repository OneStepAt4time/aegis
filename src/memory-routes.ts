import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MemoryBridge } from './memory-bridge.js';
import { isValidUUID } from './validation.js';
import { z } from 'zod';

const setMemorySchema = z.object({
  key: z.string().max(256),
  value: z.string().max(100 * 1024),
  ttlSeconds: z.number().int().positive().max(86400 * 30).optional(),
}).strict();

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
  app.get('/v1/memory', async (req: FastifyRequest<{ Querystring: { prefix?: string } }>, _reply: FastifyReply) => {
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

  // Issue #705: Scoped memory retrieval — GET /v1/memories?scope=project|user|team
  const VALID_SCOPES = new Set(['project', 'user', 'team']);

  app.get<{ Querystring: { scope?: string } }>('/v1/memories', async (req: FastifyRequest<{ Querystring: { scope?: string } }>, reply: FastifyReply) => {
    const { scope } = req.query;
    if (!scope || !VALID_SCOPES.has(scope)) {
      return reply.status(400).send({ error: 'scope must be one of: project, user, team' });
    }
    const entries = bridge.list(`${scope}/`);
    return { scope, entries };
  });

  // Issue #705: Session-linked memories — POST /v1/sessions/:id/memories
  const sessionMemoryWriteSchema = z.object({
    key: z.string().min(1).max(200),
    value: z.string().max(100 * 1024),
    ttlSeconds: z.number().int().positive().max(86400 * 30).optional(),
  }).strict();

  app.post<{ Params: { id: string } }>('/v1/sessions/:id/memories', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    if (!isValidUUID(id)) return reply.status(400).send({ error: 'Invalid session ID — must be a UUID' });
    const parsed = sessionMemoryWriteSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', details: parsed.error.issues });
    const { key, value, ttlSeconds } = parsed.data;
    const fullKey = `session:${id}/${key}`;
    try {
      const entry = bridge.set(fullKey, value, ttlSeconds);
      return { ok: true, entry };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Invalid key format')) return reply.status(400).send({ error: msg });
      if (msg.includes('exceeds maximum size')) return reply.status(413).send({ error: msg });
      throw e;
    }
  });

  // Issue #705: Session-linked memories — GET /v1/sessions/:id/memories
  app.get<{ Params: { id: string } }>('/v1/sessions/:id/memories', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    if (!isValidUUID(id)) return reply.status(400).send({ error: 'Invalid session ID — must be a UUID' });
    const entries = bridge.list(`session:${id}/`);
    return { sessionId: id, entries };
  });
}
