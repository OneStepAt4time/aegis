import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  AuditLogger,
  type AuditAction,
  type AuditRecord,
} from '../audit.js';
import { registerAuditRoutes } from '../routes/audit.js';
import type { RouteContext } from '../routes/context.js';

const SESSION_ALPHA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SESSION_BETA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('Audit Export API (#2082)', () => {
  let app: ReturnType<typeof Fastify>;
  let auditLogger: AuditLogger;
  let tmpDir: string;

  async function logAt(
    ts: string,
    actor: string,
    action: AuditAction,
    detail: string,
    sessionId?: string,
  ): Promise<AuditRecord> {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ts));
    try {
      return await auditLogger.log(actor, action, detail, sessionId);
    } finally {
      vi.useRealTimers();
    }
  }

  async function seedAuditLog() {
    return {
      r1: await logAt('2026-04-20T08:00:00.000Z', 'key:admin', 'key.create', 'Created key deploy-bot'),
      r2: await logAt('2026-04-20T08:10:00.000Z', 'key:admin', 'session.create', 'Created session alpha', SESSION_ALPHA),
      r3: await logAt('2026-04-20T08:20:00.000Z', 'key:admin', 'permission.approve', 'Approved alpha', SESSION_ALPHA),
      r4: await logAt('2026-04-20T08:30:00.000Z', 'key:admin', 'session.kill', 'Killed session alpha', SESSION_ALPHA),
      r5: await logAt('2026-04-20T08:40:00.000Z', 'key:viewer', 'key.create', 'Viewer created key'),
      r6: await logAt('2026-04-20T08:50:00.000Z', 'key:admin', 'session.create', 'Created session beta', SESSION_BETA),
    };
  }

  /** Build a minimal RouteContext mock with requirePermission support. */
  function buildCtx(overrides?: Record<string, unknown>): RouteContext {
    return {
      sessions: { listSessions: vi.fn(() => []) },
      metrics: { getGlobalMetrics: vi.fn(() => ({ sessions: { total_created: 0 } })) },
      auth: {
        authEnabled: true,
        getRole: vi.fn((keyId: string | null | undefined) =>
          keyId === 'key:admin' ? 'admin' : 'viewer',
        ),
        hasPermission: vi.fn(
          (_keyId: string | null | undefined, permission: string) =>
            permission === 'audit',
        ),
      },
      getAuditLogger: () => auditLogger,
      ...overrides,
    } as unknown as RouteContext;
  }

  /** Set up Fastify app with auth hook that resolves keyId from Bearer token. */
  function setupApp(ctx: RouteContext): ReturnType<typeof Fastify> {
    const server = Fastify({ logger: false });
    server.decorateRequest('authKeyId', null as unknown as string);
    (server as any).decorateRequest('matchedPermission', null);

    server.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      if (!token) {
        return reply.status(401).send({ error: 'Unauthorized — Bearer token required' });
      }
      req.authKeyId = token;
    });

    registerAuditRoutes(server, ctx);
    return server;
  }

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-audit-export-2082-'));
    auditLogger = new AuditLogger(tmpDir);
    await auditLogger.init();
    app = setupApp(buildCtx());
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── requirePermission guard ────────────────────────────────────────

  describe('requirePermission guard', () => {
    it('rejects requests without Bearer token (401)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit',
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects keys without audit permission (403)', async () => {
      const noPermsCtx = buildCtx({
        auth: {
          authEnabled: true,
          getRole: vi.fn(() => 'viewer'),
          hasPermission: vi.fn(() => false),
        },
      });
      const noPermsApp = setupApp(noPermsCtx);
      try {
        const response = await noPermsApp.inject({
          method: 'GET',
          url: '/v1/audit',
          headers: { Authorization: 'Bearer key:no-audit' },
        });
        expect(response.statusCode).toBe(403);
        expect(response.json().error).toContain('insufficient role');
      } finally {
        await noPermsApp.close();
      }
    });

    it('allows keys with audit permission', async () => {
      await seedAuditLog();
      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit?offset=0&limit=1',
        headers: { Authorization: 'Bearer key:admin' },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  // ── Offset-based pagination ────────────────────────────────────────

  describe('offset-based pagination', () => {
    it('returns export records with correct shape', async () => {
      await seedAuditLog();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit?offset=0&limit=2',
        headers: { Authorization: 'Bearer key:admin' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // Validate wrapper
      expect(body.total).toBe(6);
      expect(body.count).toBe(2);
            expect(body.pagination.limit).toBe(2);
      expect(body.pagination.hasMore).toBe(true);

      // Validate record shape
      const record = body.records[0];
      expect(record).toHaveProperty('id');
      expect(record).toHaveProperty('sequence');
      expect(record).toHaveProperty('timestamp');
      expect(record).toHaveProperty('actorKeyId');
      expect(record).toHaveProperty('sessionId');
      expect(record).toHaveProperty('action');
      expect(record).toHaveProperty('resource');
      expect(record).toHaveProperty('hash');
      expect(record).toHaveProperty('prevHash');
      expect(record).toHaveProperty('metadata');
    });

    it('assigns sequential sequence numbers across the chain', async () => {
      await seedAuditLog();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit?offset=0&limit=100',
        headers: { Authorization: 'Bearer key:admin' },
      });

      const body = response.json();
      const sequences = body.records.map((r: { sequence: number }) => r.sequence);
      expect(sequences).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('paginates with offset correctly', async () => {
      await seedAuditLog();

      // Page 1
      const page1 = await app.inject({
        method: 'GET',
        url: '/v1/audit?offset=0&limit=3',
        headers: { Authorization: 'Bearer key:admin' },
      });
      expect(page1.json().count).toBe(3);
      expect(page1.json().pagination.hasMore).toBe(true);
      expect(page1.json().records[0].resource).toBe('Created key deploy-bot');

      // Page 2
      const page2 = await app.inject({
        method: 'GET',
        url: '/v1/audit?offset=3&limit=3',
        headers: { Authorization: 'Bearer key:admin' },
      });
      expect(page2.json().count).toBe(3);
      expect(page2.json().pagination.hasMore).toBe(false);
      expect(page2.json().records[0].resource).toBe('Killed session alpha');

      // Page 3 (empty)
      const page3 = await app.inject({
        method: 'GET',
        url: '/v1/audit?offset=6&limit=3',
        headers: { Authorization: 'Bearer key:admin' },
      });
      expect(page3.json().count).toBe(0);
      expect(page3.json().pagination.hasMore).toBe(false);
      expect(page3.json().records).toEqual([]);
    });
  });

  // ── actorKeyId filter ──────────────────────────────────────────────

  describe('actorKeyId filter', () => {
    it('filters by actorKeyId', async () => {
      await seedAuditLog();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit?actorKeyId=key:viewer&offset=0',
        headers: { Authorization: 'Bearer key:admin' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(1);
      expect(body.records[0].actorKeyId).toBe('key:viewer');
      expect(body.records[0].resource).toBe('Viewer created key');
    });

    it('actorKeyId takes precedence over actor param', async () => {
      await seedAuditLog();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit?actor=key:admin&actorKeyId=key:viewer&offset=0',
        headers: { Authorization: 'Bearer key:admin' },
      });

      const body = response.json();
      expect(body.total).toBe(1);
      expect(body.records[0].actorKeyId).toBe('key:viewer');
    });
  });

  // ── Combined filters with offset ───────────────────────────────────

  describe('combined filters', () => {
    it('filters by action, sessionId, from, to with offset', async () => {
      await seedAuditLog();

      const response = await app.inject({
        method: 'GET',
        url: `/v1/audit?action=session.create&sessionId=${SESSION_ALPHA}&from=2026-04-20T08:05:00.000Z&to=2026-04-20T08:15:00.000Z&offset=0`,
        headers: { Authorization: 'Bearer key:admin' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(1);
      expect(body.records[0].resource).toBe('Created session alpha');
      expect(body.records[0].sessionId).toBe(SESSION_ALPHA);
    });
  });

  // ── CSV export with offset ─────────────────────────────────────────

  describe('CSV export', () => {
    it('exports CSV with export-v2 column headers', async () => {
      await seedAuditLog();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit?offset=0&limit=2&format=csv',
        headers: { Authorization: 'Bearer key:admin' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('attachment');

      const lines = response.body.trim().split('\n');
      expect(lines[0]).toBe('id,sequence,timestamp,actorKeyId,sessionId,action,resource,hash,prevHash');
      expect(lines).toHaveLength(3); // header + 2 rows
    });

    it('CSV rows contain the correct export field values', async () => {
      await seedAuditLog();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit?offset=0&limit=1&format=csv',
        headers: { Authorization: 'Bearer key:admin' },
      });

      const lines = response.body.trim().split('\n');
      const row = lines[1];
      expect(row).toContain('key:admin');
      expect(row).toContain('key.create');
      expect(row).toContain('Created key deploy-bot');
    });
  });

  // ── Field mapping correctness ──────────────────────────────────────

  describe('field mapping', () => {
    it('maps ts → timestamp, actor → actorKeyId, detail → resource', async () => {
      await seedAuditLog();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit?offset=0&limit=1',
        headers: { Authorization: 'Bearer key:admin' },
      });

      const record = response.json().records[0];
      expect(record.timestamp).toBe('2026-04-20T08:00:00.000Z');
      expect(record.actorKeyId).toBe('key:admin');
      expect(record.action).toBe('key.create');
      expect(record.resource).toBe('Created key deploy-bot');
      expect(record.id).toBe(record.hash);
    });

    it('maps sessionId to top-level and metadata', async () => {
      await seedAuditLog();

      const response = await app.inject({
        method: 'GET',
        url: `/v1/audit?sessionId=${SESSION_ALPHA}&offset=0&limit=1`,
        headers: { Authorization: 'Bearer key:admin' },
      });

      const record = response.json().records[0];
      expect(record.sessionId).toBe(SESSION_ALPHA);
      expect(record.metadata.sessionId).toBe(SESSION_ALPHA);
    });

    it('sets sessionId to empty string and empty metadata for records without session', async () => {
      await seedAuditLog();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit?actorKeyId=key:viewer&offset=0&limit=1',
        headers: { Authorization: 'Bearer key:admin' },
      });

      const record = response.json().records[0];
      expect(record.sessionId).toBe('');
      expect(record.metadata).toEqual({});
    });
  });

  // ── Backward compatibility ─────────────────────────────────────────

  describe('backward compatibility', () => {
    it('cursor-based path still works without offset param', async () => {
      await seedAuditLog();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit?limit=2',
        headers: { Authorization: 'Bearer key:admin' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      // Cursor path returns raw AuditRecord shape (ts, actor, etc.)
      expect(body.records[0]).toHaveProperty('ts');
      expect(body.records[0]).toHaveProperty('actor');
      expect(body.records[0]).toHaveProperty('detail');
      expect(body.pagination).toHaveProperty('nextCursor');
    });

    it('actor param still works on cursor path', async () => {
      await seedAuditLog();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit?actor=key:viewer&limit=10',
        headers: { Authorization: 'Bearer key:admin' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().total).toBe(1);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty records for offset beyond total', async () => {
      await seedAuditLog();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit?offset=999',
        headers: { Authorization: 'Bearer key:admin' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.records).toEqual([]);
      expect(body.count).toBe(0);
      expect(body.total).toBe(6);
    });

    it('returns empty when no audit records exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit?offset=0',
        headers: { Authorization: 'Bearer key:admin' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.records).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('returns 503 when audit logger is not available', async () => {
      const noLoggerCtx = buildCtx({ getAuditLogger: () => undefined });
      const noLoggerApp = setupApp(noLoggerCtx);
      try {
        const response = await noLoggerApp.inject({
          method: 'GET',
          url: '/v1/audit?offset=0',
          headers: { Authorization: 'Bearer key:admin' },
        });
        expect(response.statusCode).toBe(503);
      } finally {
        await noLoggerApp.close();
      }
    });

    it('validates offset must be non-negative integer', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit?offset=-1',
        headers: { Authorization: 'Bearer key:admin' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('validates from/to as ISO timestamps', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit?from=not-a-date&offset=0',
        headers: { Authorization: 'Bearer key:admin' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ── AuditLogger.queryWithOffset unit tests ─────────────────────────

  describe('AuditLogger.queryWithOffset', () => {
    it('returns correct total and records across all files', async () => {
      // Seed records across two days
      await logAt('2026-04-19T23:50:00.000Z', 'key:admin', 'key.create', 'Day1 record');
      await logAt('2026-04-20T00:10:00.000Z', 'key:admin', 'session.create', 'Day2 record', SESSION_ALPHA);

      const page = await auditLogger.queryWithOffset({ offset: 0, limit: 100 });
      expect(page.total).toBe(2);
      expect(page.records).toHaveLength(2);
      expect(page.records[0]!.resource).toBe('Day1 record');
      expect(page.records[1]!.resource).toBe('Day2 record');
      expect(page.records[0]!.sequence).toBe(1);
      expect(page.records[1]!.sequence).toBe(2);
    });

    it('applies filters and returns filtered total', async () => {
      await seedAuditLog();

      const page = await auditLogger.queryWithOffset({
        action: 'session.create',
        offset: 0,
        limit: 10,
      });
      expect(page.total).toBe(2);
      expect(page.records).toHaveLength(2);
      expect(page.records.every(r => r.action === 'session.create')).toBe(true);
    });

    it('respects offset and limit on filtered results', async () => {
      await seedAuditLog();

      const page = await auditLogger.queryWithOffset({
        offset: 1,
        limit: 2,
      });
      expect(page.total).toBe(6);
      expect(page.records).toHaveLength(2);
      expect(page.hasMore).toBe(true);
      // Records 2 and 3 (1-indexed after skipping 1)
      expect(page.records[0]!.sequence).toBe(2);
      expect(page.records[1]!.sequence).toBe(3);
    });
  });
});
