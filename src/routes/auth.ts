/**
 * routes/auth.ts — Auth verify, API key CRUD, SSE token, quota management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authKeySchema } from '../validation.js';
import { SYSTEM_TENANT } from '../config.js';
import { filterByTenant } from '../utils/tenant-filter.js';
import { type RouteContext, requireRole, registerWithLegacy, withValidation } from './context.js';
import { appendSetCookie, buildCookie } from './oidc-auth.js';

/** Check if the request was made over HTTPS (or a trusted proxy forwarded it). */
function isSecureRequest(req: FastifyRequest): boolean {
  const proto = req.headers['x-forwarded-proto'];
  if (proto) return proto === 'https';
  return req.protocol === 'https';
}
import { DASHBOARD_SESSION_COOKIE, DASHBOARD_SESSION_TTL_MS } from '../services/auth/OIDCManager.js';

const setQuotasSchema = z.object({
  maxConcurrentSessions: z.number().int().positive().nullable().optional(),
  maxTokensPerWindow: z.number().int().positive().nullable().optional(),
  maxSpendPerWindow: z.number().positive().nullable().optional(),
  quotaWindowMs: z.number().int().positive().optional(),
}).strict();

export function registerAuthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { auth, quotas, sessions } = ctx;

  const verifyTokenSchema = z.object({
    token: z.string().min(1),
  }).strict();

  const rotateKeySchema = z.object({
    ttlDays: z.number().int().positive().optional(),
  }).strict();

  // Issue #2097: Rotate API key with grace period
  const rotateWithGraceSchema = z.object({
    keyId: z.string().min(1),
    gracePeriodSeconds: z.number().int().min(0).max(86400).optional(),
    ttlDays: z.number().int().positive().optional(),
  }).strict();

  // Auth verify — public bootstrap endpoint for dashboard login
  registerWithLegacy(app, 'post', '/v1/auth/verify', withValidation(verifyTokenSchema, async (req: FastifyRequest, reply: FastifyReply, data) => {
    const clientIp = req.ip ?? 'unknown';
    if (!auth.authEnabled) {
      const role = 'admin';
      const session = ctx.dashboardTokenSessions?.create({
        userId: `local-dashboard:${clientIp}`,
        tenantId: SYSTEM_TENANT,
        role,
        permissions: auth.getPermissions(null),
        claims: { authMethod: 'token', keyId: null },
      });
      if (session) {
        appendSetCookie(reply, buildCookie(DASHBOARD_SESSION_COOKIE, session.sessionId, DASHBOARD_SESSION_TTL_MS / 1000, 'Strict', isSecureRequest(req)));
      }
      return { valid: true, role };
    }

    const result = auth.validate(data.token);
    if (result.rateLimited) {
      return reply.status(429).send({ valid: false });
    }
    if (!result.valid) {
      return reply.status(401).send({ valid: false });
    }

    const role = auth.getRole(result.keyId);
    const session = ctx.dashboardTokenSessions?.create({
      userId: result.keyId ? `api-key:${result.keyId}` : `local-dashboard:${clientIp}`,
      tenantId: result.tenantId ?? SYSTEM_TENANT,
      role,
      permissions: auth.getPermissions(result.keyId),
      claims: { authMethod: 'token', keyId: result.keyId },
    });
    if (session) {
      appendSetCookie(reply, buildCookie(DASHBOARD_SESSION_COOKIE, session.sessionId, DASHBOARD_SESSION_TTL_MS / 1000, 'Strict', isSecureRequest(req)));
    }
    return { valid: true, role };
  }));

  registerWithLegacy(app, 'post', '/v1/auth/keys', withValidation(authKeySchema, async (req: FastifyRequest, reply: FastifyReply, data) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!requireRole(auth, req, reply, 'admin')) return;
    const { name, rateLimit, ttlDays, role = 'viewer', permissions, tenantId } = data;
    const result = await auth.createKey(name, rateLimit, ttlDays, role, permissions, tenantId);
    return reply.status(201).send(result);
  }));

  registerWithLegacy(app, 'get', '/v1/auth/keys', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!requireRole(auth, req, reply, 'admin')) return;
    return filterByTenant(auth.listKeys(), req.tenantId);
  });

  registerWithLegacy(app, 'delete', '/v1/auth/keys/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!requireRole(auth, req, reply, 'admin')) return;
    const key = auth.getKey(req.params.id);
    if (!key) return reply.status(404).send({ error: 'Key not found' });
    if (req.tenantId !== SYSTEM_TENANT && key.tenantId !== req.tenantId) {
      return reply.status(404).send({ error: 'Key not found' });
    }
    const revoked = await auth.revokeKey(req.params.id);
    if (!revoked) return reply.status(404).send({ error: 'Key not found' });
    return { ok: true };
  });

  // Issue #1403: Rotate API key
  registerWithLegacy(app, 'post', '/v1/auth/keys/:id/rotate', withValidation(rotateKeySchema, async (req: FastifyRequest, reply: FastifyReply, data) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!requireRole(auth, req, reply, 'admin')) return;
    const keyId = (req.params as { id: string }).id;
    const existing = auth.getKey(keyId);
    if (!existing) return reply.status(404).send({ error: 'Key not found' });
    if (req.tenantId !== SYSTEM_TENANT && existing.tenantId !== req.tenantId) {
      return reply.status(404).send({ error: 'Key not found' });
    }
    const rotated = await auth.rotateKey(keyId, data.ttlDays);
    if (!rotated) return reply.status(404).send({ error: 'Key not found' });
    return reply.status(200).send(rotated);
  }));

  // Issue #2097: Rotate API key with grace period — both old and new keys work during overlap
  registerWithLegacy(app, 'post', '/v1/auth/keys/rotate', withValidation(rotateWithGraceSchema, async (req: FastifyRequest, reply: FastifyReply, data) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!requireRole(auth, req, reply, 'admin')) return;
    const existing = auth.getKey(data.keyId);
    if (!existing) return reply.status(404).send({ error: 'Key not found' });
    if (req.tenantId !== SYSTEM_TENANT && existing.tenantId !== req.tenantId) {
      return reply.status(404).send({ error: 'Key not found' });
    }
    const graceSeconds = data.gracePeriodSeconds ?? ctx.config.keyRotationGraceSeconds;
    const rotated = await auth.rotateKeyWithGrace(data.keyId, graceSeconds, data.ttlDays);
    if (!rotated) return reply.status(404).send({ error: 'Key not found' });
    return reply.status(200).send(rotated);
  }));

  // Issue #1953: Get quota config and usage for a key
  registerWithLegacy(app, 'get', '/v1/auth/keys/:id/quotas', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!requireRole(auth, req, reply, 'admin')) return;
    const key = auth.getKey(req.params.id);
    if (!key) return reply.status(404).send({ error: 'Key not found' });
    if (req.tenantId !== SYSTEM_TENANT && key.tenantId !== req.tenantId) {
      return reply.status(404).send({ error: 'Key not found' });
    }
    const ownedSessions = sessions.listSessions().filter(s => s.ownerKeyId === key.id);
    return {
      quotas: key.quotas ?? null,
      usage: quotas.getUsage(key, ownedSessions.length),
    };
  });

  // Issue #1953: Set quotas for a key
  registerWithLegacy(app, 'put', '/v1/auth/keys/:id/quotas', withValidation(setQuotasSchema, async (req: FastifyRequest, reply: FastifyReply, data) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!requireRole(auth, req, reply, 'admin')) return;
    const keyId = (req.params as { id: string }).id;
    const existing = auth.getKey(keyId);
    if (!existing) return reply.status(404).send({ error: 'Key not found' });
    if (req.tenantId !== SYSTEM_TENANT && existing.tenantId !== req.tenantId) {
      return reply.status(404).send({ error: 'Key not found' });
    }

    const currentQuotas = existing.quotas ?? {
      maxConcurrentSessions: null,
      maxTokensPerWindow: null,
      maxSpendPerWindow: null,
      quotaWindowMs: 3_600_000,
    };
    const newQuotas = {
      maxConcurrentSessions: data.maxConcurrentSessions ?? currentQuotas.maxConcurrentSessions,
      maxTokensPerWindow: data.maxTokensPerWindow ?? currentQuotas.maxTokensPerWindow,
      maxSpendPerWindow: data.maxSpendPerWindow ?? currentQuotas.maxSpendPerWindow,
      quotaWindowMs: data.quotaWindowMs ?? currentQuotas.quotaWindowMs,
    };
    const updated = await auth.setQuotas(keyId, newQuotas);
    return reply.status(200).send(updated);
  }));

  // ── /v1/keys — convenience aliases for /v1/auth/keys (#2528) ──────

  registerWithLegacy(app, 'get', '/v1/keys', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!requireRole(auth, req, reply, 'admin')) return;
    return filterByTenant(auth.listKeys(), req.tenantId);
  });

  registerWithLegacy(app, 'post', '/v1/keys', withValidation(authKeySchema, async (req: FastifyRequest, reply: FastifyReply, data) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!requireRole(auth, req, reply, 'admin')) return;
    const { name, rateLimit, ttlDays, role = 'viewer', permissions, tenantId } = data;
    const result = await auth.createKey(name, rateLimit, ttlDays, role, permissions, tenantId);
    return reply.status(201).send(result);
  }));

  registerWithLegacy(app, 'delete', '/v1/keys/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (!requireRole(auth, req, reply, 'admin')) return;
    const key = auth.getKey(req.params.id);
    if (!key) return reply.status(404).send({ error: 'Key not found' });
    if (req.tenantId !== SYSTEM_TENANT && key.tenantId !== req.tenantId) {
      return reply.status(404).send({ error: 'Key not found' });
    }
    const revoked = await auth.revokeKey(req.params.id);
    if (!revoked) return reply.status(404).send({ error: 'Key not found' });
    return { ok: true };
  });

  // #297: SSE token endpoint
  registerWithLegacy(app, 'post', '/v1/auth/sse-token', async (req: FastifyRequest, reply: FastifyReply) => {
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
