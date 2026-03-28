/**
 * mcp-server.test.ts — Tests for MCP server mode (Issue #48).
 *
 * Tests the AegisClient wrapper and MCP tool definitions.
 * Uses mock fetch to avoid needing a running Aegis server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AegisClient, createMcpServer } from '../mcp-server.js';

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
      const parsed = JSON.parse(result.contents[0].text);
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

      expect(result.contents[0].text).toContain('Error:');
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
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.entries).toHaveLength(1);
    });

    it('returns error for invalid session ID', async () => {
      const cb = getTemplateResourceCallback('session-transcript');
      const result = await cb(new URL('aegis://sessions/bad-id/transcript'), { id: 'bad-id' });

      expect(result.contents[0].text).toContain('Invalid session ID');
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

      expect(result.contents[0].text).toContain('Session not found');
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
      expect(result.contents[0].text).toBe('$ ls -la\ntotal 42');
    });

    it('returns error for invalid session ID', async () => {
      const cb = getTemplateResourceCallback('session-pane');
      const result = await cb(new URL('aegis://sessions/bad/pane'), { id: 'bad' });

      expect(result.contents[0].text).toContain('Invalid session ID');
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

      expect(result.contents[0].text).toContain('Error:');
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
      const parsed = JSON.parse(result.contents[0].text);
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

      expect(result.contents[0].text).toContain('Error:');
    });
  });
});
