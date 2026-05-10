/**
 * Issue #3114: Session export API — download full transcript as JSONL/Markdown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { registerSessionDataRoutes } from '../routes/session-data.js';
import type { RouteContext } from '../routes/context.js';
import type { SessionInfo } from '../session.js';
import type { ParsedEntry } from '../transcript.js';

const SESSION_ID = 'export-test-session';
const AUTH_TOKEN = 'test-token';

function makeSession(): SessionInfo {
  return {
    id: SESSION_ID,
    windowId: '',
    displayName: 'export-test',
    workDir: '/tmp',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 30_000,
    permissionStallMs: 60_000,
    permissionMode: 'default',
  };
}

const sampleEntries: ParsedEntry[] = [
  { role: 'user', contentType: 'text', text: 'Hello, how are you?' },
  { role: 'assistant', contentType: 'thinking', text: 'Let me think about this...' },
  { role: 'assistant', contentType: 'text', text: 'I am doing well, thanks!' },
  { role: 'assistant', contentType: 'tool_use', text: 'ReadFile', toolName: 'ReadFile', toolUseId: 'tc-1' },
  { role: 'assistant', contentType: 'tool_result', text: 'file contents here', toolUseId: 'tc-1' },
  { role: 'assistant', contentType: 'tool_error', text: 'Permission denied', toolUseId: 'tc-2' },
  { role: 'system', contentType: 'permission_request', text: 'Allow write to foo.txt' },
];

function buildApp(withData = false): { app: ReturnType<typeof Fastify>; sessions: Record<string, unknown> } {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    req.authKeyId = null;
    req.tenantId = 'system';
  });

  const session = makeSession();
  const sessions = {
    getSession: vi.fn((id: string) => id === SESSION_ID ? session : undefined),
    readTranscript: vi.fn(async () => ({
      messages: withData ? sampleEntries : [],
      total: withData ? sampleEntries.length : 0,
      page: 1,
      limit: 100_000,
      hasMore: false,
    })),
  };

  const ctx = {
    sessions,
    auth: { authEnabled: false },
    config: {},
    metrics: { getSessionMetrics: vi.fn() },
    monitor: {},
    eventBus: { subscribe: vi.fn() },
    channels: {},
    toolRegistry: { processEntries: vi.fn(), getSessionTools: vi.fn(() => []), getToolDefinitions: vi.fn(() => []) },
    sseLimiter: { acquire: vi.fn(() => ({ allowed: false, reason: 'test' })) },
  } as unknown as RouteContext;

  registerSessionDataRoutes(app, ctx);
  return { app, sessions };
}

describe('Issue #3114: Session export API', () => {
  it('returns 400 for unsupported format', async () => {
    const { app } = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/export?format=csv`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.stringContaining('Invalid format') });
    await app.close();
  });

  it('returns 404 for non-existent session', async () => {
    const { app } = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/nonexistent/export?format=jsonl',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 for session with no transcript data', async () => {
    const { app } = buildApp(false); // no data
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/export?format=jsonl`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: expect.stringContaining('No transcript data') });
    await app.close();
  });

  it('returns NDJSON for jsonl format with data', async () => {
    const { app } = buildApp(true); // with data
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/export?format=jsonl`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    expect(res.headers['content-disposition']).toContain(`session-${SESSION_ID}.jsonl`);
    
    const lines = res.body.split('\n').filter(Boolean);
    expect(lines.length).toBe(sampleEntries.length);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed).toHaveProperty('role');
      expect(parsed).toHaveProperty('contentType');
    }
    await app.close();
  });

  it('returns markdown for markdown format with data', async () => {
    const { app } = buildApp(true);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/export?format=markdown`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.headers['content-disposition']).toContain(`session-${SESSION_ID}.md`);
    expect(res.body).toContain('# Session Export');
    expect(res.body).toContain('export-test');
    expect(res.body).toContain('Hello, how are you?');
    expect(res.body).toContain('Let me think about this');
    expect(res.body).toContain('🔧 Tool: ReadFile');
    expect(res.body).toContain('<details>');
    await app.close();
  });

  it('defaults to jsonl format when no format specified', async () => {
    const { app } = buildApp(true);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/export`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    await app.close();
  });

  it('markdown includes thinking blocks', async () => {
    const { app } = buildApp(true);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/export?format=markdown`,
    });
    expect(res.body).toContain('💭 Thinking');
    expect(res.body).toContain('Let me think about this...');
    await app.close();
  });

  it('markdown includes permission request', async () => {
    const { app } = buildApp(true);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/export?format=markdown`,
    });
    expect(res.body).toContain('🔐 Permission Request');
    expect(res.body).toContain('Allow write to foo.txt');
    await app.close();
  });

  it('markdown includes tool error with warning', async () => {
    const { app } = buildApp(true);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/export?format=markdown`,
    });
    expect(res.body).toContain('⚠️ Tool error');
    expect(res.body).toContain('Permission denied');
    await app.close();
  });
});
