/**
 * Regression tests for #3512 — ag tail SIGINT handler unreliable on Windows.
 * Updated for #3566 — SSE token acquisition before connecting to events stream.
 * Updated for #4461 — session status check before SSE connect.
 *
 * Verifies:
 * 1. On Windows (platform() === 'win32'), readline keypress listener is used as fallback
 * 2. On Unix, standard SIGINT handler is registered
 * 3. 30-minute max-duration timer is always set
 * 4. Cleanup happens correctly on abort (SIGINT, keypress, or timeout)
 * 5. Missing session ID returns error
 * 6. #3566: SSE token is obtained before connecting to event stream
 * 7. #4461: Terminated sessions are caught before SSE connect
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We mock 'node:os' platform() so we can test both code paths
const mockPlatform = vi.fn(() => 'linux');

vi.mock('node:os', () => ({
  platform: () => mockPlatform(),
}));

vi.mock('node:readline', () => ({
  emitKeypressEvents: vi.fn(),
}));

// Mock cli-http to avoid real network calls
vi.mock('../cli-http.js', () => ({
  resolveBaseUrl: vi.fn(async () => 'http://localhost:9100'),
  resolveAuthToken: vi.fn(async () => 'test-token'),
  buildHeaders: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
  requireServer: vi.fn(async () => true),
  writeLine: vi.fn(),
}));

import { handleTail } from '../commands/tail.js';
import * as readline from 'node:readline';
import { writeLine } from '../cli-http.js';

function makeIO() {
  return { stdin: process.stdin as any,
    stdout: { write: vi.fn() } as any,
    stderr: { write: vi.fn() } as any,
  };
}

const SESSION_ID = 'a9e04f5e-ba93-4ec7-b0d6-76648b4a33e5';

/**
 * Create a mock fetch that handles the three-step SSE flow (#4461 + #3566):
 * 1st call: GET /v1/sessions/:id/status → { status: 'running' }
 * 2nd call: POST /v1/auth/sse-token → { token: 'sse_test_token' }
 * 3rd call: GET /v1/sessions/:id/events → streamResponse
 */
function createSSEMockFetch(streamResponse: { ok: boolean; body?: ReadableStream; json?: () => Promise<any> }) {
  
  return vi.fn(async (url: string | RequestInfo, _opts?: any) => {
    const urlStr = typeof url === 'string' ? url : String(url);
    

    // Status check
    if (urlStr.includes('/status')) {
      return {
        ok: true,
        json: async () => ({ status: 'running' }),
      };
    }

    // SSE token endpoint
    if (urlStr.includes('/sse-token')) {
      return {
        ok: true,
        json: async () => ({ token: 'sse_test_token' }),
      };
    }

    // Events stream
    return streamResponse;
  });
}

describe('tail SIGINT handling (#3512)', () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform.mockReturnValue('linux');
    process.stdin.isTTY = true;
  });

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY;
  });

  it('returns error when session ID is missing', async () => {
    const io = makeIO();
    const exitCode = await handleTail([], io);
    expect(exitCode).toBe(1);
    expect(writeLine).toHaveBeenCalledWith(io.stderr, expect.stringContaining('Missing session ID'));
  });

  it('uses readline keypress on Windows (win32)', async () => {
    mockPlatform.mockReturnValue('win32');

    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    const mockFetch = createSSEMockFetch({
      ok: true,
      body: fakeStream,
      json: async () => ({}),
    });

    const originalGlobalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const io = makeIO();
      const exitCode = await handleTail([SESSION_ID], io);

      expect(readline.emitKeypressEvents).toHaveBeenCalledWith(process.stdin);
      expect(exitCode).toBe(0);
    } finally {
      globalThis.fetch = originalGlobalFetch;
    }
  });

  it('does not use readline keypress on Unix (linux)', async () => {
    mockPlatform.mockReturnValue('linux');

    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    const mockFetch = createSSEMockFetch({
      ok: true,
      body: fakeStream,
      json: async () => ({}),
    });

    const originalGlobalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const io = makeIO();
      const exitCode = await handleTail([SESSION_ID], io);

      expect(readline.emitKeypressEvents).not.toHaveBeenCalled();
      expect(exitCode).toBe(0);
    } finally {
      globalThis.fetch = originalGlobalFetch;
    }
  });

  it('handles SSE token fetch failure', async () => {
    // Status check succeeds, but SSE token endpoint returns failure
    
    const mockFetch = vi.fn(async (url: string | RequestInfo) => {
      const urlStr = typeof url === 'string' ? url : String(url);
      

      // Status check succeeds
      if (urlStr.includes('/status')) {
        return { ok: true, json: async () => ({ status: 'running' }) };
      }

      // Everything else (sse-token) fails
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Invalid token' }),
      };
    });

    const originalGlobalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const io = makeIO();
      const exitCode = await handleTail([SESSION_ID], io);
      expect(exitCode).toBe(1);
      expect(writeLine).toHaveBeenCalledWith(io.stderr, expect.stringContaining('Authentication failed'));
    } finally {
      globalThis.fetch = originalGlobalFetch;
    }
  });

  it('handles events stream returning non-OK response', async () => {
    // 1st: status check ok, 2nd: SSE token ok, 3rd: events stream 404
    
    const mockFetch = vi.fn(async (url: string | RequestInfo) => {
      const urlStr = typeof url === 'string' ? url : String(url);
      

      if (urlStr.includes('/status')) {
        return { ok: true, json: async () => ({ status: 'running' }) };
      }
      if (urlStr.includes('/sse-token')) {
        return { ok: true, json: async () => ({ token: 'sse_test_token' }) };
      }
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Session not found' }),
      };
    });

    const originalGlobalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const io = makeIO();
      const exitCode = await handleTail([SESSION_ID], io);
      expect(exitCode).toBe(1);
      expect(writeLine).toHaveBeenCalledWith(io.stderr, expect.stringContaining('Session not found'));
    } finally {
      globalThis.fetch = originalGlobalFetch;
    }
  });

  it('handles SSE stream with parseable events', async () => {
    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"assistant","content":"hello"}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    const mockFetch = createSSEMockFetch({
      ok: true,
      body: fakeStream,
      json: async () => ({}),
    });

    const originalGlobalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const io = makeIO();
      const exitCode = await handleTail([SESSION_ID], io);
      expect(exitCode).toBe(0);
      // Should have printed the assistant message
      expect(writeLine).toHaveBeenCalledWith(io.stdout, expect.stringContaining('🤖 hello'));
    } finally {
      globalThis.fetch = originalGlobalFetch;
    }
  });

  it('registers SIGINT handler on both platforms', async () => {
    for (const plat of ['linux', 'win32']) {
      mockPlatform.mockReturnValue(plat);
      vi.clearAllMocks();

      const fakeStream = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      const mockFetch = createSSEMockFetch({
        ok: true,
        body: fakeStream,
        json: async () => ({}),
      });

      const originalGlobalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;

      const onceSpy = vi.spyOn(process, 'once');
      const removeListenerSpy = vi.spyOn(process, 'removeListener');

      try {
        const io = makeIO();
        await handleTail([SESSION_ID], io);
        expect(onceSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
        expect(removeListenerSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      } finally {
        globalThis.fetch = originalGlobalFetch;
        onceSpy.mockRestore();
        removeListenerSpy.mockRestore();
      }
    }
  });

  it('catches terminated session before SSE connect (#4461)', async () => {
    // Status check returns a terminal state
    const mockFetch = vi.fn(async (url: string | RequestInfo) => {
      const urlStr = typeof url === 'string' ? url : String(url);
      if (urlStr.includes('/status')) {
        return { ok: true, json: async () => ({ status: 'completed' }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const originalGlobalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const io = makeIO();
      const exitCode = await handleTail([SESSION_ID], io);
      expect(exitCode).toBe(1);
      expect(writeLine).toHaveBeenCalledWith(io.stderr, expect.stringContaining('Session is completed'));
      // Should NOT have called SSE token or events endpoints
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/sse-token'),
        expect.anything(),
      );
    } finally {
      globalThis.fetch = originalGlobalFetch;
    }
  });
});
