/**
 * fix-3306-orphan-session.test.ts — Issue #3306: Prevent orphaned server sessions
 * when CLI auth fails.
 *
 * Tests that both `ag run` and `ag "brief"` check auth BEFORE creating a session,
 * so no orphaned sessions remain on the server when auth is rejected.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock fetch before importing modules that use it
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock fs/config modules
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock('../config.js', () => ({
  loadConfig: vi.fn(async () => ({
    baseUrl: 'http://127.0.0.1:9100',
    authToken: 'test-admin-token',
    clientAuthToken: undefined,
    stateDir: '/tmp/.aegis',
  })),
  readConfigFile: vi.fn(async () => null),
  writeConfigFile: vi.fn(),
  serializeConfigFile: vi.fn(),
  findConfigFilePath: vi.fn(() => null),
}));

vi.mock('../base-url.js', () => ({
  deriveBaseUrl: vi.fn(() => 'http://127.0.0.1:9100'),
  getConfiguredBaseUrl: vi.fn(() => 'http://127.0.0.1:9100'),
  normalizeBaseUrl: vi.fn(),
}));

vi.mock('../services/auth/index.js', () => ({
  AuthManager: vi.fn().mockImplementation(() => ({
    load: vi.fn(),
    createKey: vi.fn(async () => ({ key: 'test-key-123' })),
  })),
}));

vi.mock('../utils/auth-token-path.js', () => ({
  readAuthTokenFile: vi.fn(() => null),
  getAuthTokenFilePath: vi.fn(() => '/tmp/.aegis/auth-token'),
  persistAuthTokenFile: vi.fn(),
}));

import { handleRun } from '../commands/run.js';

function makeIO() {
  const stdout = { write: vi.fn() } as unknown as NodeJS.WritableStream;
  const stderr = { write: vi.fn() } as unknown as NodeJS.WritableStream;
  const stdin = {} as NodeJS.ReadableStream;
  return { stdin, stdout, stderr };
}

function stderrOutput(io: ReturnType<typeof makeIO>): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = (io.stderr as any).write;
  return w.mock.calls.map((c: any[]) => c[0]).join('');
}

describe('Issue #3306 — orphaned session on auth failure', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('handleRun should check auth before creating session (preflight)', { timeout: 15_000 }, async () => {
    // Health check succeeds (no auth required)
    // Preflight auth check returns 401
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/v1/health')) {
        return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
      }
      if (typeof url === 'string' && url.includes('/v1/sessions/stats')) {
        return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const io = makeIO();
    const exitCode = await handleRun(['test'], io);

    expect(exitCode).toBe(1);
    expect(stderrOutput(io)).toContain('Unauthorized');

    // Verify no session creation was attempted (only health + stats calls)
    const postCalls = mockFetch.mock.calls.filter(
      (c: unknown[]) => typeof c[1] === 'object' && (c[1] as { method?: string }).method === 'POST',
    );
    expect(postCalls.length).toBe(0);
  });

  it('handleRun should proceed when preflight auth succeeds', { timeout: 15_000 }, async () => {
    mockFetch.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (typeof url === 'string' && url.includes('/v1/health')) {
        return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
      }
      if (typeof url === 'string' && url.includes('/v1/sessions/stats')) {
        return { ok: true, status: 200, json: async () => ({ sessions: 0 }) };
      }
      if (typeof url === 'string' && url.includes('/v1/sessions') && opts?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 'test-session-id', displayName: 'run-test', promptDelivery: { status: 'delivered' } }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const io = makeIO();
    const exitCode = await handleRun(['--no-stream', 'build feature'], io);

    expect(exitCode).toBe(0);

    // Verify session creation was attempted
    const postCalls = mockFetch.mock.calls.filter(
      (c: unknown[]) => typeof c[1] === 'object' && (c[1] as { method?: string }).method === 'POST',
    );
    expect(postCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('handleRun should proceed without preflight when no token is available', { timeout: 15_000 }, async () => {
    // Server health OK, no auth token → skip preflight
    mockFetch.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (typeof url === 'string' && url.includes('/v1/health')) {
        return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
      }
      if (typeof url === 'string' && url.includes('/v1/sessions') && opts?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 'test-session-id', displayName: 'run-test', promptDelivery: { status: 'delivered' } }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const io = makeIO();
    // No env token set
    delete process.env.AEGIS_AUTH_TOKEN;
    delete process.env.AEGIS_TOKEN;
    const exitCode = await handleRun(['--no-stream', 'test'], io);

    expect(exitCode).toBe(0);
  });
});
