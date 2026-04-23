import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  AuditLogger,
  buildAuditChainMetadata,
  type AuditAction,
  type AuditRecord,
} from '../audit.js';
import { registerAuditRoutes } from '../routes/audit.js';
import type { RouteContext } from '../routes/context.js';

const SESSION_ONE = '11111111-1111-1111-1111-111111111111';
const SESSION_TWO = '22222222-2222-2222-2222-222222222222';

describe('Audit API export backend (#1923)', () => {
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
      createKey: await logAt('2026-04-17T10:00:00.000Z', 'admin-key', 'key.create', 'Created key'),
      createSessionOne: await logAt('2026-04-17T10:10:00.000Z', 'admin-key', 'session.create', 'Created session one', SESSION_ONE),
      approveSessionOne: await logAt('2026-04-17T10:20:00.000Z', 'admin-key', 'permission.approve', 'Approved session one', SESSION_ONE),
      killSessionOne: await logAt('2026-04-17T10:30:00.000Z', 'admin-key', 'session.kill', 'Killed session one', SESSION_ONE),
      viewerCreateKey: await logAt('2026-04-17T10:40:00.000Z', 'viewer-key', 'key.create', 'Viewer created key'),
      createSessionTwo: await logAt('2026-04-17T10:50:00.000Z', 'admin-key', 'session.create', 'Created session two', SESSION_TWO),
    };
  }

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-audit-routes-'));
    auditLogger = new AuditLogger(tmpDir);
    await auditLogger.init();

    app = Fastify({ logger: false });
    app.decorateRequest('authKeyId', null as unknown as string);
    app.decorateRequest('matchedPermission', null as unknown as string);

    app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      if (!token) {
        return reply.status(401).send({ error: 'Unauthorized — Bearer token required' });
      }
      req.authKeyId = token;
    });

    const ctx = {
      sessions: { listSessions: vi.fn(() => []) },
      metrics: { getGlobalMetrics: vi.fn(() => ({ sessions: { total_created: 0 } })) },
      auth: {
        authEnabled: true,
        getRole: vi.fn((keyId: string | null | undefined) => (keyId === 'admin-key' ? 'admin' : 'viewer')),
        hasPermission: vi.fn((_keyId: string | null | undefined, permission: string) => permission === 'audit'),
      },
      getAuditLogger: () => auditLogger,
    } as unknown as RouteContext;

    registerAuditRoutes(app, ctx);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('filters by actor, action, time range, and session id together', async () => {
    await seedAuditLog();

    const response = await app.inject({
      method: 'GET',
      url: `/v1/audit?actor=admin-key&action=session.kill&sessionId=${SESSION_ONE}&from=2026-04-17T10:15:00.000Z&to=2026-04-17T10:35:00.000Z`,
      headers: { Authorization: 'Bearer admin-key' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.count).toBe(1);
    expect(body.total).toBe(1);
    expect(body.records).toHaveLength(1);
    expect(body.records[0]!.detail).toBe('Killed session one');
    expect(body.pagination.hasMore).toBe(false);
    expect(body.chain.count).toBe(1);
  });

  it('returns cursor pagination metadata for older pages', async () => {
    const seeded = await seedAuditLog();

    const firstPageResponse = await app.inject({
      method: 'GET',
      url: '/v1/audit?actor=admin-key&limit=2&reverse=true',
      headers: { Authorization: 'Bearer admin-key' },
    });

    expect(firstPageResponse.statusCode).toBe(200);
    const firstPage = firstPageResponse.json();
    expect(firstPage.records.map((record: { detail: string }) => record.detail)).toEqual([
      'Created session two',
      'Killed session one',
    ]);
    expect(firstPage.pagination.hasMore).toBe(true);
    expect(firstPage.pagination.nextCursor).toBe(seeded.killSessionOne.hash);

    const secondPageResponse = await app.inject({
      method: 'GET',
      url: `/v1/audit?actor=admin-key&limit=2&reverse=true&cursor=${firstPage.pagination.nextCursor as string}`,
      headers: { Authorization: 'Bearer admin-key' },
    });

    expect(secondPageResponse.statusCode).toBe(200);
    const secondPage = secondPageResponse.json();
    expect(secondPage.records.map((record: { detail: string }) => record.detail)).toEqual([
      'Approved session one',
      'Created session one',
    ]);
    expect(secondPage.pagination.hasMore).toBe(true);
  });

  it('exports CSV with chain metadata headers', async () => {
    const seeded = await seedAuditLog();
    const expectedRecords = [seeded.createSessionOne, seeded.createSessionTwo];
    const expectedChain = buildAuditChainMetadata(expectedRecords);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/audit?action=session.create&format=csv&verify=true',
      headers: { Authorization: 'Bearer admin-key' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment; filename="audit-export-');
    expect(response.headers['x-aegis-audit-record-count']).toBe('2');
    expect(response.headers['x-aegis-audit-first-hash']).toBe(expectedChain.firstHash);
    expect(response.headers['x-aegis-audit-last-hash']).toBe(expectedChain.lastHash);
    expect(response.headers['x-aegis-audit-chain-badge']).toBe(expectedChain.badgeHash);
    expect(response.headers['x-aegis-audit-integrity-valid']).toBe('true');

    const lines = response.body.trim().split('\n');
    expect(lines[0]).toBe('ts,actor,action,sessionId,detail,prevHash,hash');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(SESSION_ONE);
    expect(lines[2]).toContain(SESSION_TWO);
  });

  it('exports full NDJSON filter matches even when limit is provided', async () => {
    await seedAuditLog();

    const response = await app.inject({
      method: 'GET',
      url: `/v1/audit?sessionId=${SESSION_ONE}&format=ndjson&limit=1`,
      headers: { Authorization: 'Bearer admin-key' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-ndjson');
    expect(response.headers['x-aegis-audit-record-count']).toBe('3');

    const records = response.body.trim().split('\n').map((line: string) => JSON.parse(line) as { detail: string });
    expect(records.map((record: { detail: string }) => record.detail)).toEqual([
      'Created session one',
      'Approved session one',
      'Killed session one',
    ]);
  });
});
