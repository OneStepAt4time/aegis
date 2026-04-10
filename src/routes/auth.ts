/**
 * auth.ts — Authentication and API key management routes.
 *
 * Registers the following endpoints:
 * - POST /v1/auth/verify          — token verification (public bootstrap endpoint)
 * - POST /v1/auth/keys            — create API key (admin only)
 * - GET  /v1/auth/keys            — list API keys (admin only)
 * - DELETE /v1/auth/keys/:id      — revoke API key (admin only)
 * - POST /v1/auth/keys/:id/rotate — rotate API key (admin only, Issue #1403)
 * - POST /v1/auth/sse-token       — generate short-lived SSE token
 */

import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './route-deps.js';
import { z } from 'zod';
import { authKeySchema } from '../validation.js';
import { checkAuthFailRateLimit, recordAuthFailure } from '../rate-limit.js';

const verifyTokenSchema = z.object({
  token: z.string().min(1),
}).strict();

const rotateKeySchema = z.object({
  ttlDays: z.number().int().positive().optional(),
}).strict();

export function registerAuthRoutes(app: FastifyInstance, deps: RouteDeps): void {
  // ── Token verification (public bootstrap endpoint) ─────────────────────

  app.post('/v1/auth/verify', async (req, reply) => {
    const parsed = verifyTokenSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }

    if (!deps.auth.authEnabled) {
      return { valid: true, role: 'admin' };
    }

    const clientIp = req.ip ?? 'unknown';
    if (checkAuthFailRateLimit(clientIp)) {
      return reply.status(429).send({ valid: false });
    }

    const result = deps.auth.validate(parsed.data.token);
    if (result.rateLimited) {
      return reply.status(429).send({ valid: false });
    }
    if (!result.valid) {
      recordAuthFailure(clientIp);
      return reply.status(401).send({ valid: false });
    }

    return { valid: true, role: deps.auth.getRole(result.keyId) };
  });

  // ── API key management (Issue #39) ─────────────────────────────────────

  app.post('/v1/auth/keys', async (req, reply) => {
    if (!deps.auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!deps.requireRole(req, reply, 'admin')) return;
    const parsed = authKeySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const { name, rateLimit, ttlDays, role = 'viewer' } = parsed.data;
    const result = await deps.auth.createKey(name, rateLimit, ttlDays, role);
    return reply.status(201).send(result);
  });

  app.get('/v1/auth/keys', async (req, reply) => {
    if (!deps.auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!deps.requireRole(req, reply, 'admin')) return;
    return deps.auth.listKeys();
  });

  app.delete<{ Params: { id: string } }>('/v1/auth/keys/:id', async (req, reply) => {
    if (!deps.auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!deps.requireRole(req, reply, 'admin')) return;
    const revoked = await deps.auth.revokeKey(req.params.id);
    if (!revoked) return reply.status(404).send({ error: 'Key not found' });
    return { ok: true };
  });

  // ── Key rotation (Issue #1403) ────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/v1/auth/keys/:id/rotate', async (req, reply) => {
    if (!deps.auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!deps.requireRole(req, reply, 'admin')) return;
    const parsed = rotateKeySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const rotated = await deps.auth.rotateKey(req.params.id, parsed.data.ttlDays);
    if (!rotated) return reply.status(404).send({ error: 'Key not found' });
    return reply.status(200).send(rotated);
  });

  // ── SSE token generation (Issue #297) ─────────────────────────────────

  app.post('/v1/auth/sse-token', async (req, reply) => {
    const storedKeyId = req.authKeyId;
    const keyId = (typeof storedKeyId === 'string' ? storedKeyId : 'anonymous');

    try {
      const sseToken = await deps.auth.generateSSEToken(keyId);
      return reply.status(201).send(sseToken);
    } catch (e: unknown) {
      return reply.status(429).send({ error: e instanceof Error ? e.message : 'SSE token limit reached' });
    }
  });
}
