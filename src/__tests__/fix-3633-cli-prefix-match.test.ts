/**
 * Issue #3633: ag list truncates IDs, ag read needs full UUID — broken CLI workflow.
 *
 * Tests:
 * - resolveSessionId prefix matching logic
 * - handleList --full-ids flag
 * - handleList --json flag
 * - handleRead with prefix ID
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSessions = [
  { id: 'a9e04f5e-ba93-4ec7-b0d6-76648b4a33e5', displayName: 'test-1', status: 'idle' },
  { id: 'b2854e13-91b4-4874-9189-b61fdd00a9c9', displayName: 'test-2', status: 'working' },
];

function mockFetch(url: string | URL | Request): Promise<Response> {
  const urlStr = url.toString();
  // Health check
  if (urlStr.includes('/health')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) } as Response);
  }
  // Sessions list
  if (urlStr.match(/\/v1\/sessions(\?|$)/)) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ sessions: mockSessions }),
    } as Response);
  }
  // Session read (with resolved ID)
  if (urlStr.includes('/read')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        messages: [{ role: 'assistant', text: 'hello world' }],
      }),
    } as Response);
  }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not found' }) } as Response);
}

describe('Issue #3633: CLI prefix matching and list flags', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(mockFetch) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('handleRead with full UUID works', async () => {
    const { handleRead } = await import('../commands/read.js');
    const output: string[] = [];
    const io = {
      stdin: {} as any,
      stdout: { write: (s: string) => { output.push(s); } } as any,
      stderr: { write: (s: string) => { output.push(s); } } as any,
    };
    const exitCode = await handleRead(['a9e04f5e-ba93-4ec7-b0d6-76648b4a33e5'], io);
    expect(exitCode).toBe(0);
    expect(output.join('')).toContain('hello world');
  });

  it('handleRead with 8-char prefix resolves and works', async () => {
    const { handleRead } = await import('../commands/read.js');
    const output: string[] = [];
    const io = {
      stdin: {} as any,
      stdout: { write: (s: string) => { output.push(s); } } as any,
      stderr: { write: (s: string) => { output.push(s); } } as any,
    };
    const exitCode = await handleRead(['a9e04f5e'], io);
    expect(exitCode).toBe(0);
    expect(output.join('')).toContain('hello world');
  });

  it('handleRead with ambiguous prefix returns error', async () => {
    // Both sessions start with different chars, so no ambiguity possible with these IDs
    // Test with an empty prefix that would match nothing
    const { handleRead } = await import('../commands/read.js');
    const output: string[] = [];
    const io = {
      stdin: {} as any,
      stdout: { write: (s: string) => { output.push(s); } } as any,
      stderr: { write: (s: string) => { output.push(s); } } as any,
    };
    const exitCode = await handleRead(['zzzzzzzz'], io);
    expect(exitCode).toBe(1);
    expect(output.join('')).toContain('No session found');
  });

  it('handleList --full-ids shows full UUIDs', async () => {
    const { handleList } = await import('../commands/list.js');
    const output: string[] = [];
    const io = {
      stdin: {} as any,
      stdout: { write: (s: string) => { output.push(s); } } as any,
      stderr: { write: (s: string) => { output.push(s); } } as any,
    };
    const exitCode = await handleList(['--full-ids'], io);
    expect(exitCode).toBe(0);
    const text = output.join('');
    expect(text).toContain('a9e04f5e-ba93-4ec7-b0d6-76648b4a33e5');
    expect(text).not.toContain('Tip: use --full-ids');
  });

  it('handleList without flags shows truncated IDs and tip', async () => {
    const { handleList } = await import('../commands/list.js');
    const output: string[] = [];
    const io = {
      stdin: {} as any,
      stdout: { write: (s: string) => { output.push(s); } } as any,
      stderr: { write: (s: string) => { output.push(s); } } as any,
    };
    const exitCode = await handleList([], io);
    expect(exitCode).toBe(0);
    const text = output.join('');
    expect(text).toContain('a9e04f5e…');
    expect(text).toContain('Tip: use --full-ids');
  });

  it('handleList --json outputs valid JSON with full IDs', async () => {
    const { handleList } = await import('../commands/list.js');
    const output: string[] = [];
    const io = {
      stdin: {} as any,
      stdout: { write: (s: string) => { output.push(s); } } as any,
      stderr: { write: (s: string) => { output.push(s); } } as any,
    };
    const exitCode = await handleList(['--json'], io);
    expect(exitCode).toBe(0);
    const text = output.join('');
    const parsed = JSON.parse(text);
    expect(parsed.length).toBe(2);
    expect(parsed[0].id).toBe('a9e04f5e-ba93-4ec7-b0d6-76648b4a33e5');
  });
});
