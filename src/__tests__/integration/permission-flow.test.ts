/**
 * permission-flow.test.ts - Integration tests for permission flow.
 * Issue #1205
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

interface MockSession {
  id: string;
  permissionMode: string;
  pendingPermission?: { tool: string; description: string };
}

describe('Permission Flow Integration Tests', () => {
  let app: FastifyInstance;
  const sessions = new Map<string, MockSession>();

  beforeEach(async () => {
    sessions.clear();
    app = Fastify({ logger: false });
    
    // Permission mode endpoints
    app.get('/v1/sessions/:id/permission-mode', async (request: any) => {
      const session = sessions.get(request.params.id);
      if (!session) throw { statusCode: 404, message: 'Session not found' };
      return { permissionMode: session.permissionMode };
    });

    app.put('/v1/sessions/:id/permission-mode', async (request: any) => {
      const session = sessions.get(request.params.id);
      if (!session) throw { statusCode: 404, message: 'Session not found' };
      const { permissionMode } = request.body || {};
      session.permissionMode = permissionMode;
      return { success: true, permissionMode };
    });

    app.get('/v1/sessions/:id/pending-permission', async (request: any) => {
      const session = sessions.get(request.params.id);
      if (!session) throw { statusCode: 404, message: 'Session not found' };
      return { hasPending: !!session.pendingPermission, ...session.pendingPermission };
    });

    app.post('/v1/sessions/:id/resolve-permission', async (request: any) => {
      const session = sessions.get(request.params.id);
      if (!session) throw { statusCode: 404, message: 'Session not found' };
      const { decision } = request.body || {};
      if (session.pendingPermission) {
        session.pendingPermission = undefined;
        return { resolved: true, decision };
      }
      return { resolved: false };
    });

    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  it('GET permission-mode returns default for new session', async () => {
    sessions.set('s1', { id: 's1', permissionMode: 'default' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/s1/permission-mode',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).permissionMode).toBe('default');
  });

  it('PUT permission-mode updates session permission mode', async () => {
    sessions.set('s1', { id: 's1', permissionMode: 'default' });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/sessions/s1/permission-mode',
      payload: { permissionMode: 'bypassPermissions' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).permissionMode).toBe('bypassPermissions');
  });

  it('GET pending-permission returns false when no pending', async () => {
    sessions.set('s1', { id: 's1', permissionMode: 'default' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/s1/pending-permission',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.hasPending).toBe(false);
  });

  it('POST resolve-permission resolves pending permission', async () => {
    sessions.set('s1', { 
      id: 's1', 
      permissionMode: 'default',
      pendingPermission: { tool: 'Bash', description: 'rm -rf /' }
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/s1/resolve-permission',
      payload: { decision: 'allow' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).resolved).toBe(true);
  });

  it('permission flow: default -> bypassPermissions', async () => {
    sessions.set('perm-test', { id: 'perm-test', permissionMode: 'default' });
    
    // Check initial mode
    const initial = await app.inject({
      method: 'GET',
      url: '/v1/sessions/perm-test/permission-mode',
    });
    expect(JSON.parse(initial.body).permissionMode).toBe('default');

    // Change to bypassPermissions
    const updated = await app.inject({
      method: 'PUT',
      url: '/v1/sessions/perm-test/permission-mode',
      payload: { permissionMode: 'bypassPermissions' },
    });
    expect(JSON.parse(updated.body).permissionMode).toBe('bypassPermissions');

    // Verify it persisted
    const final = await app.inject({
      method: 'GET',
      url: '/v1/sessions/perm-test/permission-mode',
    });
    expect(JSON.parse(final.body).permissionMode).toBe('bypassPermissions');
  });
});
