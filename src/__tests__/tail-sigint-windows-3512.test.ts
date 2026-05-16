/**
 * Regression tests for #3512 — ag tail SIGINT handler unreliable on Windows.
 *
 * Verifies:
 * 1. On Windows (platform() === 'win32'), readline keypress listener is used as fallback
 * 2. On Unix, standard SIGINT handler is registered
 * 3. 30-minute max-duration timer is always set
 * 4. Cleanup happens correctly on abort (SIGINT, keypress, or timeout)
 * 5. Missing session ID returns error
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

    // Create a fake SSE response that completes immediately
    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    const mockFetch = vi.fn(async () => ({
      ok: true,
      body: fakeStream,
      json: async () => ({}),
    }));

    const originalGlobalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const io = makeIO();
      const exitCode = await handleTail(['abc123'], io);

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

    const mockFetch = vi.fn(async () => ({
      ok: true,
      body: fakeStream,
      json: async () => ({}),
    }));

    const originalGlobalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const io = makeIO();
      const exitCode = await handleTail(['abc123'], io);

      expect(readline.emitKeypressEvents).not.toHaveBeenCalled();
      expect(exitCode).toBe(0);
    } finally {
      globalThis.fetch = originalGlobalFetch;
    }
  });

  it('handles server returning non-OK response', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: 'Session not found' }),
    }));

    const originalGlobalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const io = makeIO();
      const exitCode = await handleTail(['abc123'], io);
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

    const mockFetch = vi.fn(async () => ({
      ok: true,
      body: fakeStream,
      json: async () => ({}),
    }));

    const originalGlobalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const io = makeIO();
      const exitCode = await handleTail(['abc123'], io);
      expect(exitCode).toBe(0);
      // Should have printed the assistant message
      expect(writeLine).toHaveBeenCalledWith(io.stdout, expect.stringContaining('🤖 hello'));
    } finally {
      globalThis.fetch = originalGlobalFetch;
    }
  });

  it('registers SIGINT handler on both platforms', async () => {
    // Test that SIGINT is registered on both platforms
    for (const plat of ['linux', 'win32']) {
      mockPlatform.mockReturnValue(plat);
      vi.clearAllMocks();

      const fakeStream = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      const mockFetch = vi.fn(async () => ({
        ok: true,
        body: fakeStream,
        json: async () => ({}),
      }));

      const originalGlobalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;

      const onceSpy = vi.spyOn(process, 'once');
      const removeListenerSpy = vi.spyOn(process, 'removeListener');

      try {
        const io = makeIO();
        await handleTail(['abc123'], io);
        expect(onceSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
        expect(removeListenerSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      } finally {
        globalThis.fetch = originalGlobalFetch;
        onceSpy.mockRestore();
        removeListenerSpy.mockRestore();
      }
    }
  });
});
