/**
 * Issue #3672: ag kill and ag tail reject session ID prefixes while ag read accepts them.
 *
 * Tests:
 * - handleKill with full UUID works
 * - handleKill with prefix resolves and works
 * - handleKill with ambiguous prefix returns error
 * - handleKill with no match returns error
 * - handleTail with full UUID works (resolves ID)
 * - handleTail with prefix resolves
 * - handleTail with ambiguous prefix returns error
 * - handleTail with no match returns error
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSessions = [
  { id: 'a9e04f5e-ba93-4ec7-b0d6-76648b4a33e5', displayName: 'test-1', status: 'idle' },
  { id: 'b2854e13-91b4-4874-9189-b61fdd00a9c9', displayName: 'test-2', status: 'working' },
];

function createMockFetch(handlers: Record<string, () => Promise<Response>>): (url: string | URL | Request) => Promise<Response> {
  return (url: string | URL | Request): Promise<Response> => {
    const urlStr = url.toString();
    if (urlStr.includes('/health')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) } as Response);
    }
    if (urlStr.match(/\/v1\/sessions(\?|$)/) && !urlStr.includes('/sessions/')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ sessions: mockSessions }),
      } as Response);
    }
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (urlStr.includes(pattern)) {
        return handler();
      }
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not found' }) } as Response);
  };
}

function createIO() {
  const output: string[] = [];
  return {
    io: {
      stdin: {} as any,
      stdout: { write: (s: string) => { output.push(s); } } as any,
      stderr: { write: (s: string) => { output.push(s); } } as any,
    },
    output,
  };
}

describe('Issue #3672: ag kill prefix matching', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('handleKill with full UUID works', async () => {
    globalThis.fetch = vi.fn(createMockFetch({
      '/sessions/a9e04f5e-ba93-4ec7-b0d6-76648b4a33e5': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      } as Response),
    })) as any;

    const { handleKill } = await import('../commands/kill.js');
    const { io, output } = createIO();
    const exitCode = await handleKill(['a9e04f5e-ba93-4ec7-b0d6-76648b4a33e5'], io);
    expect(exitCode).toBe(0);
    expect(output.join('')).toContain('killed');
  });

  it('handleKill with 8-char prefix resolves and works', async () => {
    globalThis.fetch = vi.fn(createMockFetch({
      '/sessions/a9e04f5e-ba93-4ec7-b0d6-76648b4a33e5': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      } as Response),
    })) as any;

    const { handleKill } = await import('../commands/kill.js');
    const { io, output } = createIO();
    const exitCode = await handleKill(['a9e04f5e'], io);
    expect(exitCode).toBe(0);
    expect(output.join('')).toContain('killed');
  });

  it('handleKill with ambiguous prefix returns error', async () => {
    // Override sessions to have ambiguous prefixes
    const ambiguousMock = (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) } as Response);
      }
      if (urlStr.match(/\/v1\/sessions(\?|$)/) && !urlStr.includes('/sessions/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            sessions: [
              { id: 'a9e04f5e-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status: 'idle' },
              { id: 'a9e04f5e-bbbb-bbbb-bbbb-bbbbbbbbbbbb', status: 'idle' },
            ],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not found' }) } as Response);
    };
    globalThis.fetch = vi.fn(ambiguousMock) as any;

    // Need a fresh import to pick up new mock
    vi.resetModules();
    const { handleKill } = await import('../commands/kill.js');
    const { io, output } = createIO();
    const exitCode = await handleKill(['a9e04f5e'], io);
    expect(exitCode).toBe(1);
    expect(output.join('')).toContain('Ambiguous');
  });

  it('handleKill with no match returns error', async () => {
    globalThis.fetch = vi.fn(createMockFetch({})) as any;

    vi.resetModules();
    const { handleKill } = await import('../commands/kill.js');
    const { io, output } = createIO();
    const exitCode = await handleKill(['zzzzzzzz'], io);
    expect(exitCode).toBe(1);
    expect(output.join('')).toContain('No session found');
  });
});

describe('Issue #3672: ag tail prefix matching', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('handleTail with full UUID resolves ID', async () => {
    globalThis.fetch = vi.fn(createMockFetch({
      '/auth/sse-token': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ token: 'sse_test123' }),
      } as Response),
      '/events': () => Promise.resolve({
        ok: true,
        body: null,
        json: () => Promise.resolve({}),
      } as Response),
    })) as any;

    const { handleTail } = await import('../commands/tail.js');
    const { io, output } = createIO();
    const exitCode = await handleTail(['a9e04f5e-ba93-4ec7-b0d6-76648b4a33e5'], io);
    // Will fail at "No response body" but should resolve the ID first
    expect(output.join('')).toContain('a9e04f5e');
  });

  it('handleTail with 8-char prefix resolves', async () => {
    globalThis.fetch = vi.fn(createMockFetch({
      '/auth/sse-token': () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ token: 'sse_test123' }),
      } as Response),
      '/events': () => Promise.resolve({
        ok: true,
        body: null,
        json: () => Promise.resolve({}),
      } as Response),
    })) as any;

    const { handleTail } = await import('../commands/tail.js');
    const { io, output } = createIO();
    const exitCode = await handleTail(['a9e04f5e'], io);
    expect(output.join('')).toContain('a9e04f5e');
  });

  it('handleTail with ambiguous prefix returns error', async () => {
    const ambiguousMock = (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) } as Response);
      }
      if (urlStr.match(/\/v1\/sessions(\?|$)/) && !urlStr.includes('/sessions/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            sessions: [
              { id: 'a9e04f5e-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status: 'idle' },
              { id: 'a9e04f5e-bbbb-bbbb-bbbb-bbbbbbbbbbbb', status: 'idle' },
            ],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not found' }) } as Response);
    };
    globalThis.fetch = vi.fn(ambiguousMock) as any;

    const { handleTail } = await import('../commands/tail.js');
    const { io, output } = createIO();
    const exitCode = await handleTail(['a9e04f5e'], io);
    expect(exitCode).toBe(1);
    expect(output.join('')).toContain('Ambiguous');
  });

  it('handleTail with no match returns error', async () => {
    globalThis.fetch = vi.fn(createMockFetch({})) as any;

    const { handleTail } = await import('../commands/tail.js');
    const { io, output } = createIO();
    const exitCode = await handleTail(['zzzzzzzz'], io);
    expect(exitCode).toBe(1);
    expect(output.join('')).toContain('No session found');
  });
});
