/**
 * tail-sse-retry.test.ts — Tests for #3566: SSE token retry flow in `ag tail`.
 *
 * Covers:
 * 1. Initial 401 → fetch SSE token → reconnect → successful stream
 * 2. SSE token fetch failure (bearer token invalid) → clear error
 * 3. Successful first connection (no SSE token needed — e.g. localhost no-auth mode)
 * 4. SSE token fetch returns 401 → clear error message
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the handleTail function directly by mocking fetch.
// Since tail.ts uses node:readline and platform-specific logic,
// we focus on the HTTP retry behavior by testing fetchSSEToken
// and the overall flow through handleTail with controlled mocks.

import { Writable } from 'node:stream';

// Helper to create a mock CliIO
function createMockIO() {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdout = new Writable({ write: (chunk, _enc, cb) => { stdoutChunks.push(chunk.toString()); cb(); } });
  const stderr = new Writable({ write: (chunk, _enc, cb) => { stderrChunks.push(chunk.toString()); cb(); } });
  return {
    io: {
      stdin: process.stdin,
      stdout,
      stderr,
    },
    getStdout: () => stdoutChunks.join(''),
    getStderr: () => stderrChunks.join(''),
  };
}

// Mock modules before importing
vi.mock('../cli-http.js', () => ({
  resolveBaseUrl: vi.fn().mockResolvedValue('http://localhost:9100'),
  resolveAuthToken: vi.fn().mockResolvedValue('test-bearer-token'),
  buildHeaders: vi.fn().mockReturnValue({ Authorization: 'Bearer test-bearer-token' }),
  requireServer: vi.fn().mockResolvedValue(true),
  writeLine: (stream: NodeJS.WritableStream, text: string = '') => {
    stream.write(`${text}\n`);
  },
}));

// Import after mocks
import { handleTail } from '../commands/tail.js';

describe('ag tail — SSE token retry flow (#3566)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should fetch SSE token and reconnect when initial SSE request returns 401', async () => {
    const { io, getStdout, getStderr } = createMockIO();

    const sseEventsUrl = 'http://localhost:9100/v1/sessions/test-session/events';
    const sseTokenUrl = 'http://localhost:9100/v1/auth/sse-token';
    const sseTokenWithQuery = 'http://localhost:9100/v1/sessions/test-session/events?token=sse_test-token-123';

    let fetchCallCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCallCount++;
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

      // First call: SSE endpoint with bearer token → 401
      if (urlStr === sseEventsUrl && fetchCallCount === 1) {
        return new Response(JSON.stringify({ error: 'Unauthorized — SSE token required for event streams' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Second call: POST /v1/auth/sse-token → success
      if (urlStr === sseTokenUrl && init?.method === 'POST') {
        return new Response(JSON.stringify({ token: 'sse_test-token-123', expiresAt: Date.now() + 300_000 }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Third call: SSE endpoint with ?token= → success with stream
      if (urlStr === sseTokenWithQuery) {
        const encoder = new TextEncoder();
        const events = [
          'data: {"type":"assistant","content":"Hello"}\n\n',
          'data: [DONE]\n\n',
        ];
        const body = new ReadableStream({
          start(controller) {
            for (const event of events) {
              controller.enqueue(encoder.encode(event));
            }
            controller.close();
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    const result = await handleTail(['test-session'], io);

    expect(result).toBe(0);
    expect(fetchCallCount).toBe(3);
    expect(getStdout()).toContain('SSE token required');
    expect(getStdout()).toContain('🤖 Hello');
  });

  it('should show clear error when SSE token fetch fails (401)', async () => {
    const { io, getStdout, getStderr } = createMockIO();

    const sseEventsUrl = 'http://localhost:9100/v1/sessions/test-session/events';
    const sseTokenUrl = 'http://localhost:9100/v1/auth/sse-token';

    let fetchCallCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCallCount++;
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

      // First call: SSE endpoint → 401
      if (urlStr === sseEventsUrl && fetchCallCount === 1) {
        return new Response(JSON.stringify({ error: 'Unauthorized — SSE token required for event streams' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Second call: POST /v1/auth/sse-token → 401 (invalid bearer)
      if (urlStr === sseTokenUrl && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'Unauthorized — invalid API key' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    const result = await handleTail(['test-session'], io);

    expect(result).toBe(1);
    expect(fetchCallCount).toBe(2);
    expect(getStderr()).toContain('Failed to obtain SSE token');
    expect(getStderr()).toContain('ag login');
  });

  it('should succeed without SSE token when first request succeeds (no-auth localhost)', async () => {
    const { io, getStdout, getStderr } = createMockIO();

    const sseEventsUrl = 'http://localhost:9100/v1/sessions/test-session/events';

    let fetchCallCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      fetchCallCount++;
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

      if (urlStr === sseEventsUrl) {
        const encoder = new TextEncoder();
        const events = [
          'data: {"type":"assistant","content":"Direct hello"}\n\n',
        ];
        const body = new ReadableStream({
          start(controller) {
            for (const event of events) {
              controller.enqueue(encoder.encode(event));
            }
            controller.close();
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    const result = await handleTail(['test-session'], io);

    expect(result).toBe(0);
    expect(fetchCallCount).toBe(1);
    expect(getStdout()).toContain('🤖 Direct hello');
    expect(getStdout()).not.toContain('SSE token required');
  });

  it('should show clear error when SSE reconnect also fails with 401', async () => {
    const { io, getStdout, getStderr } = createMockIO();

    const sseEventsUrl = 'http://localhost:9100/v1/sessions/test-session/events';
    const sseTokenUrl = 'http://localhost:9100/v1/auth/sse-token';
    const sseTokenWithQuery = 'http://localhost:9100/v1/sessions/test-session/events?token=sse_expired-token';

    let fetchCallCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCallCount++;
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

      // First call: SSE endpoint → 401
      if (urlStr === sseEventsUrl && fetchCallCount === 1) {
        return new Response(JSON.stringify({ error: 'Unauthorized — SSE token required for event streams' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Second call: POST /v1/auth/sse-token → success
      if (urlStr === sseTokenUrl && init?.method === 'POST') {
        return new Response(JSON.stringify({ token: 'sse_expired-token', expiresAt: Date.now() + 300_000 }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Third call: SSE endpoint with ?token= → still 401 (token expired)
      if (urlStr === sseTokenWithQuery) {
        return new Response(JSON.stringify({ error: 'Unauthorized — SSE token invalid or expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    const result = await handleTail(['test-session'], io);

    expect(result).toBe(1);
    expect(fetchCallCount).toBe(3);
    expect(getStderr()).toContain('Unauthorized');
    expect(getStderr()).toContain('SSE token authentication failed');
  });

  it('should return error when no session ID is provided', async () => {
    const { io, getStderr } = createMockIO();

    const result = await handleTail([], io);

    expect(result).toBe(1);
    expect(getStderr()).toContain('Missing session ID');
  });

  it('should handle SSE token fetch network error gracefully', async () => {
    const { io, getStderr } = createMockIO();

    const sseEventsUrl = 'http://localhost:9100/v1/sessions/test-session/events';

    let fetchCallCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      fetchCallCount++;
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

      // First call: SSE endpoint → 401
      if (urlStr === sseEventsUrl && fetchCallCount === 1) {
        return new Response(JSON.stringify({ error: 'Unauthorized — SSE token required for event streams' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Second call: POST /v1/auth/sse-token → network error (null return)
      if (urlStr.includes('sse-token')) {
        throw new Error('Network error');
      }

      return new Response('Not Found', { status: 404 });
    });

    const result = await handleTail(['test-session'], io);

    expect(result).toBe(1);
    expect(fetchCallCount).toBe(2);
    expect(getStderr()).toContain('Failed to obtain SSE token');
  });
});
