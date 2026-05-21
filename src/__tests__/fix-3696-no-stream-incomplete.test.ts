/**
 * Issue #3696: ag run --no-stream should wait for completion and print all output,
 * not just print curl commands and exit immediately.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock child_process to avoid real claude CLI check
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execFile: vi.fn((_cmd: string, _args: string[], opts: any, cb: (err: null, stdout: string, stderr: string) => void) => {
    cb(null, 'claude 1.0.0', '');
  }),
}));

describe('Issue #3696: ag run --no-stream waits for completion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('--no-stream polls until session completes then prints output', async () => {
    const { handleRun } = await import('../commands/run.js');

    const outputs: string[] = [];
    const errors: string[] = [];
    const io = {
      stdin: process.stdin,
      stdout: { write: (s: string) => { outputs.push(s); } } as any,
      stderr: { write: (s: string) => { errors.push(s); } } as any,
    };

    let pollCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/v1/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions/stats')) {
        return new Response(JSON.stringify({ total: 0 }), { status: 200 });
      }
      // Session status polling — first poll returns "working", second returns "idle"
      if (urlStr.includes('/v1/sessions/test-session-nostream') && !urlStr.includes('/read') && init?.method !== 'POST') {
        pollCount++;
        if (pollCount === 1) {
          return new Response(JSON.stringify({ status: 'working' }), { status: 200 });
        }
        return new Response(JSON.stringify({ status: 'idle' }), { status: 200 });
      }
      // Read endpoint — return messages after session completes
      if (urlStr.includes('/read')) {
        return new Response(JSON.stringify({
          messages: [
            { role: 'user', contentType: 'text', text: 'Run: echo hello' },
            { role: 'assistant', contentType: 'tool_use', text: '🔧 Bash' },
            { role: 'assistant', contentType: 'text', text: 'The command output: hello' },
          ],
          status: 'idle',
        }), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          id: 'test-session-nostream',
          displayName: 'test-nostream',
          promptDelivery: { status: 'delivered', delivered: true },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as any;

    try {
      const code = await handleRun(['echo hello', '--no-stream', '--yes', '--cwd', '/tmp'], io);
      expect(code).toBe(0);

      const allOutput = outputs.join('');
      // Should contain session output, not just curl commands
      expect(allOutput).toContain('hello');
      // Should NOT contain old "Next steps:" curl instructions
      expect(allOutput).not.toContain('Next steps:');
      // Should show completion indicator
      expect(allOutput).toContain('Session completed');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('--no-stream returns 0 even with no messages (graceful)', async () => {
    const { handleRun } = await import('../commands/run.js');

    const outputs: string[] = [];
    const io = {
      stdin: process.stdin,
      stdout: { write: (s: string) => { outputs.push(s); } } as any,
      stderr: { write: () => {} } as any,
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
      if (urlStr.includes('/v1/sessions/test-session-empty') && !urlStr.includes('/read') && init?.method !== 'POST') {
        return new Response(JSON.stringify({ status: 'idle' }), { status: 200 });
      }
      if (urlStr.includes('/read')) {
        return new Response(JSON.stringify({
          messages: [],
          status: 'idle',
        }), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          id: 'test-session-empty',
          displayName: 'test-empty',
          promptDelivery: { status: 'delivered', delivered: true },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as any;

    try {
      const code = await handleRun(['echo hello', '--no-stream', '--yes', '--cwd', '/tmp'], io);
      expect(code).toBe(1);
      const allOutput = outputs.join('');
      expect(allOutput).toContain('no output received');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
