/**
 * Issue #3498: ag run --yes must produce output within 30s or fail loudly (F14, F15)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process to avoid real claude CLI check
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execFile: vi.fn((_cmd: string, _args: string[], opts: any, cb: Function) => {
    // Simulate claude CLI present and authenticated
    cb(null, 'claude 1.0.0', '');
  }),
}));

describe('Issue #3498: ag run --yes timeout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handleRun returns 1 when --yes mode session completes with no output', async () => {
    const { handleRun } = await import('../commands/run.js');

    const outputs: string[] = [];
    const errors: string[] = [];
    const io = {
      stdin: process.stdin,
      stdout: { write: (s: string) => { outputs.push(s); } } as any,
      stderr: { write: (s: string) => { errors.push(s); } } as any,
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/v1/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions/stats')) {
        return new Response(JSON.stringify({ total: 0 }), { status: 200 });
      }
      if (urlStr.includes('/read')) {
        // No messages, session already completed
        return new Response(JSON.stringify({
          messages: [],
          status: 'completed',
        }), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          id: 'test-session-no-output',
          displayName: 'test-run',
          promptDelivery: { status: 'delivered', delivered: true },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as any;

    try {
      const code = await handleRun(['say pong', '--yes', '--cwd', '/tmp'], io);
      expect(code).toBe(1);
      const allErrors = errors.join('');
      expect(allErrors).toContain('No output received');
      expect(allErrors).toContain('30 seconds');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15_000);

  it('handleRun returns 0 when output IS received', async () => {
    const { handleRun } = await import('../commands/run.js');

    const outputs: string[] = [];
    const io = {
      stdin: process.stdin,
      stdout: { write: (s: string) => { outputs.push(s); } } as any,
      stderr: { write: (s: string) => { } } as any,
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/v1/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions/stats')) {
        return new Response(JSON.stringify({ total: 0 }), { status: 200 });
      }
      if (urlStr.includes('/read')) {
        return new Response(JSON.stringify({
          messages: [{ text: 'Pong!', role: 'assistant', contentType: 'text' }],
          status: 'completed',
        }), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          id: 'test-session-with-output',
          displayName: 'test-run',
          promptDelivery: { status: 'delivered', delivered: true },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as any;

    try {
      const code = await handleRun(['say pong', '--yes', '--cwd', '/tmp'], io);
      expect(code).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15_000);

  it('F15: prompt delivery pending message mentions agent starting up', async () => {
    const { handleRun } = await import('../commands/run.js');

    const outputs: string[] = [];
    const io = {
      stdin: process.stdin,
      stdout: { write: (s: string) => { outputs.push(s); } } as any,
      stderr: { write: (s: string) => { } } as any,
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/v1/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions/stats')) {
        return new Response(JSON.stringify({ total: 0 }), { status: 200 });
      }
      // Session poll (for prompt delivery status) — check if it's NOT /read
      if (urlStr.includes('/v1/sessions/') && !urlStr.includes('/read')) {
        return new Response(JSON.stringify({
          promptDelivery: { status: 'delivered', delivered: true },
        }), { status: 200 });
      }
      if (urlStr.includes('/read')) {
        return new Response(JSON.stringify({
          messages: [{ text: 'Done', role: 'assistant', contentType: 'text' }],
          status: 'completed',
        }), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          id: 'test-session-pending-msg',
          displayName: 'test-run',
          promptDelivery: { status: 'pending' },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as any;

    try {
      await handleRun(['test prompt', '--yes', '--cwd', '/tmp'], io);
      const allOutput = outputs.join('');
      expect(allOutput).toContain('agent starting up');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15_000);
});
