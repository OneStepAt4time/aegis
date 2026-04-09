import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerPermissionRoutes } from '../permission-routes.js';

type RouteHandler = (req: { params: { id: string } }, reply: any) => Promise<unknown>;

function makeMockApp(): FastifyInstance {
  return {
    post: vi.fn(),
  } as unknown as FastifyInstance;
}

function makeReply() {
  const send = vi.fn((payload: unknown) => payload);
  const status = vi.fn(() => ({ send }));
  return { send, status };
}

function getHandler(app: FastifyInstance, path: string): RouteHandler {
  const post = app.post as ReturnType<typeof vi.fn>;
  const call = post.mock.calls.find((args: unknown[]) => args[0] === path);
  if (!call) throw new Error(`Missing route registration for ${path}`);
  return call[1] as RouteHandler;
}

describe('permission-routes', () => {
  let app: FastifyInstance;
  let sessions: {
    approve: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
    getLatencyMetrics: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
  };
  let metrics: {
    recordPermissionResponse: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    app = makeMockApp();
    sessions = {
      approve: vi.fn(async () => {}),
      reject: vi.fn(async () => {}),
      getLatencyMetrics: vi.fn(() => ({ permission_response_ms: null })),
      getSession: vi.fn(() => ({ id: 's-1', ownerKeyId: undefined })),
    };
    metrics = {
      recordPermissionResponse: vi.fn(),
    };
  });

  it('registers approve/reject handlers for both v1 and legacy paths', () => {
    registerPermissionRoutes(app, sessions as any, metrics as any);

    const post = app.post as ReturnType<typeof vi.fn>;
    expect(post).toHaveBeenCalledWith('/v1/sessions/:id/approve', expect.any(Function));
    expect(post).toHaveBeenCalledWith('/sessions/:id/approve', expect.any(Function));
    expect(post).toHaveBeenCalledWith('/v1/sessions/:id/reject', expect.any(Function));
    expect(post).toHaveBeenCalledWith('/sessions/:id/reject', expect.any(Function));
  });

  it('approve path calls approve and records permission latency when present', async () => {
    sessions.getLatencyMetrics.mockReturnValue({ permission_response_ms: 321 });
    registerPermissionRoutes(app, sessions as any, metrics as any);

    const handler = getHandler(app, '/v1/sessions/:id/approve');
    const reply = makeReply();
    const result = await handler({ params: { id: 's-1' } }, reply);

    expect(result).toEqual({ ok: true });
    expect(sessions.approve).toHaveBeenCalledWith('s-1');
    expect(sessions.reject).not.toHaveBeenCalled();
    expect(metrics.recordPermissionResponse).toHaveBeenCalledWith('s-1', 321);
  });

  it('reject legacy path calls reject and does not record null latency', async () => {
    sessions.getLatencyMetrics.mockReturnValue({ permission_response_ms: null });
    registerPermissionRoutes(app, sessions as any, metrics as any);

    const handler = getHandler(app, '/sessions/:id/reject');
    const reply = makeReply();
    const result = await handler({ params: { id: 's-2' } }, reply);

    expect(result).toEqual({ ok: true });
    expect(sessions.reject).toHaveBeenCalledWith('s-2');
    expect(sessions.approve).not.toHaveBeenCalled();
    expect(metrics.recordPermissionResponse).not.toHaveBeenCalled();
  });

  it('returns 404 with error payload when session operation fails', async () => {
    sessions.approve.mockRejectedValue(new Error('Session not found'));
    registerPermissionRoutes(app, sessions as any, metrics as any);

    const handler = getHandler(app, '/v1/sessions/:id/approve');
    const reply = makeReply();
    await handler({ params: { id: 'missing' } }, reply);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Session not found' });
  });
});
