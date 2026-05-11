/**
 * routes-patch-key-3207.test.ts - Route-level tests for PATCH /v1/auth/keys/:id (#3207)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { AuthManager } from '../auth.js';
import { updateKeySchema } from '../validation.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

const RATE_LIMIT_WINDOW = '1 minute';
const MASTER = 'test-master-token-patch-3207';

describe('PATCH /v1/auth/keys/:id route (#3207)', () => {
  let app: FastifyInstance;
  let auth: AuthManager;
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `aegis-patch-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    auth = new AuthManager(tmpFile, MASTER);
    auth.setHost('127.0.0.1');
    await auth.load();

    app = Fastify();
    await app.register(fastifyRateLimit, {
      global: true,
      max: 600,
      timeWindow: RATE_LIMIT_WINDOW,
      keyGenerator: (req) => req.ip ?? 'unknown',
    });

    app.decorateRequest('authKeyId', null as unknown as string | null);
    app.decorateRequest('authRole', null as unknown as import('../auth.js').ApiKeyRole | null);
    app.decorateRequest('tenantId', undefined as unknown as string | undefined);

    app.addHook('onRequest', async (req, reply) => {
      const urlPath = req.url?.split('?')[0] ?? '';
      if (urlPath === '/health') return;
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const token = header.slice(7);
      // Master token gets admin
      if (token === MASTER) {
        req.authKeyId = 'master';
        req.authRole = 'admin';
        req.tenantId = 'system';
        return;
      }
      const result = auth.validate(token);
      if (!result.valid) {
        return reply.status(401).send({ error: 'Invalid key' });
      }
      req.authKeyId = result.keyId;
      req.authRole = auth.getRole(result.keyId);
      req.tenantId = result.tenantId;
    });

    // PATCH /v1/auth/keys/:id - mirrors production route from auth.ts
    app.patch('/v1/auth/keys/:id', async (req, reply) => {
      if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
      if (req.authRole !== 'admin') return reply.status(403).send({ error: 'Forbidden: insufficient role' });
      const keyId = (req.params as { id: string }).id;
      const existing = auth.getKey(keyId);
      if (!existing) return reply.status(404).send({ error: 'Key not found' });

      const parseResult = updateKeySchema.safeParse(req.body);
      if (!parseResult.success) return reply.status(400).send({ error: 'Validation failed' });
      const data = parseResult.data;

      // Self-demotion guard
      if (data.role && data.role !== 'admin' && existing.role === 'admin') {
        if (req.authKeyId === keyId) {
          const adminCount = auth.listKeys().filter(k => k.role === 'admin').length;
          if (adminCount <= 1) {
            return reply.status(409).send({ error: 'Cannot demote the last admin key' });
          }
        }
      }

      // Name uniqueness
      if (data.name && data.name !== existing.name) {
        const nameExists = auth.listKeys().some(k => k.name === data.name && k.id !== keyId);
        if (nameExists) return reply.status(409).send({ error: 'Key name already in use' });
      }

      const updated = await auth.updateKey(keyId, data);
      if (!updated) return reply.status(404).send({ error: 'Key not found' });
      return reply.status(200).send(updated);
    });

    // GET /v1/auth/keys - for listing
    app.get('/v1/auth/keys', async (req, reply) => {
      if (!auth.authEnabled) return reply.status(403).send({ error: 'Auth is not enabled' });
      if (req.authRole !== 'admin') return reply.status(403).send({ error: 'Forbidden: insufficient role' });
      return auth.listKeys();
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(tmpFile, { force: true });
  });

  async function authed(token: string, method: string, url: string, body?: object) {
    const res = await app.inject({
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      url,
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  it('should update key role as admin', async () => {
    const newKey = await auth.createKey('patch-target', 100, undefined, 'viewer');
    const res = await authed(MASTER, 'PATCH', `/v1/auth/keys/${newKey!.id}`, { role: 'operator' });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('operator');
  });

  it('should return 404 for non-existent key', async () => {
    const res = await authed(MASTER, 'PATCH', '/v1/auth/keys/nonexistent', { role: 'admin' });
    expect(res.statusCode).toBe(404);
  });

  it('should update key name', async () => {
    const newKey = await auth.createKey('old-name', 100, undefined, 'viewer');
    const res = await authed(MASTER, 'PATCH', `/v1/auth/keys/${newKey!.id}`, { name: 'new-name' });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('new-name');
  });

  it('should reject duplicate name', async () => {
    await auth.createKey('unique-name', 100, undefined, 'viewer');
    const other = await auth.createKey('other-name', 100, undefined, 'viewer');
    const res = await authed(MASTER, 'PATCH', `/v1/auth/keys/${other!.id}`, { name: 'unique-name' });
    expect(res.statusCode).toBe(409);
  });

  it('should reject validation errors', async () => {
    const newKey = await auth.createKey('test-key', 100, undefined, 'viewer');
    const res = await authed(MASTER, 'PATCH', `/v1/auth/keys/${newKey!.id}`, { role: 'invalid-role' });
    expect(res.statusCode).toBe(400);
  });

  it('should allow updating permissions alongside role', async () => {
    const newKey = await auth.createKey('perm-key', 100, undefined, 'viewer');
    const res = await authed(MASTER, 'PATCH', `/v1/auth/keys/${newKey!.id}`, { role: 'operator', permissions: ['create'] });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('operator');
    expect(res.json().permissions).toEqual(['create']);
  });
});
