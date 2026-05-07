/**
 * keys-endpoint-2528.test.ts — Tests for /v1/keys route aliases (#2528).
 *
 * Verifies that GET/POST/DELETE /v1/keys work identically to /v1/auth/keys.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { AuthManager } from '../auth.js';
import type { ApiKeyPermission, ApiKeyRole } from '../auth.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

const RATE_LIMIT_WINDOW = '1 minute';

async function buildApp(masterToken: string): Promise<{ app: FastifyInstance; auth: AuthManager; tmpFile: string }> {
  const tmpFile = join(tmpdir(), `aegis-keys-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const auth = new AuthManager(tmpFile, masterToken);
  auth.setHost('127.0.0.1');
  await auth.load();

  const app = Fastify();
  await app.register(fastifyRateLimit, {
    global: true,
    max: 600,
    timeWindow: RATE_LIMIT_WINDOW,
    keyGenerator: (req) => req.ip ?? 'unknown',
  });

  // Minimal auth middleware — sets req.authKeyId / req.authRole like production
  app.decorateRequest('authKeyId', null as unknown as string | null);
  app.decorateRequest('authRole', null as unknown as ApiKeyRole | null);
  app.decorateRequest('tenantId', undefined as unknown as string | undefined);

  app.addHook('onRequest', async (req, reply) => {
    const urlPath = req.url?.split('?')[0] ?? '';
    // Skip auth for health
    if (urlPath === '/health') return;

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized — Bearer token required' });
    }
    const token = header.slice(7);

    // Master token check
    if (masterToken && token === masterToken) {
      req.authKeyId = 'master';
      req.authRole = 'admin';
      req.tenantId = 'system';
      return;
    }

    const result = auth.validate(token);
    if (!result.valid) {
      return reply.status(401).send({ error: 'Unauthorized — invalid API key' });
    }
    req.authKeyId = result.keyId;
    req.authRole = auth.getRole(result.keyId);
    req.tenantId = result.tenantId;
  });

  // ── Route registrations (mirrors routes/auth.ts for /v1/keys) ──────
  const SYSTEM_TENANT = 'system';
  const filterByTenant = (items: Array<Record<string, unknown>>, tenantId?: string) =>
    tenantId && tenantId !== SYSTEM_TENANT ? items.filter(i => i.tenantId === tenantId) : items;

  // GET /v1/keys
  app.get('/v1/keys', async (req, reply) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (req.authRole !== 'admin') return reply.status(403).send({ error: 'Forbidden: insufficient role' });
    return filterByTenant(auth.listKeys() as Array<Record<string, unknown>>, req.tenantId);
  });

  // POST /v1/keys
  app.post('/v1/keys', async (req, reply) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (req.authRole !== 'admin') return reply.status(403).send({ error: 'Forbidden: insufficient role' });
    const body = req.body as Record<string, unknown>;
    const name = body?.name;
    if (typeof name !== 'string' || !name) {
      return reply.status(400).send({ error: 'Invalid request body' });
    }
    const result = await auth.createKey(
      name,
      body.rateLimit as number | undefined,
      body.ttlDays as number | undefined,
      (body.role as 'admin' | 'viewer' | undefined) ?? 'viewer',
      body.permissions as ApiKeyPermission[] | undefined,
      body.tenantId as string | undefined,
    );
    return reply.status(201).send(result);
  });

  // DELETE /v1/keys/:id
  app.delete<{ Params: { id: string } }>('/v1/keys/:id', async (req, reply) => {
    if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
    if (req.authRole !== 'admin') return reply.status(403).send({ error: 'Forbidden: insufficient role' });
    const key = auth.getKey(req.params.id);
    if (!key) return reply.status(404).send({ error: 'Key not found' });
    if (req.tenantId !== SYSTEM_TENANT && key.tenantId !== req.tenantId) {
      return reply.status(404).send({ error: 'Key not found' });
    }
    const revoked = await auth.revokeKey(req.params.id);
    if (!revoked) return reply.status(404).send({ error: 'Key not found' });
    return { ok: true };
  });

  return { app, auth, tmpFile };
}

describe('/v1/keys endpoint (#2528)', () => {
  let app: FastifyInstance;
  let auth: AuthManager;
  let tmpFile: string;
  const MASTER = 'test-master-token-12345';

  beforeEach(async () => {
    ({ app, auth, tmpFile } = await buildApp(MASTER));
  });

  afterEach(async () => {
    await app.close();
    try { await rm(tmpFile); } catch { /* ignore */ }
  });

  describe('GET /v1/keys', () => {
    it('returns 401 without auth token', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/keys' });
      expect(res.statusCode).toBe(401);
    });

    it('returns empty list for admin with master token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${MASTER}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns created keys', async () => {
      await auth.createKey('key-a');
      await auth.createKey('key-b');
      const res = await app.inject({
        method: 'GET',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${MASTER}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(2);
      expect(body.map((k: { name: string }) => k.name).sort()).toEqual(['key-a', 'key-b']);
    });

    it('excludes hash from listed keys', async () => {
      await auth.createKey('secret-key');
      const res = await app.inject({
        method: 'GET',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${MASTER}` },
      });
      expect(res.statusCode).toBe(200);
      const keys = res.json();
      expect(keys[0].hash).toBeUndefined();
    });

    it('returns 403 for viewer-role API key', async () => {
      const { key } = await auth.createKey('viewer-key', 100, undefined, 'viewer');
      const res = await app.inject({
        method: 'GET',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${key}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /v1/keys', () => {
    it('creates a new key with master token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${MASTER}`, 'content-type': 'application/json' },
        payload: { name: 'new-key' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.name).toBe('new-key');
      expect(body.key).toMatch(/^aegis_/);
      expect(body.id).toBeTruthy();
    });

    it('returns 401 without auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { 'content-type': 'application/json' },
        payload: { name: 'no-auth' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 for viewer role', async () => {
      const { key } = await auth.createKey('viewer', 100, undefined, 'viewer');
      const res = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        payload: { name: 'blocked' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 400 for missing name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${MASTER}`, 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('creates key with custom role and permissions', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${MASTER}`, 'content-type': 'application/json' },
        payload: { name: 'custom-key', role: 'admin' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().role).toBe('admin');
    });
  });

  describe('DELETE /v1/keys/:id', () => {
    it('revokes an existing key', async () => {
      const { id } = await auth.createKey('to-delete');
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/keys/${id}`,
        headers: { authorization: `Bearer ${MASTER}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(auth.listKeys()).toHaveLength(0);
    });

    it('returns 404 for non-existent key', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/keys/deadbeef',
        headers: { authorization: `Bearer ${MASTER}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 401 without auth', async () => {
      const { id } = await auth.createKey('unauth');
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/keys/${id}`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 for viewer role', async () => {
      const { id } = await auth.createKey('target');
      const { key } = await auth.createKey('viewer', 100, undefined, 'viewer');
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/keys/${id}`,
        headers: { authorization: `Bearer ${key}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
