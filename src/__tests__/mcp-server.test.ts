/**
 * mcp-server.test.ts — Tests for MCP server mode (Issue #48).
 *
 * Tests the AegisClient wrapper and MCP tool definitions.
 * Uses mock fetch to avoid needing a running Aegis server.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AegisClient, createMcpServer } from '../mcp-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as { version: string };

// ── AegisClient tests ───────────────────────────────────────────────

describe('AegisClient', () => {
  const client = new AegisClient('http://127.0.0.1:9100', 'test-token');
  const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listSessions sends GET /v1/sessions', async () => {
    const mockSessions = [
      { id: 's1', status: 'idle', windowName: 'cc-1', workDir: '/tmp/a' },
      { id: 's2', status: 'working', windowName: 'cc-2', workDir: '/tmp/b' },
    ];
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessions: mockSessions, total: 2 }),
    });

    const result = await client.listSessions();
    expect(result).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9100/v1/sessions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
  });

  it('listSessions filters by status', async () => {
    const mockSessions = [
      { id: 's1', status: 'idle', windowName: 'cc-1', workDir: '/tmp/a' },
      { id: 's2', status: 'working', windowName: 'cc-2', workDir: '/tmp/b' },
    ];
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessions: mockSessions, total: 2 }),
    });

    const result = await client.listSessions({ status: 'idle' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('s1');
  });

  it('listSessions filters by workDir exact and prefix match', async () => {
    const mockSessions = [
      { id: 's1', status: 'idle', windowName: 'cc-1', workDir: '/home/user/my-project' },
      { id: 's2', status: 'working', windowName: 'cc-2', workDir: '/home/user/my-project/src' },
      { id: 's3', status: 'working', windowName: 'cc-3', workDir: '/home/user/other-project' },
    ];
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessions: mockSessions, total: 3 }),
    });

    const result = await client.listSessions({ workDir: '/home/user/my-project' });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('s1');
    expect(result[1].id).toBe('s2');
  });

  it('getSession sends GET /v1/sessions/:id', async () => {
    const mockSession = { id: UUID, status: 'idle' };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSession),
    });

    const result = await client.getSession(UUID);
    expect(result.id).toBe(UUID);
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9100/v1/sessions/${UUID}`,
      expect.anything(),
    );
  });

  it('getHealth sends GET /v1/sessions/:id/health', async () => {
    const mockHealth = { alive: true, claudeRunning: true };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockHealth),
    });

    const result = await client.getHealth(UUID);
    expect(result.alive).toBe(true);
  });

  it('getTranscript sends GET /v1/sessions/:id/read', async () => {
    const mockTranscript = { entries: [{ role: 'assistant', text: 'Hello' }] };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTranscript),
    });

    const result = await client.getTranscript(UUID);
    expect(result.entries).toHaveLength(1);
  });

  it('sendMessage sends POST /v1/sessions/:id/send', async () => {
    const mockResult = { ok: true, delivered: true, attempts: 1 };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });

    const result = await client.sendMessage(UUID, 'Hello session!');
    expect(result.delivered).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9100/v1/sessions/${UUID}/send`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'Hello session!' }),
      }),
    );
  });

  it('createSession sends POST /v1/sessions', async () => {
    const mockSession = { id: 's-new', windowName: 'cc-new', workDir: '/tmp/new' };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSession),
    });

    const result = await client.createSession({ workDir: '/tmp/new', name: 'test' });
    expect(result.id).toBe('s-new');
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9100/v1/sessions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workDir: '/tmp/new', name: 'test' }),
      }),
    );
  });

  it('throws on non-ok response', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({ error: 'Session not found' }),
    });

    await expect(client.getSession(UUID)).rejects.toThrow('Session not found');
  });

  it('throws on non-ok response with fallback error', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('not json')),
    });

    await expect(client.getSession(UUID)).rejects.toThrow('Internal Server Error');
  });

  it('works without auth token', async () => {
    const noAuthClient = new AegisClient('http://127.0.0.1:9100');
    const mockSessions: any[] = [];
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSessions),
    });

    await noAuthClient.listSessions();
    const callHeaders = (fetch as any).mock.calls[0][1].headers;
    expect(callHeaders.Authorization).toBeUndefined();
  });

  it('rejects invalid session IDs', async () => {
    await expect(client.getSession('not-a-uuid')).rejects.toThrow('Invalid session ID: not-a-uuid');
  });

  it('rejects path-traversal session IDs', async () => {
    await expect(client.getSession('a/b')).rejects.toThrow('Invalid session ID: a/b');
  });

  // ── New AegisClient method tests (Issue #441) ──

  it('killSession sends DELETE /v1/sessions/:id', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const result = await client.killSession(UUID);
    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9100/v1/sessions/${UUID}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('killSession does NOT send Content-Type header (Issue #560)', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    await client.killSession(UUID);

    const call = (fetch as any).mock.calls[0];
    const headers = call[1]?.headers as Record<string, string> | undefined;
    // Must NOT contain Content-Type — bodyless DELETE with Content-Type: application/json
    // causes Fastify to reject with 400 Bad Request
    expect(headers?.['Content-Type']).toBeUndefined();
  });

  it('approvePermission sends POST /v1/sessions/:id/approve', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const result = await client.approvePermission(UUID);
    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9100/v1/sessions/${UUID}/approve`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejectPermission sends POST /v1/sessions/:id/reject', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const result = await client.rejectPermission(UUID);
    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9100/v1/sessions/${UUID}/reject`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('getServerHealth sends GET /v1/health', async () => {
    const mockHealth = { status: 'ok', version: '1.3.0', uptime: 123, sessions: { active: 2, total: 5 } };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockHealth),
    });

    const result = await client.getServerHealth();
    expect(result.status).toBe('ok');
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9100/v1/health',
      expect.anything(),
    );
  });

  it('escapeSession sends POST /v1/sessions/:id/escape', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const result = await client.escapeSession(UUID);
    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9100/v1/sessions/${UUID}/escape`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('interruptSession sends POST /v1/sessions/:id/interrupt', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const result = await client.interruptSession(UUID);
    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9100/v1/sessions/${UUID}/interrupt`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('capturePane sends GET /v1/sessions/:id/pane', async () => {
    const mockPane = { pane: 'output text here' };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPane),
    });

    const result = await client.capturePane(UUID);
    expect(result.pane).toBe('output text here');
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9100/v1/sessions/${UUID}/pane`,
      expect.anything(),
    );
  });

  it('getSessionMetrics sends GET /v1/sessions/:id/metrics', async () => {
    const mockMetrics = { messagesSent: 5, avgLatencyMs: 120 };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockMetrics),
    });

    const result = await client.getSessionMetrics(UUID);
    expect(result.messagesSent).toBe(5);
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9100/v1/sessions/${UUID}/metrics`,
      expect.anything(),
    );
  });

  it('getSessionSummary sends GET /v1/sessions/:id/summary', async () => {
    const mockSummary = { totalMessages: 10, duration: '5m' };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSummary),
    });

    const result = await client.getSessionSummary(UUID);
    expect(result.totalMessages).toBe(10);
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9100/v1/sessions/${UUID}/summary`,
      expect.anything(),
    );
  });

  it('new methods reject invalid session IDs', async () => {
    await expect(client.killSession('bad')).rejects.toThrow('Invalid session ID: bad');
    await expect(client.approvePermission('bad')).rejects.toThrow('Invalid session ID: bad');
    await expect(client.rejectPermission('bad')).rejects.toThrow('Invalid session ID: bad');
    await expect(client.escapeSession('bad')).rejects.toThrow('Invalid session ID: bad');
    await expect(client.interruptSession('bad')).rejects.toThrow('Invalid session ID: bad');
    await expect(client.capturePane('bad')).rejects.toThrow('Invalid session ID: bad');
    await expect(client.getSessionMetrics('bad')).rejects.toThrow('Invalid session ID: bad');
    await expect(client.getSessionSummary('bad')).rejects.toThrow('Invalid session ID: bad');
  });

  // ── P2 AegisClient method tests (Issue #441) ──

  it('sendBash sends POST /v1/sessions/:id/bash', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const result = await client.sendBash(UUID, 'ls -la');
    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9100/v1/sessions/${UUID}/bash`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ command: 'ls -la' }),
      }),
    );
  });

  it('sendCommand sends POST /v1/sessions/:id/command', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const result = await client.sendCommand(UUID, 'help');
    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9100/v1/sessions/${UUID}/command`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ command: 'help' }),
      }),
    );
  });

  it('getSessionLatency sends GET /v1/sessions/:id/latency', async () => {
    const mockLatency = { avgMs: 150, p99Ms: 500 };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockLatency),
    });

    const result = await client.getSessionLatency(UUID);
    expect(result.avgMs).toBe(150);
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9100/v1/sessions/${UUID}/latency`,
      expect.anything(),
    );
  });

  it('batchCreateSessions sends POST /v1/sessions/batch', async () => {
    const mockResult = { created: 2, sessions: [{ id: 's1' }, { id: 's2' }] };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });

    const result = await client.batchCreateSessions([
      { workDir: '/tmp/a' },
      { workDir: '/tmp/b', name: 'test' },
    ]);
    expect(result.created).toBe(2);
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9100/v1/sessions/batch',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('listPipelines sends GET /v1/pipelines', async () => {
    const mockPipelines = { pipelines: [{ id: 'p1', name: 'test-pipe' }] };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPipelines),
    });

    const result = await client.listPipelines();
    expect(result.pipelines).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9100/v1/pipelines',
      expect.anything(),
    );
  });

  it('createPipeline sends POST /v1/pipelines', async () => {
    const mockPipeline = { id: 'p-new', name: 'my-pipe' };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPipeline),
    });

    const result = await client.createPipeline({ name: 'my-pipe', workDir: '/tmp', steps: [{ prompt: 'hello' }] });
    expect(result.name).toBe('my-pipe');
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9100/v1/pipelines',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('getSwarm sends GET /v1/swarm', async () => {
    const mockSwarm = { processes: [{ pid: 123, command: 'claude' }] };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSwarm),
    });

    const result = await client.getSwarm();
    expect(result.processes).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9100/v1/swarm',
      expect.anything(),
    );
  });

  it('P2 methods reject invalid session IDs', async () => {
    await expect(client.sendBash('bad', 'cmd')).rejects.toThrow('Invalid session ID: bad');
    await expect(client.sendCommand('bad', 'cmd')).rejects.toThrow('Invalid session ID: bad');
    await expect(client.getSessionLatency('bad')).rejects.toThrow('Invalid session ID: bad');
  });
});

// ── MCP server creation tests ───────────────────────────────────────

describe('createMcpServer', () => {
  it('creates an MCP server with correct name and version', () => {
    const server = createMcpServer(9100);
    // McpServer wraps a Server instance
    expect(server).toBeDefined();
    expect(server.server).toBeDefined();
  });

  it('reads version from package.json', () => {
    const server = createMcpServer(9100);
    const info = (server as any).server._serverInfo;
    expect(info.version).toBe(pkg.version);
    expect(info.name).toBe('aegis');
  });

  it('registers all 21 tools', () => {
    const server = createMcpServer(9100);
    // The internal _registeredTools is private, but we can check via the server
    // We verify by checking that the tool handler setup doesn't throw
    expect(server).toBeDefined();
    // Access internal state to verify tools are registered
    const tools = (server as any)._registeredTools;
    expect(Object.keys(tools)).toContain('list_sessions');
    expect(Object.keys(tools)).toContain('get_status');
    expect(Object.keys(tools)).toContain('get_transcript');
    expect(Object.keys(tools)).toContain('send_message');
    expect(Object.keys(tools)).toContain('create_session');
    expect(Object.keys(tools)).toContain('kill_session');
    expect(Object.keys(tools)).toContain('approve_permission');
    expect(Object.keys(tools)).toContain('reject_permission');
    expect(Object.keys(tools)).toContain('server_health');
    expect(Object.keys(tools)).toContain('escape_session');
    expect(Object.keys(tools)).toContain('interrupt_session');
    expect(Object.keys(tools)).toContain('capture_pane');
    expect(Object.keys(tools)).toContain('get_session_metrics');
    expect(Object.keys(tools)).toContain('get_session_summary');
    expect(Object.keys(tools)).toContain('send_bash');
    expect(Object.keys(tools)).toContain('send_command');
    expect(Object.keys(tools)).toContain('get_session_latency');
    expect(Object.keys(tools)).toContain('batch_create_sessions');
    expect(Object.keys(tools)).toContain('list_pipelines');
    expect(Object.keys(tools)).toContain('create_pipeline');
    expect(Object.keys(tools)).toContain('get_swarm');
    expect(Object.keys(tools)).toHaveLength(21);
  });

  it('accepts custom auth token', () => {
    const server = createMcpServer(3000, 'my-secret');
    expect(server).toBeDefined();
  });

  it('registers 4 resources (2 static + 2 template)', () => {
    const server = createMcpServer(9100);
    const resources = (server as any)._registeredResources;
    const templates = (server as any)._registeredResourceTemplates;
    // Static resources are keyed by URI
    expect(Object.keys(resources)).toContain('aegis://sessions');
    expect(Object.keys(resources)).toContain('aegis://health');
    expect(Object.keys(resources)).toHaveLength(2);
    // Template resources are keyed by name
    expect(Object.keys(templates)).toContain('session-transcript');
    expect(Object.keys(templates)).toContain('session-pane');
    expect(Object.keys(templates)).toHaveLength(2);
  });
});

// ── MCP Tool Handler execution tests (Issue #444) ────────────────────

describe('MCP Tool Handlers', () => {
  const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchOk(data: unknown): void {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    });
  }

  function mockFetchError(status: number, error: string): void {
    (fetch as any).mockResolvedValue({
      ok: false,
      status,
      statusText: error,
      json: () => Promise.resolve({ error }),
    });
  }

  function getToolHandler(name: string): (args: any) => Promise<any> {
    const server = createMcpServer(9100);
    return (server as any)._registeredTools[name].handler;
  }

  function parseResult(result: any): any {
    return JSON.parse(result.content[0].text);
  }

  // ── list_sessions handler ──

  it('list_sessions handler returns formatted session list', async () => {
    mockFetchOk({
      sessions: [
        { id: 's1', status: 'idle', windowName: 'cc-1', workDir: '/tmp/a', createdAt: '2025-01-01T00:00:00Z', lastActivity: '2025-01-01T00:01:00Z' },
      ],
      total: 1,
    });

    const handler = getToolHandler('list_sessions');
    const result = await handler({ status: undefined, workDir: undefined });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('s1');
    expect(data[0].createdAt).toBeDefined();
  });

  it('list_sessions handler passes filters to client', async () => {
    mockFetchOk({
      sessions: [
        { id: 's1', status: 'idle', windowName: 'cc-1', workDir: '/tmp/a', createdAt: '2025-01-01T00:00:00Z', lastActivity: '2025-01-01T00:01:00Z' },
        { id: 's2', status: 'working', windowName: 'cc-2', workDir: '/tmp/b', createdAt: '2025-01-01T00:00:00Z', lastActivity: '2025-01-01T00:01:00Z' },
      ],
      total: 2,
    });

    const handler = getToolHandler('list_sessions');
    const result = await handler({ status: 'idle', workDir: '/tmp/a' });
    const data = parseResult(result);
    expect(data).toHaveLength(1);
    expect(data[0].status).toBe('idle');
  });

  it('list_sessions handler returns error on failure', async () => {
    mockFetchError(500, 'Server down');
    const handler = getToolHandler('list_sessions');
    const result = await handler({ status: undefined, workDir: undefined });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Server down');
  });

  // ── get_status handler ──

  it('get_status handler returns session + health', async () => {
    let callCount = 0;
    (fetch as any).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return { ok: true, json: () => Promise.resolve({ id: UUID, status: 'idle' }) };
      return { ok: true, json: () => Promise.resolve({ alive: true, status: 'idle' }) };
    });

    const handler = getToolHandler('get_status');
    const result = await handler({ sessionId: UUID });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result);
    expect(data.id).toBe(UUID);
    expect(data.health).toEqual({ alive: true, status: 'idle' });
  });

  it('get_status handler returns error for invalid session ID', async () => {
    const handler = getToolHandler('get_status');
    const result = await handler({ sessionId: 'not-a-uuid' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid session ID');
  });

  it('get_status handler returns error on server failure', async () => {
    mockFetchError(404, 'Session not found');
    const handler = getToolHandler('get_status');
    const result = await handler({ sessionId: UUID });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Session not found');
  });

  // ── get_transcript handler ──

  it('get_transcript handler returns transcript', async () => {
    mockFetchOk({ entries: [{ role: 'assistant', text: 'Hello' }] });
    const handler = getToolHandler('get_transcript');
    const result = await handler({ sessionId: UUID });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result).entries).toHaveLength(1);
  });

  it('get_transcript handler returns error for invalid session ID', async () => {
    const handler = getToolHandler('get_transcript');
    const result = await handler({ sessionId: 'bad' });
    expect(result.isError).toBe(true);
  });

  // ── send_message handler ──

  it('send_message handler sends message', async () => {
    mockFetchOk({ ok: true, delivered: true });
    const handler = getToolHandler('send_message');
    const result = await handler({ sessionId: UUID, text: 'Hello!' });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result).delivered).toBe(true);
  });

  it('send_message handler handles special characters', async () => {
    mockFetchOk({ ok: true, delivered: true });
    const handler = getToolHandler('send_message');
    const result = await handler({ sessionId: UUID, text: 'echo "hello & world" | grep foo' });
    expect(result.isError).toBeFalsy();
  });

  it('send_message handler returns error for invalid session ID', async () => {
    const handler = getToolHandler('send_message');
    const result = await handler({ sessionId: 'bad', text: 'hi' });
    expect(result.isError).toBe(true);
  });

  // ── create_session handler ──

  it('create_session handler creates session', async () => {
    mockFetchOk({ id: 's-new', windowName: 'cc-new', workDir: '/tmp/new', promptDelivery: { delivered: true } });
    const handler = getToolHandler('create_session');
    const result = await handler({ workDir: '/tmp/new', name: 'test', prompt: 'Build it' });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result);
    expect(data.id).toBe('s-new');
    expect(data.status).toBe('created');
    expect(data.promptDelivery.delivered).toBe(true);
  });

  it('create_session handler works with minimal params', async () => {
    mockFetchOk({ id: 's-min', windowName: 'cc-min', workDir: '/tmp' });
    const handler = getToolHandler('create_session');
    const result = await handler({ workDir: '/tmp', name: undefined, prompt: undefined });
    expect(result.isError).toBeFalsy();
  });

  it('create_session handler returns error on failure', async () => {
    mockFetchError(400, 'workDir is required');
    const handler = getToolHandler('create_session');
    const result = await handler({ workDir: '', name: undefined, prompt: undefined });
    expect(result.isError).toBe(true);
  });

  // ── kill_session handler ──

  it('kill_session handler kills session', async () => {
    mockFetchOk({ ok: true });
    const handler = getToolHandler('kill_session');
    const result = await handler({ sessionId: UUID });
    expect(result.isError).toBeFalsy();
  });

  it('kill_session handler returns error for invalid session ID', async () => {
    const handler = getToolHandler('kill_session');
    const result = await handler({ sessionId: 'bad' });
    expect(result.isError).toBe(true);
  });

  // ── approve_permission handler ──

  it('approve_permission handler approves', async () => {
    mockFetchOk({ ok: true });
    const handler = getToolHandler('approve_permission');
    const result = await handler({ sessionId: UUID });
    expect(result.isError).toBeFalsy();
  });

  it('approve_permission handler returns error for invalid session ID', async () => {
    const handler = getToolHandler('approve_permission');
    const result = await handler({ sessionId: 'bad' });
    expect(result.isError).toBe(true);
  });

  // ── reject_permission handler ──

  it('reject_permission handler rejects', async () => {
    mockFetchOk({ ok: true });
    const handler = getToolHandler('reject_permission');
    const result = await handler({ sessionId: UUID });
    expect(result.isError).toBeFalsy();
  });

  it('reject_permission handler returns error for invalid session ID', async () => {
    const handler = getToolHandler('reject_permission');
    const result = await handler({ sessionId: 'bad' });
    expect(result.isError).toBe(true);
  });

  // ── server_health handler ──

  it('server_health handler returns health', async () => {
    mockFetchOk({ status: 'ok', version: '1.5.0' });
    const handler = getToolHandler('server_health');
    const result = await handler({});
    expect(result.isError).toBeFalsy();
    expect(parseResult(result).status).toBe('ok');
  });

  it('server_health handler returns error on failure', async () => {
    mockFetchError(503, 'Service Unavailable');
    const handler = getToolHandler('server_health');
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Service Unavailable');
  });

  // ── escape_session handler ──

  it('escape_session handler sends escape', async () => {
    mockFetchOk({ ok: true });
    const handler = getToolHandler('escape_session');
    const result = await handler({ sessionId: UUID });
    expect(result.isError).toBeFalsy();
  });

  it('escape_session handler returns error for invalid session ID', async () => {
    const handler = getToolHandler('escape_session');
    const result = await handler({ sessionId: 'bad' });
    expect(result.isError).toBe(true);
  });

  // ── interrupt_session handler ──

  it('interrupt_session handler sends interrupt', async () => {
    mockFetchOk({ ok: true });
    const handler = getToolHandler('interrupt_session');
    const result = await handler({ sessionId: UUID });
    expect(result.isError).toBeFalsy();
  });

  it('interrupt_session handler returns error for invalid session ID', async () => {
    const handler = getToolHandler('interrupt_session');
    const result = await handler({ sessionId: 'bad' });
    expect(result.isError).toBe(true);
  });

  // ── capture_pane handler ──

  it('capture_pane handler returns pane content', async () => {
    mockFetchOk({ pane: 'output text' });
    const handler = getToolHandler('capture_pane');
    const result = await handler({ sessionId: UUID });
    expect(result.isError).toBeFalsy();
  });

  it('capture_pane handler returns error for invalid session ID', async () => {
    const handler = getToolHandler('capture_pane');
    const result = await handler({ sessionId: 'bad' });
    expect(result.isError).toBe(true);
  });

  // ── get_session_metrics handler ──

  it('get_session_metrics handler returns metrics', async () => {
    mockFetchOk({ messagesSent: 5, avgLatencyMs: 120 });
    const handler = getToolHandler('get_session_metrics');
    const result = await handler({ sessionId: UUID });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result).messagesSent).toBe(5);
  });

  it('get_session_metrics handler returns error for invalid session ID', async () => {
    const handler = getToolHandler('get_session_metrics');
    const result = await handler({ sessionId: 'bad' });
    expect(result.isError).toBe(true);
  });

  // ── get_session_summary handler ──

  it('get_session_summary handler returns summary', async () => {
    mockFetchOk({ totalMessages: 10, duration: '5m' });
    const handler = getToolHandler('get_session_summary');
    const result = await handler({ sessionId: UUID });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result).totalMessages).toBe(10);
  });

  it('get_session_summary handler returns error for invalid session ID', async () => {
    const handler = getToolHandler('get_session_summary');
    const result = await handler({ sessionId: 'bad' });
    expect(result.isError).toBe(true);
  });

  // ── send_bash handler ──

  it('send_bash handler sends command', async () => {
    mockFetchOk({ ok: true });
    const handler = getToolHandler('send_bash');
    const result = await handler({ sessionId: UUID, command: 'ls -la' });
    expect(result.isError).toBeFalsy();
  });

  it('send_bash handler handles special characters in command', async () => {
    mockFetchOk({ ok: true });
    const handler = getToolHandler('send_bash');
    const result = await handler({ sessionId: UUID, command: 'echo "hello & world" | grep <foo>' });
    expect(result.isError).toBeFalsy();
  });

  it('send_bash handler returns error for invalid session ID', async () => {
    const handler = getToolHandler('send_bash');
    const result = await handler({ sessionId: 'bad', command: 'ls' });
    expect(result.isError).toBe(true);
  });

  // ── send_command handler ──

  it('send_command handler sends slash command', async () => {
    mockFetchOk({ ok: true });
    const handler = getToolHandler('send_command');
    const result = await handler({ sessionId: UUID, command: 'help' });
    expect(result.isError).toBeFalsy();
  });

  it('send_command handler returns error for invalid session ID', async () => {
    const handler = getToolHandler('send_command');
    const result = await handler({ sessionId: 'bad', command: 'help' });
    expect(result.isError).toBe(true);
  });

  // ── get_session_latency handler ──

  it('get_session_latency handler returns latency', async () => {
    mockFetchOk({ avgMs: 150, p99Ms: 500 });
    const handler = getToolHandler('get_session_latency');
    const result = await handler({ sessionId: UUID });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result).avgMs).toBe(150);
  });

  it('get_session_latency handler returns error for invalid session ID', async () => {
    const handler = getToolHandler('get_session_latency');
    const result = await handler({ sessionId: 'bad' });
    expect(result.isError).toBe(true);
  });

  // ── batch_create_sessions handler ──

  it('batch_create_sessions handler creates batch', async () => {
    mockFetchOk({ created: 2, sessions: [{ id: 's1' }, { id: 's2' }] });
    const handler = getToolHandler('batch_create_sessions');
    const result = await handler({ sessions: [{ workDir: '/tmp/a' }, { workDir: '/tmp/b', name: 'test' }] });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result).created).toBe(2);
  });

  it('batch_create_sessions handler returns error on failure', async () => {
    mockFetchError(400, 'Invalid batch');
    const handler = getToolHandler('batch_create_sessions');
    const result = await handler({ sessions: [] });
    expect(result.isError).toBe(true);
  });

  // ── list_pipelines handler ──

  it('list_pipelines handler returns pipelines', async () => {
    mockFetchOk({ pipelines: [{ id: 'p1', name: 'test' }] });
    const handler = getToolHandler('list_pipelines');
    const result = await handler({});
    expect(result.isError).toBeFalsy();
    expect(parseResult(result).pipelines).toHaveLength(1);
  });

  it('list_pipelines handler returns error on failure', async () => {
    mockFetchError(500, 'Server error');
    const handler = getToolHandler('list_pipelines');
    const result = await handler({});
    expect(result.isError).toBe(true);
  });

  // ── create_pipeline handler ──

  it('create_pipeline handler creates pipeline', async () => {
    mockFetchOk({ id: 'p-new', name: 'my-pipe' });
    const handler = getToolHandler('create_pipeline');
    const result = await handler({ name: 'my-pipe', workDir: '/tmp', steps: [{ prompt: 'hello' }] });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result).name).toBe('my-pipe');
  });

  it('create_pipeline handler returns error on failure', async () => {
    mockFetchError(400, 'Steps required');
    const handler = getToolHandler('create_pipeline');
    const result = await handler({ name: 'x', workDir: '/tmp', steps: [] });
    expect(result.isError).toBe(true);
  });

  // ── get_swarm handler ──

  it('get_swarm handler returns swarm', async () => {
    mockFetchOk({ processes: [{ pid: 123, command: 'claude' }] });
    const handler = getToolHandler('get_swarm');
    const result = await handler({});
    expect(result.isError).toBeFalsy();
    expect(parseResult(result).processes).toHaveLength(1);
  });

  it('get_swarm handler returns error on failure', async () => {
    mockFetchError(500, 'Server error');
    const handler = getToolHandler('get_swarm');
    const result = await handler({});
    expect(result.isError).toBe(true);
  });

  // ── Auth header propagation ──

  it('tool handlers propagate auth token', async () => {
    const server = createMcpServer(9100, 'my-secret');
    const handler = (server as any)._registeredTools.server_health.handler;
    mockFetchOk({ status: 'ok' });

    await handler({});
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9100/v1/health',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer my-secret' }),
      }),
    );
  });

  // ── Error envelope format (Issue #445) ──

  it('error responses use structured JSON envelope with code and message', async () => {
    mockFetchError(500, 'Server down');
    const handler = getToolHandler('list_sessions');
    const result = await handler({ status: undefined, workDir: undefined });
    expect(result.isError).toBe(true);
    const envelope = JSON.parse(result.content[0].text);
    expect(envelope.code).toBe('REQUEST_FAILED');
    expect(envelope.message).toContain('Server down');
  });

  it('invalid session ID errors have INVALID_SESSION_ID code', async () => {
    const handler = getToolHandler('get_status');
    const result = await handler({ sessionId: 'not-a-uuid' });
    expect(result.isError).toBe(true);
    const envelope = JSON.parse(result.content[0].text);
    expect(envelope.code).toBe('INVALID_SESSION_ID');
    expect(envelope.message).toContain('Invalid session ID');
  });

  it('returns SERVER_UNREACHABLE when Aegis is down', async () => {
    const connRefused = new TypeError('fetch failed');
    (connRefused as any).cause = { code: 'ECONNREFUSED' };
    (fetch as any).mockRejectedValue(connRefused);

    const handler = getToolHandler('server_health');
    const result = await handler({});
    expect(result.isError).toBe(true);
    const envelope = JSON.parse(result.content[0].text);
    expect(envelope.code).toBe('SERVER_UNREACHABLE');
    expect(envelope.message).toContain('not running');
  });

  it('returns SERVER_UNREACHABLE for generic network errors', async () => {
    (fetch as any).mockRejectedValue(new TypeError('fetch failed'));

    const handler = getToolHandler('list_sessions');
    const result = await handler({ status: undefined, workDir: undefined });
    expect(result.isError).toBe(true);
    const envelope = JSON.parse(result.content[0].text);
    expect(envelope.code).toBe('SERVER_UNREACHABLE');
    expect(envelope.message).toContain('Network error');
  });
});

// ── Edge case tests for AegisClient ──────────────────────────────────

describe('AegisClient edge cases', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encodes session ID in URL', async () => {
    const client = new AegisClient('http://127.0.0.1:9100');
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    (fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: uuid }) });

    await client.getSession(uuid);
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:9100/v1/sessions/${uuid}`,
      expect.anything(),
    );
  });

  it('rejects empty string session ID', async () => {
    const client = new AegisClient('http://127.0.0.1:9100');
    await expect(client.getSession('')).rejects.toThrow('Invalid session ID');
  });

  it('rejects session ID with spaces', async () => {
    const client = new AegisClient('http://127.0.0.1:9100');
    await expect(client.getSession('aaaa bbbb')).rejects.toThrow('Invalid session ID');
  });

  it('handles auth failure (401)', async () => {
    const client = new AegisClient('http://127.0.0.1:9100', 'bad-token');
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ error: 'Invalid token' }),
    });

    await expect(client.listSessions()).rejects.toThrow('Invalid token');
  });

  it('handles network error (fetch rejects)', async () => {
    const client = new AegisClient('http://127.0.0.1:9100');
    (fetch as any).mockRejectedValue(new TypeError('fetch failed'));

    await expect(client.getServerHealth()).rejects.toThrow('Network error: fetch failed');
  });

  it('handles ECONNREFUSED with clear message', async () => {
    const client = new AegisClient('http://127.0.0.1:9100');
    const err = new TypeError('fetch failed');
    (err as any).cause = { code: 'ECONNREFUSED' };
    (fetch as any).mockRejectedValue(err);

    await expect(client.getServerHealth()).rejects.toThrow('Aegis server is not running or not reachable');
  });

  it('listSessions returns empty array when no sessions', async () => {
    const client = new AegisClient('http://127.0.0.1:9100');
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessions: [], total: 0 }),
    });

    const result = await client.listSessions();
    expect(result).toEqual([]);
  });

  it('sendMessage with special characters in text', async () => {
    const client = new AegisClient('http://127.0.0.1:9100');
    const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    (fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });

    await client.sendMessage(UUID, 'echo "hello & world" | grep <foo>');
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ text: 'echo "hello & world" | grep <foo>' }),
      }),
    );
  });

  it('createSession with optional params omitted', async () => {
    const client = new AegisClient('http://127.0.0.1:9100');
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 's1', workDir: '/tmp' }),
    });

    await client.createSession({ workDir: '/tmp' });
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ workDir: '/tmp' }),
      }),
    );
  });

  it('sendBash with special characters in command', async () => {
    const client = new AegisClient('http://127.0.0.1:9100');
    const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    (fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });

    await client.sendBash(UUID, 'rm -rf /tmp/test && echo "done"');
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ command: 'rm -rf /tmp/test && echo "done"' }),
      }),
    );
  });
});

// ── MCP Resource read callback tests (Issue #442) ───────────────────

describe('MCP Resources', () => {
  const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper: extract text from contents[0] (always text in our resources)
  function getText(contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>): string {
    return (contents[0] as { text: string }).text;
  }

  // Helper: extract static resource readCallback by URI
  function getResourceCallback(uri: string): (uri: URL, extra?: any) => Promise<import('@modelcontextprotocol/sdk/types.js').ReadResourceResult> {
    const server = createMcpServer(9100);
    const resources = (server as any)._registeredResources;
    return resources[uri].readCallback;
  }

  // Helper: extract template resource readCallback by name
  function getTemplateResourceCallback(name: string): (uri: URL, variables: Record<string, string>, extra?: any) => Promise<import('@modelcontextprotocol/sdk/types.js').ReadResourceResult> {
    const server = createMcpServer(9100);
    const templates = (server as any)._registeredResourceTemplates;
    return templates[name].readCallback;
  }

  // ── aegis://sessions ──

  describe('aegis://sessions', () => {
    it('returns compact session list', async () => {
      const mockSessions = [
        { id: 's1', status: 'idle', windowName: 'cc-1', workDir: '/tmp/a', createdAt: '2025-01-01T00:00:00Z', lastActivity: '2025-01-01T00:01:00Z' },
        { id: 's2', status: 'working', windowName: 'cc-2', workDir: '/tmp/b', createdAt: '2025-01-01T00:00:00Z', lastActivity: '2025-01-01T00:02:00Z' },
      ];
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sessions: mockSessions, total: 2 }),
      });

      const cb = getResourceCallback('aegis://sessions');
      const result = await cb(new URL('aegis://sessions'));

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('application/json');
      const parsed = JSON.parse(getText(result.contents));
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({ id: 's1', name: 'cc-1', status: 'idle', workDir: '/tmp/a' });
      expect(parsed[1]).toEqual({ id: 's2', name: 'cc-2', status: 'working', workDir: '/tmp/b' });
    });

    it('returns error on fetch failure', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('not json')),
      });

      const cb = getResourceCallback('aegis://sessions');
      const result = await cb(new URL('aegis://sessions'));

      expect(getText(result.contents)).toContain('Error:');
    });
  });

  // ── aegis://sessions/{id}/transcript ──

  describe('aegis://sessions/{id}/transcript', () => {
    it('returns transcript for valid session ID', async () => {
      const mockTranscript = { entries: [{ role: 'assistant', text: 'Hello' }] };
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTranscript),
      });

      const cb = getTemplateResourceCallback('session-transcript');
      const result = await cb(new URL(`aegis://sessions/${UUID}/transcript`), { id: UUID });

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('application/json');
      const parsed = JSON.parse(getText(result.contents));
      expect(parsed.entries).toHaveLength(1);
    });

    it('returns error for invalid session ID', async () => {
      const cb = getTemplateResourceCallback('session-transcript');
      const result = await cb(new URL('aegis://sessions/bad-id/transcript'), { id: 'bad-id' });

      expect(getText(result.contents)).toContain('Invalid session ID');
    });

    it('returns error on fetch failure', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'Session not found' }),
      });

      const cb = getTemplateResourceCallback('session-transcript');
      const result = await cb(new URL(`aegis://sessions/${UUID}/transcript`), { id: UUID });

      expect(getText(result.contents)).toContain('Session not found');
    });
  });

  // ── aegis://sessions/{id}/pane ──

  describe('aegis://sessions/{id}/pane', () => {
    it('returns pane text for valid session ID', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ pane: '$ ls -la\ntotal 42' }),
      });

      const cb = getTemplateResourceCallback('session-pane');
      const result = await cb(new URL(`aegis://sessions/${UUID}/pane`), { id: UUID });

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('text/plain');
      expect(getText(result.contents)).toBe('$ ls -la\ntotal 42');
    });

    it('returns error for invalid session ID', async () => {
      const cb = getTemplateResourceCallback('session-pane');
      const result = await cb(new URL('aegis://sessions/bad/pane'), { id: 'bad' });

      expect(getText(result.contents)).toContain('Invalid session ID');
    });

    it('returns error on fetch failure', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        json: () => Promise.reject(new Error('not json')),
      });

      const cb = getTemplateResourceCallback('session-pane');
      const result = await cb(new URL(`aegis://sessions/${UUID}/pane`), { id: UUID });

      expect(getText(result.contents)).toContain('Error:');
    });
  });

  // ── aegis://health ──

  describe('aegis://health', () => {
    it('returns server health JSON', async () => {
      const mockHealth = { status: 'ok', version: '1.5.0', uptime: 600, sessions: { active: 3, total: 10 } };
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockHealth),
      });

      const cb = getResourceCallback('aegis://health');
      const result = await cb(new URL('aegis://health'));

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('application/json');
      const parsed = JSON.parse(getText(result.contents));
      expect(parsed.status).toBe('ok');
      expect(parsed.version).toBe('1.5.0');
    });

    it('returns error on fetch failure', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: () => Promise.reject(new Error('not json')),
      });

      const cb = getResourceCallback('aegis://health');
      const result = await cb(new URL('aegis://health'));

      expect(getText(result.contents)).toContain('Error:');
    });
  });

  describe('MCP Prompts', () => {
  // ── MCP Prompts tests (Issue #443) ──

  it('registers 3 prompts', () => {
    const server = createMcpServer(9100);
    const prompts = (server as any)._registeredPrompts;
    const names = Object.keys(prompts);
    expect(names).toContain('implement_issue');
    expect(names).toContain('review_pr');
    expect(names).toContain('debug_session');
    expect(names).toHaveLength(3);
  });

  it('implement_issue prompt returns structured message', async () => {
    const server = createMcpServer(9100);
    const prompts = (server as any)._registeredPrompts;
    const result = await prompts.implement_issue.callback({
      issueNumber: '443',
      workDir: '/home/user/aegis',
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    const text = result.messages[0].content.text;
    expect(text).toContain('OneStepAt4time/aegis#443');
    expect(text).toContain('/home/user/aegis');
    expect(text).toContain('implementing');
    expect(text).toContain('create_session');
  });

  it('implement_issue prompt uses custom repo owner/name', async () => {
    const server = createMcpServer(9100);
    const prompts = (server as any)._registeredPrompts;
    const result = await prompts.implement_issue.callback({
      issueNumber: '99',
      workDir: '/tmp',
      repoOwner: 'myorg',
      repoName: 'myrepo',
    });
    const text = result.messages[0].content.text;
    expect(text).toContain('myorg/myrepo#99');
    expect(text).toContain('https://github.com/myorg/myrepo/issues/99');
  });

  it('review_pr prompt returns structured message', async () => {
    const server = createMcpServer(9100);
    const prompts = (server as any)._registeredPrompts;
    const result = await prompts.review_pr.callback({
      prNumber: '123',
      workDir: '/home/user/aegis',
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    const text = result.messages[0].content.text;
    expect(text).toContain('OneStepAt4time/aegis#123');
    expect(text).toContain('reviewing');
    expect(text).toContain('gh pr view 123');
    expect(text).toContain('gh pr diff 123');
  });

  it('review_pr prompt uses custom repo owner/name', async () => {
    const server = createMcpServer(9100);
    const prompts = (server as any)._registeredPrompts;
    const result = await prompts.review_pr.callback({
      prNumber: '42',
      workDir: '/tmp',
      repoOwner: 'other',
      repoName: 'project',
    });
    const text = result.messages[0].content.text;
    expect(text).toContain('other/project#42');
    expect(text).toContain('https://github.com/other/project/pull/42');
  });

  it('debug_session prompt returns structured message', async () => {
    const server = createMcpServer(9100);
    const prompts = (server as any)._registeredPrompts;
    const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const result = await prompts.debug_session.callback({
      sessionId: UUID,
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    const text = result.messages[0].content.text;
    expect(text).toContain(UUID);
    expect(text).toContain('diagnosing');
    expect(text).toContain('get_status');
    expect(text).toContain('get_transcript');
    expect(text).toContain('capture_pane');
  });
});
});
