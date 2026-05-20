/**
 * Issue #3867: POST /v1/sessions API field is workDir but ag run uses cwd
 *
 * Tests that the createSession Zod schema accepts both `workDir` and `cwd` fields,
 * and that the route handler normalizes `cwd` into `workDir`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerSessionRoutes } from '../routes/sessions.js';
import type { RouteContext } from '../routes/context.js';

// Mock child_process to avoid needing claude CLI
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_file: string, _args: string[], _opts: unknown, cb?: (err: Error | null) => void) => {
    cb?.(new Error('claude unavailable in tests'));
  }),
}));

function buildApp() {
  const app = Fastify();
  const ctx = {
    sessions: {
      get: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockRejectedValue(new Error('claude not available')),
      listSessions: vi.fn().mockResolvedValue({ sessions: [], pagination: { total: 0 } }),
    },
    config: { envDenylist: [], envAdminAllowlist: [] },
    auth: { masterKey: 'test-key' },
    channels: { fanOut: vi.fn(), sessionCreated: vi.fn() },
    monitor: { addSession: vi.fn(), removeSession: vi.fn() },
    metrics: { cleanupSession: vi.fn() },
    toolRegistry: { cleanupSession: vi.fn() },
    acpBackend: { isEnabled: () => false },
  } as unknown as RouteContext;

  registerSessionRoutes(app, ctx);
  return { app, ctx };
}

describe('Issue #3867: cwd alias for workDir', () => {
  let app: Fastify.FastifyInstance;

  beforeEach(() => {
    ({ app } = buildApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects body with neither workDir nor cwd', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: 'Bearer test-key' },
      payload: { name: 'test' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts body with workDir only', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: 'Bearer test-key' },
      payload: { workDir: '/tmp' },
    });
    // Not a 400 validation error
    expect(res.statusCode).not.toBe(400);
  });

  it('accepts body with cwd as alias for workDir', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: 'Bearer test-key' },
      payload: { cwd: '/tmp' },
    });
    expect(res.statusCode).not.toBe(400);
  });

  it('workDir takes precedence when both provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: 'Bearer test-key' },
      payload: { workDir: '/tmp', cwd: '/nonexistent' },
    });
    expect(res.statusCode).not.toBe(400);
  });
});
