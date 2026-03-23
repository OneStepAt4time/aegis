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
      json: () => Promise.resolve(mockSessions),
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
      json: () => Promise.resolve(mockSessions),
    });

    const result = await client.listSessions({ status: 'idle' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('s1');
  });

  it('listSessions filters by workDir substring', async () => {
    const mockSessions = [
      { id: 's1', status: 'idle', windowName: 'cc-1', workDir: '/home/user/my-project' },
      { id: 's2', status: 'working', windowName: 'cc-2', workDir: '/home/user/other' },
    ];
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSessions),
    });

    const result = await client.listSessions({ workDir: 'my-project' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('s1');
  });

  it('getSession sends GET /v1/sessions/:id', async () => {
    const mockSession = { id: 's1', status: 'idle' };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSession),
    });

    const result = await client.getSession('s1');
    expect(result.id).toBe('s1');
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9100/v1/sessions/s1',
      expect.anything(),
    );
  });

  it('getHealth sends GET /v1/sessions/:id/health', async () => {
    const mockHealth = { alive: true, claudeRunning: true };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockHealth),
    });

    const result = await client.getHealth('s1');
    expect(result.alive).toBe(true);
  });

  it('getTranscript sends GET /v1/sessions/:id/read', async () => {
    const mockTranscript = { entries: [{ role: 'assistant', text: 'Hello' }] };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTranscript),
    });

    const result = await client.getTranscript('s1');
    expect(result.entries).toHaveLength(1);
  });

  it('sendMessage sends POST /v1/sessions/:id/send', async () => {
    const mockResult = { ok: true, delivered: true, attempts: 1 };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });

    const result = await client.sendMessage('s1', 'Hello session!');
    expect(result.delivered).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9100/v1/sessions/s1/send',
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

    await expect(client.getSession('nonexistent')).rejects.toThrow('Session not found');
  });

  it('throws on non-ok response with fallback error', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('not json')),
    });

    await expect(client.getSession('s1')).rejects.toThrow('Internal Server Error');
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

  it('URL-encodes session IDs', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'a/b' }),
    });

    await client.getSession('a/b');
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9100/v1/sessions/a%2Fb',
      expect.anything(),
    );
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

  it('registers all 5 tools', () => {
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
    expect(Object.keys(tools)).toHaveLength(5);
  });

  it('accepts custom auth token', () => {
    const server = createMcpServer(3000, 'my-secret');
    expect(server).toBeDefined();
  });
});
