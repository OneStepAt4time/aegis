/**
 * fix-3760-session-id-create.test.ts
 *
 * Issue #3760: `ag create --session-id <id>` should send to existing session,
 * not create a new one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

const CLI_PATH = join(import.meta.dirname ?? __dirname, '..', 'cli.ts');

// ── Static source checks ──

describe('Issue #3760: --session-id flag in handleCreate', () => {
  it('cli.ts parses --session-id flag', async () => {
    const source = await readFile(CLI_PATH, 'utf-8');
    expect(source).toMatch(/--session-id/);
    expect(source).toMatch(/existingSessionId/);
  });

  it('when --session-id is set, fetches existing session instead of POST /v1/sessions', async () => {
    const source = await readFile(CLI_PATH, 'utf-8');
    expect(source).toMatch(/if \(existingSessionId\)/);
    expect(source).toMatch(/\/v1\/sessions\/\$\{existingSessionId\}/);
  });

  it('handles 404 when session not found', async () => {
    const source = await readFile(CLI_PATH, 'utf-8');
    expect(source).toMatch(/checkRes\.status === 404/);
    expect(source).toMatch(/not found/);
  });

  it('help text mentions --session-id', async () => {
    const source = await readFile(CLI_PATH, 'utf-8');
    const helpSection = source.substring(source.indexOf('ag create'));
    expect(helpSection).toMatch(/--session-id/);
  });
});

// ── Behavioral tests with mocked fetch ──

describe('Issue #3760: --session-id behavioral tests', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
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

  it('sends brief to existing session when --session-id is provided', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ delivered: true, attempts: 1 }),
    });
    globalThis.fetch = mockFetch;

    vi.resetModules();
    const { runCli } = await import('../cli.js');
    const { io, getStdout } = createMockIO();

    await runCli(['create', 'hello world', '--session-id', sessionId], io);

    // Should NOT create a new session (no POST to /v1/sessions ending path)
    const createCall = mockFetch.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].match(/\/v1\/sessions$/) && c[1]?.method === 'POST',
    );
    expect(createCall).toBeUndefined();

    // Should have sent brief to existing session
    const sendCall = mockFetch.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes(`/v1/sessions/${sessionId}/send`),
    );
    expect(sendCall).toBeDefined();
    expect(JSON.parse(sendCall![1]?.body)).toEqual({ text: 'hello world' });

    expect(getStdout()).toContain('Using existing session');
  });

  it('returns error when session not found (404)', async () => {
    const sessionId = '00000000-0000-0000-0000-000000000000';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ code: 'NOT_FOUND', message: 'Session not found' }),
    });
    globalThis.fetch = mockFetch;

    vi.resetModules();
    const { runCli } = await import('../cli.js');
    const { io, getStderr } = createMockIO();

    const exitCode = await runCli(['create', 'hello', '--session-id', sessionId], io);

    expect(exitCode).toBe(1);
    expect(getStderr()).toContain('not found');
  });

  it('supports --session-id=VALUE syntax', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ delivered: true, attempts: 1 }),
    });
    globalThis.fetch = mockFetch;

    vi.resetModules();
    const { runCli } = await import('../cli.js');
    const { io, getStdout } = createMockIO();

    await runCli(['create', 'hello', `--session-id=${sessionId}`], io);

    const sendCall = mockFetch.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes(`/v1/sessions/${sessionId}/send`),
    );
    expect(sendCall).toBeDefined();
    expect(getStdout()).toContain('Using existing session');
  });

  it('creates new session when --session-id is NOT provided', async () => {
    const newSessionId = 'new-session-id-1234';
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ activeCount: 0, totalSessions: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: newSessionId, displayName: 'test-session' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ delivered: true, attempts: 1 }),
      });
    globalThis.fetch = mockFetch;

    const { mkdirSync, writeFileSync } = await import('node:fs');
    process.env.HOME = `/tmp/test-home-3760-${Date.now()}`;
    mkdirSync(`${process.env.HOME}/.aegis`, { recursive: true });
    writeFileSync(`${process.env.HOME}/.aegis/config.yaml`, 'baseUrl: http://127.0.0.1:9100\n');

    vi.resetModules();
    const { runCli } = await import('../cli.js');
    const { io, getStdout } = createMockIO();

    await runCli(['create', 'hello world'], io);

    const createCall = mockFetch.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].match(/\/v1\/sessions$/) && c[1]?.method === 'POST',
    );
    expect(createCall).toBeDefined();
    expect(getStdout()).toContain('Session created');
  });
});
