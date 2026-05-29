/**
 * Tests for per-session metadata KV store (Issue #4484)
 *
 * Covers:
 * - POST /v1/sessions/:id/meta — set metadata
 * - GET /v1/sessions/:id/meta — get metadata
 * - DELETE /v1/sessions/:id/meta/:key — delete key
 * - Validation: max keys, max value length, empty key, key too long
 */

import Fastify from 'fastify';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { registerSessionRoutes } from '../routes/sessions.js';
import type { RouteContext } from '../routes/context.js';
import type { SessionInfo } from '../session.js';

const SESSION_ID = 'a0000000-meta-4000-8000-000000000000';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: SESSION_ID,
    displayName: 'meta-test',
    workDir: '/tmp/meta-test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  } as SessionInfo;
}

function buildApp(session: SessionInfo | null) {
  const sessions = {
    get: vi.fn(() => []),
    getSession: vi.fn((id: string) => (id === SESSION_ID && session ? session : undefined)),
    create: vi.fn(async () => makeSession()),
    update: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    kill: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    getHealth: vi.fn(async () => null),
    readMessagesFromSession: vi.fn(async () => ({ messages: [], status: 'idle', statusText: null, interactiveContent: null })),
    submitAnswer: vi.fn(() => true),
    getAll: vi.fn(() => session ? [session] : []),
  };

  const ctx: RouteContext = {
    auth: {
      authenticate: vi.fn(async (req) => ({ ok: true, keyId: 'master', tenantId: 'default' })),
      requireRole: vi.fn(() => true),
    },
    sessions,
    config: { requireApproval: false },
    getAuditLogger: vi.fn(() => null),
    eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    terminalBridge: undefined,
    acpBackend: undefined,
    promptManager: undefined,
    alertManager: undefined,
  } as unknown as RouteContext;

  const app = Fastify();
  registerSessionRoutes(app, ctx);
  return { app, sessions, ctx };
}

describe('Session metadata KV store', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let session: SessionInfo;

  beforeEach(async () => {
    session = makeSession();
    app = buildApp(session);
  });

  describe('POST /v1/sessions/:id/meta', () => {
    it('sets metadata on a session', async () => {
      const res = await app.app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/meta`,
        payload: { pr_number: '1234', author: 'boss' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().metadata).toEqual({ pr_number: '1234', author: 'boss' });
      expect(session.metadata).toEqual({ pr_number: '1234', author: 'boss' });
    });

    it('merges with existing metadata', async () => {
      session.metadata = { pr_number: '1234' };

      const res = await app.app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/meta`,
        payload: { status: 'in-review' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().metadata).toEqual({ pr_number: '1234', status: 'in-review' });
    });

    it('overwrites existing keys', async () => {
      session.metadata = { pr_number: '1234' };

      const res = await app.app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/meta`,
        payload: { pr_number: '5678' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().metadata).toEqual({ pr_number: '5678' });
    });

    it('rejects empty metadata', async () => {
      const res = await app.app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/meta`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('at least one key');
    });

    it('rejects value exceeding 256 characters', async () => {
      const res = await app.app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/meta`,
        payload: { key: 'x'.repeat(257) },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/256|Invalid/);
    });

    it('rejects when exceeding 20 keys total', async () => {
      const metadata: Record<string, string> = {};
      for (let i = 0; i < 20; i++) metadata[`key${i}`] = `val${i}`;
      session.metadata = metadata;

      const res = await app.app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/meta`,
        payload: { overflow: 'nope' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('20');
    });

    it('returns 404 for unknown session', async () => {
      const res = await app.app.inject({
        method: 'POST',
        url: '/v1/sessions/00000000-0000-0000-0000-000000000000/meta',
        payload: { key: 'val' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /v1/sessions/:id/meta', () => {
    it('returns empty object for session with no metadata', async () => {
      const res = await app.app.inject({
        method: 'GET',
        url: `/v1/sessions/${SESSION_ID}/meta`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().metadata).toEqual({});
    });

    it('returns all metadata', async () => {
      session.metadata = { pr_number: '1234', status: 'review' };

      const res = await app.app.inject({
        method: 'GET',
        url: `/v1/sessions/${SESSION_ID}/meta`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().metadata).toEqual({ pr_number: '1234', status: 'review' });
    });
  });

  describe('DELETE /v1/sessions/:id/meta/:key', () => {
    it('deletes a single key', async () => {
      session.metadata = { pr_number: '1234', status: 'review' };

      const res = await app.app.inject({
        method: 'DELETE',
        url: `/v1/sessions/${SESSION_ID}/meta/status`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().metadata).toEqual({ pr_number: '1234' });
    });

    it('returns 404 for non-existent key', async () => {
      const res = await app.app.inject({
        method: 'DELETE',
        url: `/v1/sessions/${SESSION_ID}/meta/nonexistent`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain('not found');
    });

    it('cleans up metadata object when last key deleted', async () => {
      session.metadata = { lone: 'wolf' };

      await app.app.inject({
        method: 'DELETE',
        url: `/v1/sessions/${SESSION_ID}/meta/lone`,
      });

      // Metadata should be undefined after cleanup
      expect(session.metadata).toBeUndefined();
    });
  });
});
