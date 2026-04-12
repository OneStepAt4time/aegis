/**
 * routes/auth.ts — Auth verify, API key CRUD, SSE token.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authKeySchema } from '../validation.js';
import { type RouteContext, requireRole } from './context.js';

export function registerAuthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { auth } = ctx;

  const verifyTokenSchema = z.object({
    token: z.string().min(1),
  }).strict();

  const rotateKeySchema = z.object({
    ttlDays: z.number().int().positive().optional(),
  }).strict();

  // Auth verify — public bootstrap endpoint for dashboard login
  app.post('/v1/auth/verify', async (req, reply) => {
    const parsed = verifyTokenSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }

    if (!auth.authEnabled) {
      return { valid: true, role: 'admin' };
    }

    const clientIp = req.ip ?? 'unknown';
    const result = auth.validate(parsed.data.token);
    if (result.rateLimited) {
      return reply.status(429).send({ valid: false });
    }
    if (!result.valid) {
      return reply.status(401).send({ valid: false });
    }

    return { valid: true, role: auth.getRole(result.keyId) };
  });

  app.post('/v1/auth/keys', async (req, reply) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!requireRole(auth, req, reply, 'admin')) return;
    const parsed = authKeySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const { name, rateLimit, ttlDays, role = 'viewer' } = parsed.data;
    const result = await auth.createKey(name, rateLimit, ttlDays, role);
    return reply.status(201).send(result);
  });

  app.get('/v1/auth/keys', async (req, reply) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!requireRole(auth, req, reply, 'admin')) return;
    return auth.listKeys();
  });

  app.delete<{ Params: { id: string } }>('/v1/auth/keys/:id', async (req, reply) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!requireRole(auth, req, reply, 'admin')) return;
    const revoked = await auth.revokeKey(req.params.id);
    if (!revoked) return reply.status(404).send({ error: 'Key not found' });
    return { ok: true };
  });

  // Issue #1403: Rotate API key
  app.post<{ Params: { id: string } }>('/v1/auth/keys/:id/rotate', async (req, reply) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!requireRole(auth, req, reply, 'admin')) return;
    const parsed = rotateKeySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const rotated = await auth.rotateKey(req.params.id, parsed.data.ttlDays);
    if (!rotated) return reply.status(404).send({ error: 'Key not found' });
    return reply.status(200).send(rotated);
  });

  // #297: SSE token endpoint
  app.post('/v1/auth/sse-token', async (req, reply) => {
    const storedKeyId = req.authKeyId;
    const keyId = (typeof storedKeyId === 'string' ? storedKeyId : 'anonymous');
    try {
      const sseToken = await auth.generateSSEToken(keyId);
      return reply.status(201).send(sseToken);
    } catch (e: unknown) {
      return reply.status(429).send({ error: e instanceof Error ? e.message : 'SSE token limit reached' });
    }
  });
}
