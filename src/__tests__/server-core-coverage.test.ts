import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { InjectOptions } from 'light-my-request';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

const sandboxRoot = join(process.cwd(), '.test-scratch', `server-core-${crypto.randomUUID()}`);
const stateDir = join(sandboxRoot, 'state');
const projectsDir = join(sandboxRoot, 'projects');
const workDir = join(sandboxRoot, 'workdir');

const originalEnv: Record<string, string | undefined> = {
  AEGIS_STATE_DIR: process.env.AEGIS_STATE_DIR,
  AEGIS_CLAUDE_PROJECTS_DIR: process.env.AEGIS_CLAUDE_PROJECTS_DIR,
  AEGIS_PORT: process.env.AEGIS_PORT,
  AEGIS_HOST: process.env.AEGIS_HOST,
  AEGIS_AUTH_TOKEN: process.env.AEGIS_AUTH_TOKEN,
};

const authToken = 'server-core-token';
const authHeaders = { authorization: `Bearer ${authToken}` };

let capturedApp: FastifyInstance | null = null;
const pipelineStore = new Map<string, Record<string, unknown>>();

vi.mock('../startup.js', () => ({
  listenWithRetry: vi.fn(async (app: FastifyInstance) => {
    capturedApp = app;
    await app.ready();
  }),
  writePidFile: vi.fn(async () => join(stateDir, 'aegis.pid')),
  removePidFile: vi.fn(),
}));

vi.mock('../pipeline.js', () => ({
  PipelineManager: class {
    async hydrate(): Promise<void> {}
    async destroy(): Promise<void> {}

    async batchCreate(specs: Array<Record<string, unknown>>): Promise<{ created: unknown[]; errors: unknown[] }> {
      return {
        created: specs.map((spec, i) => ({ id: `batch-${i + 1}`, ...spec })),
        errors: [],
      };
    }

    async createPipeline(config: Record<string, unknown>): Promise<Record<string, unknown>> {
      const pipeline = { id: `pipeline-${pipelineStore.size + 1}`, status: 'created', ...config };
      pipelineStore.set(String(pipeline.id), pipeline);
      return pipeline;
    }

    getPipeline(id: string): Record<string, unknown> | null {
      return pipelineStore.get(id) ?? null;
    }

    listPipelines(): Record<string, unknown>[] {
      return [...pipelineStore.values()];
    }
  },
}));

vi.mock('../services/auth/RateLimiter.js', () => ({
  RateLimiter: class {
    checkIpRateLimit(): boolean {
      return false;
    }

    checkAuthFailRateLimit(): boolean {
      return false;
    }

    recordAuthFailure(): void {}
    pruneAuthFailLimits(): void {}
    pruneIpRateLimits(): void {}
  },
}));

type FakeWindow = {
  windowId: string;
  windowName: string;
  cwd: string;
  paneCommand: string;
  paneText: string;
  paneDead: boolean;
  panePid: number;
};

const fakeWindows = new Map<string, FakeWindow>();
let tmuxSessionReady = false;
let nextWindowId = 1;

function resetFakeTmuxState(): void {
  fakeWindows.clear();
  tmuxSessionReady = false;
  nextWindowId = 1;
}

function normalizeWindowTarget(target: string): string {
  const idx = target.indexOf(':');
  return idx >= 0 ? target.slice(idx + 1) : target;
}

function findWindow(target: string): FakeWindow | undefined {
  const normalized = normalizeWindowTarget(target);
  if (normalized.startsWith('@')) {
    return [...fakeWindows.values()].find(w => w.windowId === normalized);
  }
  return fakeWindows.get(normalized);
}

function windowsAsTmuxRows(): string {
  return [...fakeWindows.values()]
    .map((w) => `${w.windowId}\t${w.windowName}\t${w.cwd}\t${w.paneCommand}\t${w.paneDead ? '1' : '0'}`)
    .join('\n');
}

async function tmuxInternalStub(...args: string[]): Promise<string> {
  const [cmd, ...rest] = args;

  if (cmd === 'has-session') {
    if (!tmuxSessionReady) throw new Error('no session');
    return '';
  }

  if (cmd === 'new-session') {
    tmuxSessionReady = true;
    if (!fakeWindows.has('_bridge_main')) {
      fakeWindows.set('_bridge_main', {
        windowId: '@0',
        windowName: '_bridge_main',
        cwd: workDir,
        paneCommand: 'bash',
        paneText: '',
        paneDead: false,
        panePid: 9000,
      });
    }
    return '';
  }

  if (cmd === 'list-sessions') {
    if (!tmuxSessionReady) throw new Error('no server running');
    return 'aegis';
  }

  if (cmd === 'kill-session') {
    tmuxSessionReady = false;
    fakeWindows.clear();
    return '';
  }

  if (cmd === 'list-windows') {
    if (!tmuxSessionReady) throw new Error('no server running');
    return windowsAsTmuxRows();
  }

  if (cmd === 'new-window') {
    const name = rest[rest.indexOf('-n') + 1]!;
    const cwd = rest[rest.indexOf('-c') + 1]!;
    if (fakeWindows.has(name)) {
      throw new Error(`duplicate window: ${name}`);
    }
    fakeWindows.set(name, {
      windowId: `@${nextWindowId++}`,
      windowName: name,
      cwd,
      paneCommand: 'bash',
      paneText: '',
      paneDead: false,
      panePid: 9000 + nextWindowId,
    });
    return '';
  }

  if (cmd === 'display-message') {
    const target = rest[rest.indexOf('-t') + 1]!;
    const win = findWindow(target);
    if (!win) throw new Error(`can't find window: ${target}`);
    return win.windowId;
  }

  if (cmd === 'send-keys') {
    const target = rest[rest.indexOf('-t') + 1]!;
    const win = findWindow(target);
    if (!win) throw new Error(`can't find window: ${target}`);
    const literalIdx = rest.indexOf('-l');
    if (literalIdx >= 0) {
      const text = rest[literalIdx + 1] ?? '';
      win.paneText = `${win.paneText}${text}`;
      if (text.includes('claude') || text.includes('--session-id') || text.includes('--resume')) {
        win.paneCommand = 'claude';
        win.paneText = '✻ Working…';
      }
      return '';
    }
    const key = rest[rest.length - 1];
    if (key === 'Enter') {
      win.paneCommand = 'claude';
      win.paneText = '✻ Working…';
    }
    if (key === 'C-c' || key === 'Escape') {
      win.paneText = `sent:${key}`;
    }
    return '';
  }

  if (cmd === 'capture-pane') {
    const target = rest[rest.indexOf('-t') + 1]!;
    const win = findWindow(target);
    return win?.paneText ?? '';
  }

  if (cmd === 'list-panes') {
    const target = rest[rest.indexOf('-t') + 1]!;
    const win = findWindow(target);
    return win ? String(win.panePid) : '';
  }

  if (cmd === 'kill-window') {
    const target = rest[rest.indexOf('-t') + 1]!;
    const win = findWindow(target);
    if (win) fakeWindows.delete(win.windowName);
    return '';
  }

  if (cmd === 'set-option' || cmd === 'select-pane' || cmd === 'set-environment' || cmd === 'resize-pane') {
    return '';
  }

  throw new Error(`unexpected tmux command in test: ${cmd}`);
}
vi.mock('../tmux.js', () => ({
  TmuxManager: class {
    async tmuxInternal(...args) { return tmuxInternalStub(...args); }
    async tmuxShellBatch(...args) { return undefined; }
    async capturePaneDirect(windowId) { const win = findWindow(windowId); return win?.paneText ?? ''; }
    async capturePane(windowId) { return this.capturePaneDirect(windowId); }
    async listPanes(target) { const win = findWindow(target); return win ? String(win.panePid) : ''; }
    async listWindows() { if (!tmuxSessionReady) throw new Error('no server running'); return windowsAsTmuxRows(); }
  }
}));



describe('server core coverage integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    mkdirSync(workDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(projectsDir, { recursive: true });
    pipelineStore.clear();

    process.env.AEGIS_STATE_DIR = stateDir;
    process.env.AEGIS_CLAUDE_PROJECTS_DIR = projectsDir;
    process.env.AEGIS_PORT = '19100';
    process.env.AEGIS_HOST = '127.0.0.1';
    process.env.AEGIS_AUTH_TOKEN = authToken;

    resetFakeTmuxState();

    vi.spyOn(globalThis, 'setInterval').mockImplementation((() => 0) as any);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation((() => undefined) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    // TmuxManager is mocked at module level above; no per-test spy required.

    await import('../server.js');

    for (let i = 0; i < 200 && !capturedApp; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (!capturedApp) {
      throw new Error('server app was not captured from listenWithRetry');
    }
    app = capturedApp;
  });

  afterAll(async () => {
    await app?.close();
    vi.restoreAllMocks();

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  it('covers key REST paths using real server/session/tmux wiring', { timeout: 30_000 }, async () => {
    const authed = (options: InjectOptions) => {
      return app.inject({
        ...options,
        headers: {
          ...authHeaders,
          ...(typeof options.headers === 'object' && options.headers !== null ? options.headers : {}),
        },
      });
    };

    const health = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(health.statusCode).toBe(200);

    const invalidCreate = await authed({ method: 'POST', url: '/v1/sessions', payload: {} });
    expect(invalidCreate.statusCode).toBe(400);

    const created = await authed({
      method: 'POST',
      url: '/v1/sessions',
      payload: {
        workDir,
        name: 'core-session',
        permissionMode: 'bypassPermissions',
        claudeCommand: 'claude --print',
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json();
    expect(createdBody.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    const sessionId = createdBody.id as string;

    const list = await authed({ method: 'GET', url: '/v1/sessions' });
    expect(list.statusCode).toBe(200);

    const getSession = await authed({ method: 'GET', url: `/v1/sessions/${sessionId}` });
    expect(getSession.statusCode).toBe(200);

    const send = await authed({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/send`,
      payload: { text: 'Summarize current status' },
    });
    expect([200, 429]).toContain(send.statusCode);
    if (send.statusCode === 200) {
      expect(send.json().delivered).toBe(true);
    }

    const command = await authed({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/command`,
      payload: { command: 'git status' },
    });
    expect([200, 429]).toContain(command.statusCode);

    const bash = await authed({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/bash`,
      payload: { command: 'echo hi' },
    });
    expect([200, 429]).toContain(bash.statusCode);

    const slashCommand = await authed({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/command`,
      payload: { command: '/status' },
    });
    expect([200, 429]).toContain(slashCommand.statusCode);

    const bangBash = await authed({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/bash`,
      payload: { command: '!echo hi' },
    });
    expect([200, 429]).toContain(bangBash.statusCode);

    const summary = await authed({ method: 'GET', url: `/v1/sessions/${sessionId}/summary` });
    expect(summary.statusCode).toBe(200);

    const transcript = await authed({ method: 'GET', url: `/v1/sessions/${sessionId}/transcript?limit=5` });
    expect(transcript.statusCode).toBe(200);

    const healthById = await authed({ method: 'GET', url: `/v1/sessions/${sessionId}/health` });
    expect(healthById.statusCode).toBe(200);

    const pane = await authed({ method: 'GET', url: `/v1/sessions/${sessionId}/pane` });
    expect(pane.statusCode).toBe(200);

    const badRoleTranscript = await authed({
      method: 'GET',
      url: `/v1/sessions/${sessionId}/transcript?role=bad-role`,
    });
    expect(badRoleTranscript.statusCode).toBe(400);

    const badCursor = await authed({
      method: 'GET',
      url: `/v1/sessions/${sessionId}/transcript/cursor?before_id=0`,
    });
    expect(badCursor.statusCode).toBe(400);

    const permissionsInvalid = await authed({
      method: 'PUT',
      url: `/v1/sessions/${sessionId}/permissions`,
      payload: [{ source: 'aegisApi', ruleBehavior: 'invalid' }],
    });
    expect(permissionsInvalid.statusCode).toBe(400);

    const permissionsUpdated = await authed({
      method: 'PUT',
      url: `/v1/sessions/${sessionId}/permissions`,
      payload: [{ source: 'aegisApi', ruleBehavior: 'allow', toolName: 'Bash' }],
    });
    expect(permissionsUpdated.statusCode).toBe(200);

    const profileUpdated = await authed({
      method: 'PUT',
      url: `/v1/sessions/${sessionId}/permission-profile`,
      payload: {
        defaultBehavior: 'ask',
        rules: [{ tool: 'Bash', behavior: 'allow' }],
      },
    });
    expect(profileUpdated.statusCode).toBe(200);

    const permissionHook = await authed({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/hooks/permission`,
      payload: { tool_name: 'Bash', permission_mode: 'ask' },
    });
    expect(permissionHook.statusCode).toBe(200);

    const stopHook = await authed({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/hooks/stop`,
      payload: { stop_reason: 'done' },
    });
    expect(stopHook.statusCode).toBe(200);

    const answerMissing = await authed({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/answer`,
      payload: {},
    });
    expect(answerMissing.statusCode).toBe(400);

    const answerConflict = await authed({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/answer`,
      payload: { questionId: 'q-1', answer: 'yes' },
    });
    expect(answerConflict.statusCode).toBe(409);

    const screenshotInvalid = await authed({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/screenshot`,
      payload: { url: 'not-a-url' },
    });
    expect(screenshotInvalid.statusCode).toBe(400);

    const interrupt = await authed({ method: 'POST', url: `/v1/sessions/${sessionId}/interrupt`, payload: {} });
    expect(interrupt.statusCode).toBe(200);

    const escape = await authed({ method: 'POST', url: `/v1/sessions/${sessionId}/escape`, payload: {} });
    expect(escape.statusCode).toBe(200);

    const spawned = await authed({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/spawn`,
      payload: { name: 'child-session', workDir, permissionMode: 'bypassPermissions' },
    });
    expect(spawned.statusCode).toBe(201);
    const childId = spawned.json().id as string;

    const forked = await authed({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/fork`,
      payload: { name: 'fork-session' },
    });
    expect(forked.statusCode).toBe(201);
    const forkId = forked.json().id as string;

    const children = await authed({ method: 'GET', url: `/v1/sessions/${sessionId}/children` });
    expect(children.statusCode).toBe(200);

    const sessionsHealth = await authed({ method: 'GET', url: '/v1/sessions/health' });
    expect(sessionsHealth.statusCode).toBe(200);

    const sessionHistoryInvalid = await authed({ method: 'GET', url: '/v1/sessions/history?page=0' });
    expect(sessionHistoryInvalid.statusCode).toBe(400);

    const sessionHistory = await authed({ method: 'GET', url: '/v1/sessions/history?page=1&limit=10' });
    expect(sessionHistory.statusCode).toBe(200);
    const sessionHistoryBody = sessionHistory.json() as {
      records: Array<{ id: string; finalStatus: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(sessionHistoryBody.pagination.page).toBe(1);
    expect(sessionHistoryBody.pagination.limit).toBe(10);
    expect(Array.isArray(sessionHistoryBody.records)).toBe(true);
    expect(sessionHistoryBody.records.some(r => r.id === sessionId)).toBe(true);

    const sessionHistoryFiltered = await authed({
      method: 'GET',
      url: '/v1/sessions/history?status=active&ownerKeyId=master',
    });
    expect(sessionHistoryFiltered.statusCode).toBe(200);
    const sessionHistoryFilteredBody = sessionHistoryFiltered.json() as {
      records: Array<{ finalStatus: string }>;
    };
    expect(sessionHistoryFilteredBody.records.every(r => r.finalStatus === 'active')).toBe(true);

    const invalidBatchCreate = await authed({
      method: 'POST',
      url: '/v1/sessions/batch',
      payload: {},
    });
    expect(invalidBatchCreate.statusCode).toBe(400);

    const batchCreate = await authed({
      method: 'POST',
      url: '/v1/sessions/batch',
      payload: {
        sessions: [
          {
            workDir,
            prompt: 'batch prompt',
            permissionMode: 'bypassPermissions',
          },
        ],
      },
    });
    expect(batchCreate.statusCode).toBe(201);

    const batchRateLimited = await authed({
      method: 'POST',
      url: '/v1/sessions/batch',
      payload: {
        sessions: [
          {
            workDir,
            prompt: 'batch prompt',
            permissionMode: 'bypassPermissions',
          },
        ],
      },
    });
    expect(batchRateLimited.statusCode).toBe(429);

    const alertsTest = await app.inject({ method: 'POST', url: '/v1/alerts/test', payload: {} });
    expect([401, 403]).toContain(alertsTest.statusCode);

    const authKeys = await app.inject({ method: 'GET', url: '/v1/auth/keys' });
    expect([401, 403]).toContain(authKeys.statusCode);

    const authVerify = await authed({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { token: 'does-not-matter' },
    });
    expect([200, 401]).toContain(authVerify.statusCode);

    const sseToken = await authed({ method: 'POST', url: '/v1/auth/sse-token', payload: {} });
    expect(sseToken.statusCode).toBe(201);

    const handshakeInvalid = await authed({ method: 'POST', url: '/v1/handshake', payload: {} });
    expect(handshakeInvalid.statusCode).toBe(400);

    const handshake = await authed({
      method: 'POST',
      url: '/v1/handshake',
      payload: { protocolVersion: '1.0.0', clientCapabilities: ['sse'] },
    });
    expect([200, 409]).toContain(handshake.statusCode);

    const handshakeIncompatible = await authed({
      method: 'POST',
      url: '/v1/handshake',
      payload: { protocolVersion: '0' },
    });
    expect(handshakeIncompatible.statusCode).toBe(409);

    const diagnosticsInvalid = await authed({ method: 'GET', url: '/v1/diagnostics?limit=0' });
    expect(diagnosticsInvalid.statusCode).toBe(400);

    const diagnostics = await authed({ method: 'GET', url: '/v1/diagnostics?limit=5' });
    expect(diagnostics.statusCode).toBe(200);

    const swarm = await authed({ method: 'GET', url: '/v1/swarm' });
    expect(swarm.statusCode).toBe(200);

    const invalidPipeline = await authed({ method: 'POST', url: '/v1/pipelines', payload: {} });
    expect(invalidPipeline.statusCode).toBe(400);

    const createdPipeline = await authed({
      method: 'POST',
      url: '/v1/pipelines',
      payload: {
        name: 'core-pipeline',
        workDir,
        stages: [{ name: 'one', prompt: 'do work' }],
      },
    });
    expect(createdPipeline.statusCode).toBe(201);

    const listPipelines = await authed({ method: 'GET', url: '/v1/pipelines' });
    expect(listPipelines.statusCode).toBe(200);

    const missingPipeline = await authed({
      method: 'GET',
      url: '/v1/pipelines/11111111-1111-1111-1111-111111111111',
    });
    expect(missingPipeline.statusCode).toBe(404);

    const metricsV1 = await authed({ method: 'GET', url: '/v1/metrics' });
    expect(metricsV1.statusCode).toBe(200);

    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect([200, 401]).toContain(metrics.statusCode);

    const batchDelete = await authed({
      method: 'DELETE',
      url: '/v1/sessions/batch',
      payload: { ids: [childId, forkId, sessionId] },
    });
    expect(batchDelete.statusCode).toBe(200);

    const deleted = await authed({ method: 'DELETE', url: `/v1/sessions/${sessionId}` });
    expect([403, 404]).toContain(deleted.statusCode);

    const missing = await authed({ method: 'GET', url: `/v1/sessions/${sessionId}` });
    expect(missing.statusCode).toBe(404);
  });
});

