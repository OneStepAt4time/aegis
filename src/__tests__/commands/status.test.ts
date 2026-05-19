/**
 * status.test.ts — Tests for `ag status [session-id]` (#3673)
 *
 * Covers:
 * - Server health path (no session ID)
 * - Session detail path (session ID provided)
 * - 404 / non-OK from GET /v1/sessions/:id → error + return 1
 * - resolveSessionId failure → return 1
 * - Cost display from /v1/sessions/:id/metrics
 * - formatUptime and formatRelativeTime helper logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../cli-http.js', () => ({
  resolveBaseUrl: vi.fn(async () => 'http://127.0.0.1:9100'),
  resolveAuthToken: vi.fn(async () => ''),
  buildHeaders: vi.fn(() => ({})),
  requireServer: vi.fn(async () => true),
  writeLine: vi.fn((stream: NodeJS.WritableStream, text: string = '') => stream.write(`${text}\n`)),
}));

vi.mock('../../commands/read.js', () => ({
  resolveSessionId: vi.fn(),
  handleRead: vi.fn(),
}));

import { handleStatus } from '../../commands/status.js';
import { resolveSessionId } from '../../commands/read.js';
import { writeLine } from '../../cli-http.js';

function makeIO() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdin: process.stdin as unknown as NodeJS.ReadableStream,
      stdout: { write: (s: string) => { out.push(s); return true; } } as unknown as NodeJS.WritableStream,
      stderr: { write: (s: string) => { err.push(s); return true; } } as unknown as NodeJS.WritableStream,
    },
    getOut: () => out.join(''),
    getErr: () => err.join(''),
  };
}

const mockResolveSessionId = resolveSessionId as ReturnType<typeof vi.fn>;
const mockWriteLine = writeLine as ReturnType<typeof vi.fn>;

describe('ag status — server health (no session ID)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    mockWriteLine.mockImplementation((stream: NodeJS.WritableStream, text: string = '') => stream.write(`${text}\n`));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns 0 and prints health info', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/v1/health')) {
        return { ok: true, json: async () => ({ version: '2.5.0', status: 'healthy', uptime: 3661, port: 9100 }) };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const { io, getOut } = makeIO();
    const code = await handleStatus([], io);
    expect(code).toBe(0);
    const output = getOut();
    expect(output).toContain('2.5.0');
    expect(output).toContain('healthy');
    expect(output).toContain('1h 1m');
    expect(output).toContain('9100');
  });

  it('shows session count from stats endpoint', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/v1/health')) {
        return { ok: true, json: async () => ({ version: '1.0.0', status: 'ok', uptime: 10 }) };
      }
      if (String(url).includes('/v1/sessions/stats')) {
        return { ok: true, json: async () => ({ active: 3, total: 10 }) };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const { io, getOut } = makeIO();
    const code = await handleStatus([], io);
    expect(code).toBe(0);
    expect(getOut()).toContain('3 active / 10 total');
  });

  it('returns 1 when health check fails', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      statusText: 'Service Unavailable',
    })) as unknown as typeof fetch;

    const { io, getErr } = makeIO();
    const code = await handleStatus([], io);
    expect(code).toBe(1);
    expect(getErr()).toContain('Health check failed');
  });
});

describe('ag status <session-id> — session detail', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    mockWriteLine.mockImplementation((stream: NodeJS.WritableStream, text: string = '') => stream.write(`${text}\n`));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('displays session info when found', async () => {
    mockResolveSessionId.mockResolvedValue('abc-full-uuid-123');
    const now = Date.now();
    const createdAt = now - 90_000; // 1m 30s ago
    const lastActivity = now - 10_000; // 10s ago

    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/v1/sessions/abc-full-uuid-123/metrics')) {
        return { ok: true, json: async () => ({ tokenUsage: { estimatedCostUsd: 0.0123 } }) };
      }
      if (String(url).includes('/v1/sessions/abc-full-uuid-123')) {
        return {
          ok: true,
          json: async () => ({
            id: 'abc-full-uuid-123',
            status: 'running',
            model: 'claude-opus-4-5',
            createdAt,
            lastActivity,
          }),
        };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const { io, getOut } = makeIO();
    const code = await handleStatus(['abc'], io);
    expect(code).toBe(0);
    const output = getOut();
    expect(output).toContain('abc-full-uuid-123');
    expect(output).toContain('running');
    expect(output).toContain('claude-opus-4-5');
    expect(output).toContain('$0.0123');
    expect(output).toContain('1m');
    expect(output).toContain('10s ago');
  });

  it('returns 1 and prints error when session not found (404)', async () => {
    mockResolveSessionId.mockResolvedValue('ghost-session-id');

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    })) as unknown as typeof fetch;

    const { io, getErr } = makeIO();
    const code = await handleStatus(['ghost'], io);
    expect(code).toBe(1);
    expect(getErr()).toContain('Session not found');
  });

  it('returns 1 when resolveSessionId fails (ambiguous prefix)', async () => {
    mockResolveSessionId.mockResolvedValue(null);

    const { io } = makeIO();
    const code = await handleStatus(['am'], io);
    expect(code).toBe(1);
  });

  it('shows "n/a" cost when metrics endpoint unavailable', async () => {
    mockResolveSessionId.mockResolvedValue('session-xyz');
    const now = Date.now();

    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/metrics')) {
        return { ok: false, status: 404 };
      }
      if (String(url).includes('/v1/sessions/session-xyz')) {
        return {
          ok: true,
          json: async () => ({ id: 'session-xyz', status: 'idle', createdAt: now - 5000, lastActivity: now - 1000 }),
        };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const { io, getOut } = makeIO();
    const code = await handleStatus(['session-xyz'], io);
    expect(code).toBe(0);
    expect(getOut()).toContain('n/a');
  });

  it('omits Model line when session has no model field', async () => {
    mockResolveSessionId.mockResolvedValue('sess-no-model');
    const now = Date.now();

    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/metrics')) return { ok: false, status: 404 };
      if (String(url).includes('/v1/sessions/sess-no-model')) {
        return {
          ok: true,
          json: async () => ({ id: 'sess-no-model', status: 'completed', createdAt: now - 1000, lastActivity: now }),
        };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const { io, getOut } = makeIO();
    await handleStatus(['sess-no-model'], io);
    expect(getOut()).not.toContain('Model:');
  });
});

describe('formatUptime (via server health output)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    mockWriteLine.mockImplementation((stream: NodeJS.WritableStream, text: string = '') => stream.write(`${text}\n`));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each([
    [30, '30s'],
    [90, '1m 30s'],
    [3665, '1h 1m'],
  ])('uptime %ds → "%s"', async (uptime: number, expected: string) => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/v1/health')) {
        return { ok: true, json: async () => ({ version: '1.0', status: 'ok', uptime }) };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const { io, getOut } = makeIO();
    await handleStatus([], io);
    expect(getOut()).toContain(expected);
  });
});
