/**
 * templates-routes.test.ts — Route-level tests for session template CRUD endpoints.
 *
 * Covers:
 *   GET    /v1/templates        — list templates (happy path, 401 unauthorized)
 *   POST   /v1/templates        — create (happy path, invalid body, missing workDir, session not found)
 *   GET    /v1/templates/:id    — get by id (happy path, not found)
 *   PUT    /v1/templates/:id    — update (happy path, not found)
 *   DELETE /v1/templates/:id    — delete (happy path, not found)
 */

import Fastify from 'fastify';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../template-store.js', () => ({
  listTemplates: vi.fn(),
  createTemplate: vi.fn(),
  getTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));

import * as templateStore from '../template-store.js';
import { registerTemplateRoutes } from '../routes/templates.js';
import type { RouteContext } from '../routes/context.js';
import type { SessionInfo } from '../session.js';
import type { SessionTemplate } from '../template-store.js';

const SESSION_ID = 'bb000001-0000-4000-8000-000000000000';
const TEMPLATE_ID = 'cc000001-0000-4000-8000-000000000000';

function makeTemplate(overrides: Partial<SessionTemplate> = {}): SessionTemplate {
  return {
    id: TEMPLATE_ID,
    name: 'my-template',
    workDir: '/tmp/template-workdir',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: SESSION_ID,
    displayName: 'template-test-session',
    workDir: '/tmp/session-workdir',
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

function buildApp({ authEnabled = false, sessionExists = true } = {}) {
  const session = makeSession();
  const sessions = {
    getSession: vi.fn((id: string) => (id === SESSION_ID && sessionExists ? session : undefined)),
  };

  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    if (authEnabled) {
      // Leave authKeyId unset so requireRole sees no auth context with authEnabled=true
      req.authKeyId = undefined;
    } else {
      req.authKeyId = null;
    }
    req.tenantId = undefined;
  });

  const ctx = {
    sessions,
    auth: {
      authEnabled,
      getRole: vi.fn(() => 'admin'),
      hasPermission: vi.fn(() => true),
    },
    config: {},
    metrics: {},
    monitor: {},
    eventBus: {},
    channels: {},
    toolRegistry: {},
    validateWorkDir: vi.fn(async (d: string) => d),
    getAuditLogger: vi.fn(() => null),
    sseLimiter: {},
  } as unknown as RouteContext;

  registerTemplateRoutes(app, ctx);
  return { app, sessions };
}

describe('GET /v1/templates', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.mocked(templateStore.listTemplates).mockResolvedValue([makeTemplate()]);
    ({ app } = buildApp());
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('returns the list of templates', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/templates' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(TEMPLATE_ID);
    expect(body[0].name).toBe('my-template');
  });

  it('returns empty array when no templates exist', async () => {
    vi.mocked(templateStore.listTemplates).mockResolvedValue([]);

    const response = await app.inject({ method: 'GET', url: '/v1/templates' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('returns 401 when auth is required and no token is provided', async () => {
    await app.close();
    const { app: authApp } = buildApp({ authEnabled: true });
    await authApp.ready();

    const response = await authApp.inject({ method: 'GET', url: '/v1/templates' });

    await authApp.close();
    expect(response.statusCode).toBe(401);
  });
});

describe('POST /v1/templates', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.mocked(templateStore.createTemplate).mockResolvedValue(makeTemplate());
    ({ app } = buildApp());
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('creates a template and returns 201 with the new template', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/templates',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'my-template', workDir: '/tmp/template-workdir' }),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.id).toBe(TEMPLATE_ID);
    expect(body.name).toBe('my-template');
    expect(templateStore.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my-template', workDir: '/tmp/template-workdir' }),
    );
  });

  it('returns 400 when name is missing from request body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/templates',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workDir: '/tmp/template-workdir' }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Invalid request body');
    expect(templateStore.createTemplate).not.toHaveBeenCalled();
  });

  it('returns 400 when workDir is not provided and no sessionId given', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/templates',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'no-workdir-template' }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('workDir is required');
    expect(templateStore.createTemplate).not.toHaveBeenCalled();
  });

  it('returns 404 when sessionId references a non-existent session', async () => {
    await app.close();
    const { app: noSessionApp } = buildApp({ sessionExists: false });
    await noSessionApp.ready();

    const response = await noSessionApp.inject({
      method: 'POST',
      url: '/v1/templates',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'from-session',
        sessionId: SESSION_ID,
      }),
    });

    await noSessionApp.close();
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('Session not found');
    expect(templateStore.createTemplate).not.toHaveBeenCalled();
  });
});

describe('GET /v1/templates/:id', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.mocked(templateStore.getTemplate).mockResolvedValue(makeTemplate());
    ({ app } = buildApp());
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('returns the template when it exists', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/templates/${TEMPLATE_ID}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe(TEMPLATE_ID);
    expect(body.name).toBe('my-template');
    expect(templateStore.getTemplate).toHaveBeenCalledWith(TEMPLATE_ID);
  });

  it('returns 404 when template does not exist', async () => {
    vi.mocked(templateStore.getTemplate).mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/templates/nonexistent-template-id',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('Template not found');
  });
});

describe('PUT /v1/templates/:id', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.mocked(templateStore.updateTemplate).mockResolvedValue(makeTemplate({ name: 'updated-name' }));
    ({ app } = buildApp());
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('updates the template and returns the updated record', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/templates/${TEMPLATE_ID}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'updated-name' }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.name).toBe('updated-name');
    expect(templateStore.updateTemplate).toHaveBeenCalledWith(
      TEMPLATE_ID,
      expect.objectContaining({ name: 'updated-name' }),
    );
  });

  it('returns 404 when template does not exist', async () => {
    vi.mocked(templateStore.updateTemplate).mockResolvedValue(null);

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/templates/nonexistent-id`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'updated-name' }),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('Template not found');
  });
});

describe('DELETE /v1/templates/:id', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.mocked(templateStore.deleteTemplate).mockResolvedValue(true);
    ({ app } = buildApp());
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('deletes the template and returns ok', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/templates/${TEMPLATE_ID}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(templateStore.deleteTemplate).toHaveBeenCalledWith(TEMPLATE_ID);
  });

  it('returns 404 when template does not exist', async () => {
    vi.mocked(templateStore.deleteTemplate).mockResolvedValue(false);

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/templates/nonexistent-id',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('Template not found');
  });
});
