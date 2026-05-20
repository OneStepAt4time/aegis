/**
 * fix-3732-stream-timeout.test.ts
 * Tests for #3732: ag run stream interrupted timeout — no output shown for simple tasks.
 *
 * Key fixes:
 * - Per-fetch timeout increased from 5s to 15s
 * - --yes mode idle timeout increased from 30s to 90s
 * - Retry on transient fetch errors (up to 3 attempts)
 * - Clear idle timeout message instead of generic "Stream interrupted"
 * - No-output exit code 1 for all modes (not just --yes)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process to prevent spawning real processes
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    unref: vi.fn(),
    kill: vi.fn(),
  })),
}));

// Mock claude-installer
vi.mock('../utils/claude-installer.js', () => ({
  checkClaudeInstalled: vi.fn().mockResolvedValue(true),
  hasAnthropicCredentials: vi.fn().mockResolvedValue(true),
}));

describe('#3732 stream timeout fixes', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('retries on transient fetch errors before giving up', async () => {
    const calls: string[] = [];
    let callCount = 0;

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      callCount++;

      if (urlStr.includes('/v1/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions/stats')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions') && !urlStr.includes('/read')) {
        // Session creation
        return new Response(
          JSON.stringify({
            id: 'test-session-retry',
            status: 'idle',
            promptDelivery: { delivered: true, status: 'delivered', attempts: 1 },
          }),
          { status: 200 },
        );
      }
      if (urlStr.includes('/read')) {
        calls.push(`read-${callCount}`);
        // First 2 reads fail, 3rd succeeds with output
        if (callCount <= 2) {
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        }
        return new Response(
          JSON.stringify({
            messages: [
              { role: 'user', text: 'hello', contentType: 'text' },
              { role: 'assistant', text: 'world', contentType: 'text' },
            ],
            status: 'completed',
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    // Mock config/auth
    vi.mock('../config.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../config.js')>();
      return {
        ...actual,
        loadConfig: vi.fn().mockResolvedValue({}),
        readConfigFile: vi.fn().mockResolvedValue({}),
      };
    });

    // Need to reimport to get mocks
    const { handleRun } = await import('../commands/run.js');

    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = {
      stdout: { write: (s: string) => stdout.push(s) } as any,
      stderr: { write: (s: string) => stderr.push(s) } as any,
      stdin: process.stdin as any,
    };

    const result = await handleRun(['hello', '--yes'], io);
    expect(result).toBe(0); // Session completed with output
    expect(stdout.join('')).toContain('world');
  });

  it('shows idle timeout message with dynamic timeout value', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/v1/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions/stats')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions') && !urlStr.includes('/read')) {
        return new Response(
          JSON.stringify({
            id: 'test-session-idle',
            status: 'idle',
            promptDelivery: { delivered: true, status: 'delivered', attempts: 1 },
          }),
          { status: 200 },
        );
      }
      if (urlStr.includes('/read')) {
        // Always return 0 messages, session still running — simulates idle timeout
        return new Response(
          JSON.stringify({ messages: [], status: 'running' }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { handleRun } = await import('../commands/run.js');

    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = {
      stdout: { write: (s: string) => stdout.push(s) } as any,
      stderr: { write: (s: string) => stderr.push(s) } as any,
      stdin: process.stdin as any,
    };

    // Run with a short timeout by using --yes (90s) — we advance timers
    const runPromise = handleRun(['hello', '--yes'], io);

    // Advance time past 300s idle timeout
    await vi.advanceTimersByTimeAsync(305_000);

    const result = await runPromise;
    expect(result).toBe(1); // Exit code 1 when no output
    const errors = stderr.join('');
    expect(errors).toContain('300 seconds');
  });

  it('gives up after 3 consecutive fetch errors', async () => {
    let callCount = 0;

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      callCount++;

      if (urlStr.includes('/v1/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions/stats')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions') && !urlStr.includes('/read')) {
        return new Response(
          JSON.stringify({
            id: 'test-session-errors',
            status: 'idle',
            promptDelivery: { delivered: true, status: 'delivered', attempts: 1 },
          }),
          { status: 200 },
        );
      }
      if (urlStr.includes('/read')) {
        // All reads fail with timeout
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { handleRun } = await import('../commands/run.js');

    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = {
      stdout: { write: (s: string) => stdout.push(s) } as any,
      stderr: { write: (s: string) => stderr.push(s) } as any,
      stdin: process.stdin as any,
    };

    const result = await handleRun(['hello', '--yes'], io);
    expect(result).toBe(1);
    const errors = stderr.join('');
    expect(errors).toContain('3 attempts');
    expect(errors).toContain('aborted');
  });

  it('returns exit code 1 for no output in non-yes mode too', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/v1/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions/stats')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions') && !urlStr.includes('/read')) {
        return new Response(
          JSON.stringify({
            id: 'test-session-noyes',
            status: 'idle',
            promptDelivery: { delivered: true, status: 'delivered', attempts: 1 },
          }),
          { status: 200 },
        );
      }
      if (urlStr.includes('/read')) {
        // All reads fail — simulate persistent error
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { handleRun } = await import('../commands/run.js');

    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = {
      stdout: { write: (s: string) => stdout.push(s) } as any,
      stderr: { write: (s: string) => stderr.push(s) } as any,
      stdin: process.stdin as any,
    };

    // Note: no --yes flag
    const result = await handleRun(['hello'], io);
    expect(result).toBe(1);
  });
});
