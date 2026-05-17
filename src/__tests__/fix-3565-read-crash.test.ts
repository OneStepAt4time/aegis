/**
 * Issue #3565: ag read crashes with TypeError on split of undefined.
 *
 * The /read endpoint returns ParsedEntry objects with { text } not { content }.
 * handleRead must handle both formats without crashing.
 *
 * Issue #3633: handleRead now resolves prefix IDs via GET /v1/sessions first.
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

/**
 * Create a mock fetch that handles both session-list and session-read calls.
 * Session ID "abc123..." resolves to a full UUID via prefix matching.
 */
function makeFetch(readResponse: any, readOk = true, readStatus = 200) {
  const fullId = 'abc12345-dead-beef-cafe-123456789abc';
  return vi.fn(async (url: string | URL | Request) => {
    const urlStr = url.toString() as any;
    // Session list endpoint (for prefix resolution)
    if (urlStr.includes('/v1/sessions') && !urlStr.includes('/read') && !urlStr.includes('/transcript') && !urlStr.includes('/health')) {
      return {
        ok: true,
        json: async () => ({ sessions: [{ id: fullId, displayName: 'test', status: 'idle' }] }),
      };
    }
    // Read endpoint
    return {
      ok: readOk,
      status: readStatus,
      statusText: readOk ? 'OK' : 'Unauthorized',
      json: async () => readResponse,
    };
  }) as any;
}

describe('ag read (#3565)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks() as any;
  }) as any;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  }) as any;

  it('returns error when session ID is missing', async () => {
    const io = makeIO() as any;
    const exitCode = await handleRead([], io) as any;
    expect(exitCode).toBe(1) as any;
    expect(writeLine).toHaveBeenCalledWith(io.stderr, expect.stringContaining('Missing session ID')) as any;
  });

  it('handles ParsedEntry format (text field) without crashing', async () => {
    globalThis.fetch = makeFetch({
      messages: [
        { role: 'user', contentType: 'text', text: 'Say hello', timestamp: '2026-05-16T00:00:00Z' },
        { role: 'assistant', contentType: 'text', text: 'Hello!', timestamp: '2026-05-16T00:00:01Z' },
      ],
      status: 'idle',
    }) as any;

    const io = makeIO() as any;
    const exitCode = await handleRead(['abc123'], io) as any;
    expect(exitCode).toBe(0) as any;
    expect(writeLine).toHaveBeenCalledWith(io.stdout, expect.stringContaining('👤 Say hello')) as any;
    expect(writeLine).toHaveBeenCalledWith(io.stdout, expect.stringContaining('🤖 Hello!')) as any;
  });

  it('handles empty messages without crashing', async () => {
    globalThis.fetch = makeFetch({ messages: [], status: 'idle' }) as any;

    const io = makeIO() as any;
    const exitCode = await handleRead(['abc123'], io);
    expect(exitCode).toBe(0);
    expect(writeLine).toHaveBeenCalledWith(io.stdout, expect.stringContaining('No messages'));
  });

  it('handles mixed content and text fields', async () => {
    globalThis.fetch = makeFetch({
      messages: [
        { role: 'user', content: 'Old format message' },
        { role: 'assistant', text: 'New format response' },
        { role: 'system', text: 'System message' },
      ],
      status: 'idle',
    }) as any;

    const io = makeIO() as any;
    const exitCode = await handleRead(['abc123'], io) as any;
    expect(exitCode).toBe(0) as any;
    expect(writeLine).toHaveBeenCalledWith(io.stdout, expect.stringContaining('👤 Old format message')) as any;
    expect(writeLine).toHaveBeenCalledWith(io.stdout, expect.stringContaining('🤖 New format response')) as any;
    expect(writeLine).toHaveBeenCalledWith(io.stdout, expect.stringContaining('⚙️ System message'));
  });

  it('handles messages with undefined text and content', async () => {
    globalThis.fetch = makeFetch({
      messages: [
        { role: 'assistant' },
      ],
      status: 'idle',
    }) as any;

    const io = makeIO();
    const exitCode = await handleRead(['abc123'], io);
    expect(exitCode).toBe(0);
  });

  it('handles server error response', async () => {
    globalThis.fetch = makeFetch({ error: 'Invalid token' }, false, 401) as any;

    const io = makeIO() as any;
    const exitCode = await handleRead(['abc123'], io);
    expect(exitCode).toBe(1);
    expect(writeLine).toHaveBeenCalledWith(io.stderr, expect.stringContaining('Invalid token'));
  });
});
