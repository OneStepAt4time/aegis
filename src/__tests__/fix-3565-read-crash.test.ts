/**
 * Issue #3565: ag read crashes with TypeError on split of undefined.
 *
 * The /read endpoint returns ParsedEntry objects with { text } not { content }.
 * handleRead must handle both formats without crashing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../cli-http.js', () => ({
  resolveBaseUrl: vi.fn(async () => 'http://localhost:9100'),
  resolveAuthToken: vi.fn(async () => 'test-token'),
  buildHeaders: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
  requireServer: vi.fn(async () => true),
  writeLine: vi.fn(),
}));

import { handleRead } from '../commands/read.js';
import { writeLine } from '../cli-http.js';

function makeIO() {
  return {
    stdin: process.stdin as any,
    stdout: { write: vi.fn() } as any,
    stderr: { write: vi.fn() } as any,
  };
}

describe('ag read (#3565)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns error when session ID is missing', async () => {
    const io = makeIO();
    const exitCode = await handleRead([], io);
    expect(exitCode).toBe(1);
    expect(writeLine).toHaveBeenCalledWith(io.stderr, expect.stringContaining('Missing session ID'));
  });

  it('handles ParsedEntry format (text field) without crashing', async () => {
    // #3565: /read returns { text } not { content }
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        messages: [
          { role: 'user', contentType: 'text', text: 'Say hello', timestamp: '2026-05-16T00:00:00Z' },
          { role: 'assistant', contentType: 'text', text: 'Hello!', timestamp: '2026-05-16T00:00:01Z' },
        ],
        status: 'idle',
      }),
    })) as any;

    const io = makeIO();
    const exitCode = await handleRead(['abc123'], io);
    expect(exitCode).toBe(0);
    expect(writeLine).toHaveBeenCalledWith(io.stdout, expect.stringContaining('👤 Say hello'));
    expect(writeLine).toHaveBeenCalledWith(io.stdout, expect.stringContaining('🤖 Hello!'));
  });

  it('handles empty messages without crashing', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ messages: [], status: 'idle' }),
    })) as any;

    const io = makeIO();
    const exitCode = await handleRead(['abc123'], io);
    expect(exitCode).toBe(0);
    expect(writeLine).toHaveBeenCalledWith(io.stdout, expect.stringContaining('No messages'));
  });

  it('handles mixed content and text fields', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        messages: [
          { role: 'user', content: 'Old format message' },
          { role: 'assistant', text: 'New format response' },
          { role: 'system', text: 'System message' },
        ],
        status: 'idle',
      }),
    })) as any;

    const io = makeIO();
    const exitCode = await handleRead(['abc123'], io);
    expect(exitCode).toBe(0);
    expect(writeLine).toHaveBeenCalledWith(io.stdout, expect.stringContaining('👤 Old format message'));
    expect(writeLine).toHaveBeenCalledWith(io.stdout, expect.stringContaining('🤖 New format response'));
    expect(writeLine).toHaveBeenCalledWith(io.stdout, expect.stringContaining('⚙️ System message'));
  });

  it('handles messages with undefined text and content', async () => {
    // Edge case: msg has neither text nor content
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        messages: [
          { role: 'assistant' },
        ],
        status: 'idle',
      }),
    })) as any;

    const io = makeIO();
    // Should NOT crash with TypeError
    const exitCode = await handleRead(['abc123'], io);
    expect(exitCode).toBe(0);
  });

  it('handles server error response', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: 'Invalid token' }),
    })) as any;

    const io = makeIO();
    const exitCode = await handleRead(['abc123'], io);
    expect(exitCode).toBe(1);
    expect(writeLine).toHaveBeenCalledWith(io.stderr, expect.stringContaining('Invalid token'));
  });
});
