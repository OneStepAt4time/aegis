/**
 * fix-3773-run-sigterm.test.ts
 *
 * Issue #3773: `ag run` exits with SIGTERM (143) even when session completes successfully.
 * Root cause: streamOutput() only checked for completed/error/killed/crashed statuses,
 * not `idle`. When CC finishes, the session goes back to `idle`, causing the stream
 * to loop until timeout instead of detecting completion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test streamOutput directly by importing and calling it with mocked fetch.
// The function checks for `idle` status when it has already received output.

describe('Issue #3773: streamOutput detects idle-after-work as completion', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createMockIO() {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    return {
      io: {
        stdin: { on: vi.fn(), resume: vi.fn() } as unknown as NodeJS.ReadableStream,
        stdout: { write: (t: string) => { stdoutChunks.push(t); } } as unknown as NodeJS.WritableStream,
        stderr: { write: (t: string) => { stderrChunks.push(t); } } as unknown as NodeJS.WritableStream,
      },
      getStdout: () => stdoutChunks.join(''),
      getStderr: () => stderrChunks.join(''),
    };
  }

  it('streamOutput breaks when session returns to idle after receiving messages', async () => {
    // Simulate: first fetch returns messages (session busy), second fetch returns idle
    const callOrder: string[] = [];
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: session has assistant output
        callOrder.push('messages-fetch');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            messages: [{ role: 'assistant', text: '4', contentType: 'text' }],
            status: 'running',
          }),
        });
      } else {
        // Second call: session went back to idle (CC finished)
        callOrder.push('idle-fetch');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            messages: [{ role: 'assistant', text: '4', contentType: 'text' }],
            status: 'idle',
          }),
        });
      }
    });
    globalThis.fetch = mockFetch;

    vi.resetModules();
    const { streamOutput } = await import('../commands/run.js');
    const { io, getStdout } = createMockIO();

    // Use short idle timeout for fast test
    const result = await streamOutput('http://localhost:9100', 'test-session-id', undefined, io, 5000);

    // Should have detected idle-after-work and broken out
    expect(result).toBe(true);
    expect(getStdout()).toContain('4');
    expect(getStdout()).toContain('completed successfully');
    // Should NOT have timed out
    expect(getStdout()).not.toContain('timeout');
  });

  it('streamOutput does NOT break on idle before receiving any output', async () => {
    // Simulate: session is idle from the start (no messages yet)
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      // Always return idle with no messages — should keep polling until timeout
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          messages: [],
          status: 'idle',
        }),
      });
    });
    globalThis.fetch = mockFetch;

    vi.resetModules();
    const { streamOutput } = await import('../commands/run.js');
    const { io, getStdout } = createMockIO();

    // Very short timeout so test doesn't hang
    const result = await streamOutput('http://localhost:9100', 'test-session-id', undefined, io, 500);

    // Should NOT have detected completion (no output received)
    expect(result).toBe(false);
    // Key: should NOT have printed completion message
    expect(getStdout()).not.toContain('completed successfully');
  });

  it('static check: streamOutput contains idle-after-work detection', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const source = await readFile(
      join(import.meta.dirname ?? __dirname, '..', 'commands', 'run.ts'),
      'utf-8'
    );
    // Verify the fix is in place
    expect(source).toMatch(/isIdleAfterWork/);
    expect(source).toMatch(/data\.status === 'idle' && receivedAnyOutput/);
    expect(source).toMatch(/isTerminal \|\| isIdleAfterWork/);
  });
});
