/**
 * tail.test.ts — Tests for `ag tail <id>` (#4461)
 *
 * Covers:
 * - Missing session ID → error
 * - resolveSessionId failure → return 1
 * - Session in terminal state (killed) → clear error message, no SSE attempt
 * - Session in active state → proceeds to SSE
 * - SSE token failure → improved auth message
 * - SSE 401 response → improved auth message
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../cli-http.js', () => ({
  resolveBaseUrl: vi.fn(async () => 'http://127.0.0.1:9100'),
  resolveAuthToken: vi.fn(async () => 'test-token'),
  buildHeaders: vi.fn(() => ({})),
  requireServer: vi.fn(async () => true),
  writeLine: vi.fn((stream: NodeJS.WritableStream, text: string = '') => stream.write(`${text}\n`)),
}));

vi.mock('../../commands/read.js', () => ({
  resolveSessionId: vi.fn(),
}));

import { handleTail } from '../../commands/tail.js';
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

describe('ag tail (#4461)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    mockWriteLine.mockImplementation((stream: NodeJS.WritableStream, text: string = '') => stream.write(`${text}\n`));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should error when no session ID provided', async () => {
    const { io, getErr } = makeIO();
    const code = await handleTail([], io);
    expect(code).toBe(1);
    expect(getErr()).toContain('Missing session ID');
  });

  it('should return 1 when resolveSessionId returns null', async () => {
    mockResolveSessionId.mockResolvedValue(null);
    const { io, getErr } = makeIO();
    const code = await handleTail(['abc123'], io);
    expect(code).toBe(1);
  });

  it('should show clear message for killed session instead of SSE auth error', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    mockResolveSessionId.mockResolvedValue(sessionId);

    // Mock fetch: status endpoint returns killed, should not reach SSE
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/status')) {
        return new Response(JSON.stringify({ id: sessionId, status: 'killed' }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'should not reach' }), { status: 500 });
    }) as typeof globalThis.fetch;

    const { io, getErr } = makeIO();
    const code = await handleTail([sessionId], io);
    expect(code).toBe(1);
    expect(getErr()).toContain('Session is killed');
    expect(getErr()).toContain('ag list');

    // Verify SSE token endpoint was NOT called
    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const sseTokenCalls = fetchCalls.filter((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('/sse-token'));
    expect(sseTokenCalls.length).toBe(0);
  });

  it('should show clear message for error-status session', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    mockResolveSessionId.mockResolvedValue(sessionId);

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/status')) {
        return new Response(JSON.stringify({ id: sessionId, status: 'error' }), { status: 200 });
      }
      return new Response('not reached', { status: 500 });
    }) as typeof globalThis.fetch;

    const { io, getErr } = makeIO();
    const code = await handleTail([sessionId], io);
    expect(code).toBe(1);
    expect(getErr()).toContain('Session is error');
  });

  it('should proceed to SSE for active (idle) session', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    mockResolveSessionId.mockResolvedValue(sessionId);

    // Create a readable stream that immediately ends (simulates SSE close)
    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    globalThis.fetch = vi.fn(async (url: string | URL | Request, opts?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/status')) {
        return new Response(JSON.stringify({ id: sessionId, status: 'idle' }), { status: 200 });
      }
      if (urlStr.includes('/sse-token')) {
        return new Response(JSON.stringify({ token: 'sse_test_token' }), { status: 200 });
      }
      // SSE stream — return readable stream that closes immediately
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as typeof globalThis.fetch;

    const { io, getOut } = makeIO();
    const code = await handleTail([sessionId], io);
    expect(code).toBe(0);

    // Should have attempted SSE connection
    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const sseTokenCalls = fetchCalls.filter((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('/sse-token'));
    expect(sseTokenCalls.length).toBe(1);
    const eventsCalls = fetchCalls.filter((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('/events'));
    expect(eventsCalls.length).toBe(1);
  });

  it('should show improved auth message when SSE token fails', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    mockResolveSessionId.mockResolvedValue(sessionId);

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/status')) {
        return new Response(JSON.stringify({ id: sessionId, status: 'idle' }), { status: 200 });
      }
      if (urlStr.includes('/sse-token')) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
      }
      return new Response('not reached', { status: 500 });
    }) as typeof globalThis.fetch;

    const { io, getErr } = makeIO();
    const code = await handleTail([sessionId], io);
    expect(code).toBe(1);
    expect(getErr()).toContain('Authentication failed');
    expect(getErr()).toContain('ag init');
  });
});
