/**
 * Issue #1944: Multi-tenancy primitives — tenant scoping tests.
 *
 * Updated for Issue #2267: tenant isolation model changes.
 * - Non-admin keys with tenantId get that tenantId on req.tenantId
 * - Legacy sessions (no tenantId) are only visible to SYSTEM_TENANT callers
 *
 * Tests that tenantId on ApiKey flows into session creation, listing,
 * and audit queries. Admin/master bypass tenant scoping.
 */

import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { AuditLogger, type AuditAction, type AuditRecord } from '../audit.js';
import { registerAuditRoutes } from '../routes/audit.js';
import { registerSessionRoutes } from '../routes/sessions.js';
import type { RouteContext } from '../routes/context.js';
import type { SessionInfo } from '../session.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: overrides.id ?? 's-1',
    windowId: '@1',
    windowName: 'cc-test',
    workDir: '/tmp/test',
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

function makeRouteContext(overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    sessions: {
      listSessions: vi.fn(() => []),
      getSession: vi.fn(() => null),
      createSession: vi.fn(async (opts: any) => makeSession({ id: 's-new', tenantId: opts.tenantId, ownerKeyId: opts.ownerKeyId })),
      findIdleSessionByWorkDir: vi.fn(async () => null),
      releaseSessionClaim: vi.fn(),
      getSessionHistory: vi.fn(() => []),
    } as any,
    auth: {
      authEnabled: true,
      getRole: vi.fn((keyId: string | null | undefined) => {
        if (keyId === 'master' || keyId === null || keyId === undefined) return 'admin';
        if (keyId === 'admin-key') return 'admin';
        if (keyId === 'operator-key') return 'operator';
        return 'viewer';
      }),
      hasPermission: vi.fn(() => true),
      getKey: vi.fn(() => null),
      getAuditActor: vi.fn((keyId: string) => keyId ?? 'system'),
    } as any,
    config: {
      enforceSessionOwnership: true,
      defaultTenantId: 'default',
    } as any,
    metrics: {
      getGlobalMetrics: vi.fn(() => ({ sessions: { total_created: 0 } })),
      sessionCreated: vi.fn(),
      promptSent: vi.fn(),
    } as any,
    monitor: {} as any,
    eventBus: {} as any,
    channels: {
      sessionCreated: vi.fn(async () => {}),
    } as any,
    memoryBridge: null,
    toolRegistry: null,
    getAuditLogger: vi.fn(() => undefined),
    validateWorkDir: vi.fn(async (dir: string) => dir),
    ...overrides,
  } as unknown as RouteContext;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Multi-tenancy (#1944) — session listing', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => {
    app = Fastify({ logger: false });
    app.decorateRequest('authKeyId', null as unknown as string);
    app.decorateRequest('matchedPermission', null as unknown as string);
    app.decorateRequest('tenantId', undefined as unknown as string);

    app.addHook('onRequest', async (req: FastifyRequest, _reply: FastifyReply) => {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      if (token) {
        req.authKeyId = token;
        // Issue #2267: simulate tenant lookup — non-admin keys get their tenantId
        if (token === 'acme-key') req.tenantId = 'acme';
        else if (token === 'globex-key') req.tenantId = 'globex';
        // admin-key, master → no tenantId set here (auth middleware handles SYSTEM_TENANT)
      }
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('non-admin key only sees sessions matching its tenantId', async () => {
    const sessions = [
      makeSession({ id: 's-1', tenantId: 'acme' }),
      makeSession({ id: 's-2', tenantId: 'globex' }),
      makeSession({ id: 's-3' }), // no tenantId — legacy
    ];
    const ctx = makeRouteContext({
      sessions: { ...makeRouteContext().sessions, listSessions: vi.fn(() => sessions) },
    } as any);
    registerSessionRoutes(app, ctx);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { Authorization: 'Bearer acme-key' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = body.sessions.map((s: SessionInfo) => s.id);
    expect(ids).toContain('s-1'); // acme tenant
    // Issue #2267: legacy sessions (no tenantId) are NOT visible to regular tenant callers
    expect(ids).not.toContain('s-3');
    expect(ids).not.toContain('s-2'); // globex tenant
  });

  it('admin sees all sessions regardless of tenantId', async () => {
    const sessions = [
      makeSession({ id: 's-1', tenantId: 'acme' }),
      makeSession({ id: 's-2', tenantId: 'globex' }),
      makeSession({ id: 's-3' }),
    ];
    const ctx = makeRouteContext({
      sessions: { ...makeRouteContext().sessions, listSessions: vi.fn(() => sessions) },
    } as any);
    registerSessionRoutes(app, ctx);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { Authorization: 'Bearer admin-key' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessions).toHaveLength(3);
  });

  it('master token sees all sessions', async () => {
    const sessions = [
      makeSession({ id: 's-1', tenantId: 'acme' }),
      makeSession({ id: 's-2', tenantId: 'globex' }),
    ];
    const ctx = makeRouteContext({
      sessions: { ...makeRouteContext().sessions, listSessions: vi.fn(() => sessions) },
    } as any);
    registerSessionRoutes(app, ctx);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { Authorization: 'Bearer master' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessions).toHaveLength(2);
  });

  it('sessions without tenantId are NOT visible to regular tenant callers', async () => {
    const sessions = [
      makeSession({ id: 's-1' }), // no tenantId (legacy)
      makeSession({ id: 's-2', tenantId: 'globex' }),
    ];
    const ctx = makeRouteContext({
      sessions: { ...makeRouteContext().sessions, listSessions: vi.fn(() => sessions) },
    } as any);
    registerSessionRoutes(app, ctx);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { Authorization: 'Bearer acme-key' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = body.sessions.map((s: SessionInfo) => s.id);
    // Issue #2267: legacy sessions (no tenantId) are NOT visible to regular tenant callers
    expect(ids).not.toContain('s-1');
    expect(ids).not.toContain('s-2');
  });

  it('session creation propagates tenantId from caller', async () => {
    const createFn = vi.fn(async (opts: any) =>
      makeSession({ id: 's-new', tenantId: opts.tenantId, ownerKeyId: opts.ownerKeyId }),
    );
    const auditLogger = {
      log: vi.fn(async () => ({})),
    } as any;
    const ctx = makeRouteContext({
      sessions: {
        ...makeRouteContext().sessions,
        createSession: createFn,
        findIdleSessionByWorkDir: vi.fn(async () => null),
      },
      getAuditLogger: vi.fn(() => auditLogger),
    } as any);
    registerSessionRoutes(app, ctx);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { Authorization: 'Bearer acme-key', 'Content-Type': 'application/json' },
      payload: { workDir: '/tmp/test' },
    });

    expect(res.statusCode).toBe(201);
    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'acme', ownerKeyId: 'acme-key' }),
    );
    // Audit log should include tenantId
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.any(String),
      'session.create',
      expect.any(String),
      expect.any(String),
      'acme', // tenantId
    );
  });
});

describe('Multi-tenancy (#1944) — audit scoping', () => {
  let app: ReturnType<typeof Fastify>;
  let auditLogger: AuditLogger;
  let tmpDir: string;

  async function logAt(
    ts: string,
    actor: string,
    action: AuditAction,
    detail: string,
    sessionId?: string,
    tenantId?: string,
  ): Promise<AuditRecord> {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ts));
    try {
      return await auditLogger.log(actor, action, detail, sessionId, tenantId);
    } finally {
      vi.useRealTimers();
    }
  }

  async function seedAuditLog() {
    return {
      acmeCreate: await logAt('2026-04-20T10:00:00.000Z', 'acme-key', 'session.create', 'Acme session', 's-1', 'acme'),
      acmeKill: await logAt('2026-04-20T10:10:00.000Z', 'acme-key', 'session.kill', 'Acme killed', 's-1', 'acme'),
      globexCreate: await logAt('2026-04-20T10:20:00.000Z', 'globex-key', 'session.create', 'Globex session', 's-2', 'globex'),
      noTenant: await logAt('2026-04-20T10:30:00.000Z', 'system', 'key.create', 'System key created'),
    };
  }

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-mt-audit-'));
    auditLogger = new AuditLogger(tmpDir);
    await auditLogger.init();

    app = Fastify({ logger: false });
    app.decorateRequest('authKeyId', null as unknown as string);
    app.decorateRequest('matchedPermission', null as unknown as string);
    app.decorateRequest('tenantId', undefined as unknown as string);

    app.addHook('onRequest', async (req: FastifyRequest, _reply: FastifyReply) => {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      if (token) {
        req.authKeyId = token;
        if (token === 'acme-admin') req.tenantId = 'acme';
        else if (token === 'globex-admin') req.tenantId = 'globex';
        // admin-key → no tenantId (admin bypass via SYSTEM_TENANT in auth middleware)
      }
    });

    const ctx = {
      sessions: { listSessions: vi.fn(() => []) },
      metrics: { getGlobalMetrics: vi.fn(() => ({ sessions: { total_created: 0 } })) },
      auth: {
        authEnabled: true,
        getRole: vi.fn((keyId: string | null | undefined) => {
          if (keyId === 'admin-key' || keyId === 'acme-admin' || keyId === 'globex-admin') return 'admin';
          return 'viewer';
        }),
        hasPermission: vi.fn(() => true),
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

  it('tenant-scoped admin only sees audit records for its tenant', async () => {
    await seedAuditLog();

    const res = await app.inject({
      method: 'GET',
      url: '/v1/audit',
      headers: { Authorization: 'Bearer acme-admin' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Strict: only records with tenantId=acme; no-tenant records excluded
    expect(body.records).toHaveLength(2);
    const details = body.records.map((r: AuditRecord) => r.detail);
    expect(details).toContain('Acme session');
    expect(details).toContain('Acme killed');
  });

  it('admin without tenantId sees all audit records', async () => {
    await seedAuditLog();

    const res = await app.inject({
      method: 'GET',
      url: '/v1/audit',
      headers: { Authorization: 'Bearer admin-key' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.records).toHaveLength(4);
  });

  it('records without tenantId are excluded when tenant filter is active', async () => {
    await seedAuditLog();

    const res = await app.inject({
      method: 'GET',
      url: '/v1/audit',
      headers: { Authorization: 'Bearer acme-admin' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const details = body.records.map((r: AuditRecord) => r.detail);
    // "System key created" has no tenantId → excluded by strict filter
    expect(details).not.toContain('System key created');
  });

  it('tenant-scoped admin cannot see other tenant records', async () => {
    await seedAuditLog();

    const res = await app.inject({
      method: 'GET',
      url: '/v1/audit',
      headers: { Authorization: 'Bearer globex-admin' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Strict: only globex records
    expect(body.records).toHaveLength(1);
    const details = body.records.map((r: AuditRecord) => r.detail);
    expect(details).toContain('Globex session');
    expect(details).not.toContain('Acme session');
  });
});

describe('Multi-tenancy (#1944) — requireOwnership with tenant', () => {
  it('rejects cross-tenant access for non-admin key', async () => {
    const { requireOwnership } = await import('../routes/context.js');
    const sessions = {
      getSession: vi.fn(() => makeSession({ id: 's-1', tenantId: 'acme', ownerKeyId: 'acme-key' })),
    } as any;
    const reply = { status: vi.fn(() => ({ send: vi.fn() })) } as any;

    const result = requireOwnership(sessions, 's-1', reply, 'globex-key', 'globex');

    expect(result).toBeNull();
    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it('allows same-tenant access', async () => {
    const { requireOwnership } = await import('../routes/context.js');
    const sessions = {
      getSession: vi.fn(() => makeSession({ id: 's-1', tenantId: 'acme', ownerKeyId: 'acme-key' })),
    } as any;
    const reply = { status: vi.fn(() => ({ send: vi.fn() })) } as any;

    const result = requireOwnership(sessions, 's-1', reply, 'acme-key', 'acme');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('s-1');
  });

  it('master bypasses tenant check', async () => {
    const { requireOwnership } = await import('../routes/context.js');
    const sessions = {
      getSession: vi.fn(() => makeSession({ id: 's-1', tenantId: 'acme', ownerKeyId: 'acme-key' })),
    } as any;
    const reply = { status: vi.fn(() => ({ send: vi.fn() })) } as any;

    const result = requireOwnership(sessions, 's-1', reply, 'master', 'globex');

    expect(result).not.toBeNull();
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('session without tenantId allows all callers', async () => {
    const { requireOwnership } = await import('../routes/context.js');
    const sessions = {
      getSession: vi.fn(() => makeSession({ id: 's-1', ownerKeyId: 'acme-key' })),
    } as any;
    const reply = { status: vi.fn(() => ({ send: vi.fn() })) } as any;

    const result = requireOwnership(sessions, 's-1', reply, 'globex-key', 'globex');

    // Passes tenant check (session has no tenantId), then fails ownership check
    // But since no ownerKeyId match, it returns 403 for ownership, not tenant
    expect(result).toBeNull();
  });
});
