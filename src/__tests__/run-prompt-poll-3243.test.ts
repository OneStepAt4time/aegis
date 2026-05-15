/**
 * run-prompt-poll-3243.test.ts — Tests for Issue #3243.
 *
 * After ag run creates a session with a prompt, if promptDelivery.status is
 * 'pending', handleRun must poll GET /v1/sessions/:id every 2s until the
 * status is no longer 'pending' (max 180s).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRun } from '../commands/run.js';

// Module-scoped mocks (hoisted by vitest)
vi.mock('../config.js', () => ({
  findConfigFilePath: vi.fn().mockReturnValue(null),
  loadConfig: vi.fn().mockResolvedValue({
    port: 9100,
    host: '127.0.0.1',
    authToken: '',
    baseUrl: 'http://127.0.0.1:9100',
    acpEnabled: true,
  }),
  readConfigFile: vi.fn().mockResolvedValue({
    authToken: '',
    baseUrl: 'http://127.0.0.1:9100',
  }),
  writeConfigFile: vi.fn(),
  serializeConfigFile: vi.fn().mockReturnValue(''),
}));

vi.mock('../base-url.js', () => ({
  deriveBaseUrl: vi.fn().mockReturnValue('http://127.0.0.1:9100'),
  getConfiguredBaseUrl: vi.fn().mockReturnValue('http://127.0.0.1:9100'),
  normalizeBaseUrl: vi.fn((u: string) => u),
}));


// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeIO() {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    io: {
      stdin: { pipe: vi.fn() } as unknown as NodeJS.ReadableStream,
      stdout: {
        write: vi.fn((text: string) => { outLines.push(text); return true; }),
      } as unknown as NodeJS.WritableStream,
      stderr: {
        write: vi.fn((text: string) => { errLines.push(text); return true; }),
      } as unknown as NodeJS.WritableStream,
    },
    outLines,
    errLines,
  };
}

/** Build a fetch mock that handles the run flow in sequence. */
function buildFetchMock(opts: {
  sessionResponse: { id: string; displayName: string; promptDelivery?: { status: string } };
  pollResponses?: Array<{ promptDelivery?: { status: string } }>;
}) {
  const { sessionResponse, pollResponses = [] } = opts;
  let pollCallCount = 0;

  return vi.fn(async (url: string | URL | Request, fetchOpts?: RequestInit) => {
    const urlStr = String(url);

    // Health check
    if (urlStr.includes('/v1/health')) {
      return {
        ok: true,
        json: async () => ({ healthy: true, version: '0.0.0' }),
      } as Response;
    }

    // Session creation
    if (urlStr.endsWith('/v1/sessions') && fetchOpts?.method === 'POST') {
      return {
        ok: true,
        json: async () => sessionResponse,
      } as Response;
    }

    // Poll GET /v1/sessions/:id (no trailing path segment after UUID)
    const pollMatch = /\/v1\/sessions\/[0-9a-f-]+$/.test(urlStr);
    if (pollMatch && (!fetchOpts?.method || fetchOpts.method === 'GET')) {
      const response = pollResponses[pollCallCount] ?? { promptDelivery: { status: 'delivered' } };
      pollCallCount++;
      return {
        ok: true,
        json: async () => response,
      } as Response;
    }

    // Default: success
    return { ok: true, json: async () => ({}) } as Response;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Issue #3243 — ag run polls for prompt delivery', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.skip('does not poll when promptDelivery is absent from the session response', async () => {
    const mockFetch = buildFetchMock({
      sessionResponse: { id: '00000000-0000-0000-0000-000000000001', displayName: 'run-test' },
    });
    vi.stubGlobal('fetch', mockFetch);

    const { io } = makeIO();
    const runPromise = handleRun(['do the thing', '--no-stream'], io);
    await vi.runAllTimersAsync();
    await vi.advanceTimersByTimeAsync(0); // flush any remaining microtasks
    await runPromise;

    // No poll call should happen (no UUID GET after session creation)
    const pollCalls = mockFetch.mock.calls.filter(([url]) => {
      const urlStr = String(url);
      return /\/v1\/sessions\/[0-9a-f-]+$/.test(urlStr);
    });
    expect(pollCalls).toHaveLength(0);
  });

  it.skip('polls GET /v1/sessions/:id when promptDelivery.status is pending', async () => {
    const mockFetch = buildFetchMock({
      sessionResponse: {
        id: '00000000-0000-0000-0000-000000000002',
        displayName: 'run-pending',
        promptDelivery: { status: 'pending' },
      },
      pollResponses: [{ promptDelivery: { status: 'delivered' } }],
    });
    vi.stubGlobal('fetch', mockFetch);

    const { io } = makeIO();
    const runPromise = handleRun(['do the thing', '--no-stream'], io);
    // Advance the 2s poll interval
    vi.setSystemTime(Date.now() + 2500);
    await vi.advanceTimersByTimeAsync(2500);
    await runPromise;

    const pollCalls = mockFetch.mock.calls.filter(([url]) => {
      return /\/v1\/sessions\/[0-9a-f-]+$/.test(String(url));
    });
    expect(pollCalls.length).toBeGreaterThanOrEqual(1);
  });

  it.skip('stops polling when promptDelivery.status is no longer pending', async () => {
    let pollCount = 0;
    const mockFetch = vi.fn(async (url: string | URL | Request, fetchOpts?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('/v1/health')) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (urlStr.endsWith('/v1/sessions') && fetchOpts?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ id: '00000000-0000-0000-0000-000000000003', displayName: 'run-stops', promptDelivery: { status: 'pending' } }),
        } as Response;
      }
      if (/\/v1\/sessions\/[0-9a-f-]+$/.test(urlStr)) {
        pollCount++;
        if (pollCount === 1) return { ok: true, json: async () => ({ promptDelivery: { status: 'pending' } }) } as Response;
        return { ok: true, json: async () => ({ promptDelivery: { status: 'delivered' } }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', mockFetch);

    const { io } = makeIO();
    const runPromise = handleRun(['do the thing', '--no-stream'], io);
    // Advance past 2 poll intervals (2s each)
    vi.setSystemTime(Date.now() + 5000);
    await vi.advanceTimersByTimeAsync(5000);
    await runPromise;

    // Should have polled twice: first returned pending, second returned delivered → stopped
    expect(pollCount).toBe(2);
  });

  it.skip('times out after 180s if promptDelivery.status stays pending', async () => {
    const mockFetch = buildFetchMock({
      sessionResponse: {
        id: '00000000-0000-0000-0000-000000000004',
        displayName: 'run-timeout',
        promptDelivery: { status: 'pending' },
      },
      // All poll responses stay 'pending'
      pollResponses: Array(200).fill({ promptDelivery: { status: 'pending' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { io } = makeIO();
    const runPromise = handleRun(['do the thing', '--no-stream'], io);
    // Advance past 180s timeout
    vi.setSystemTime(Date.now() + 185_000);
    await vi.advanceTimersByTimeAsync(185_000);
    const code = await runPromise;

    // Should exit cleanly (not error) after timeout
    expect(code).toBe(0);

    // Should NOT have polled indefinitely
    const pollCalls = mockFetch.mock.calls.filter(([url]) => {
      return /\/v1\/sessions\/[0-9a-f-]+$/.test(String(url));
    });
    // 180s / 2s interval = 90 polls max
    expect(pollCalls.length).toBeLessThanOrEqual(91);
  });
});
