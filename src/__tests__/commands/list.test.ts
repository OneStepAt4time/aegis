/**
 * Tests for commands/list.ts — Issue #3731
 * Verify that killed/completed/crashed sessions are hidden by default
 * and shown with --all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock cli-http so we don't need a running server
const mockWriteLine = vi.fn();
const mockStdout = { write: vi.fn() };
const mockStderr = { write: vi.fn() };
const mockIO = { stdout: mockStdout, stderr: mockStderr };

let mockFetchResponse: { ok: boolean; status: number; statusText: string; json: () => Promise<any> };

vi.mock('../../cli-http.js', () => ({
  resolveBaseUrl: vi.fn().mockResolvedValue('http://localhost:9100'),
  resolveAuthToken: vi.fn().mockResolvedValue('test-token'),
  buildHeaders: vi.fn().mockReturnValue({ Authorization: 'Bearer test-token' }),
  requireServer: vi.fn().mockResolvedValue(true),
  writeLine: (...args: any[]) => mockWriteLine(...args),
}));

// Mock global fetch
const originalFetch = globalThis.fetch;
beforeEach(() => {
  vi.clearAllMocks();
  mockWriteLine.mockImplementation((stream: any, text: string) => {
    // writeLine(io.stdout, text) or writeLine(io.stderr, text)
  });
});

async function importList() {
  return import('../../commands/list.js');
}

function makeFetchResponse(sessions: any[]) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ sessions }),
  };
}

describe('handleList', () => {
  it('hides killed sessions by default', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeFetchResponse([
      { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'idle', displayName: 'alive-session' },
      { id: '11111111-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'killed', displayName: 'dead-session' },
      { id: '22222222-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'completed', displayName: 'done-session' },
      { id: '33333333-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'crashed', displayName: 'crash-session' },
    ])) as any;

    const { handleList } = await importList();
    const exitCode = await handleList([], mockIO as any);

    expect(exitCode).toBe(0);
    // Should mention only the idle session
    const calls = mockWriteLine.mock.calls.map((c: any[]) => c[1]);
    const sessionLines = calls.filter((l: string) => l && l.includes('aaaaaaaa'));
    expect(sessionLines.length).toBe(1);
    // Should NOT include killed/completed/crashed
    const deadLines = calls.filter((l: string) => l && (l.includes('dead-session') || l.includes('done-session') || l.includes('crash-session')));
    expect(deadLines.length).toBe(0);
    // Tip should mention --all
    const tipCalls = calls.filter((l: string) => l && l.includes('--all'));
    expect(tipCalls.length).toBe(1);
  });

  it('shows all sessions with --all flag', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeFetchResponse([
      { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'idle', displayName: 'alive-session' },
      { id: '11111111-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'killed', displayName: 'dead-session' },
    ])) as any;

    const { handleList } = await importList();
    const exitCode = await handleList(['--all'], mockIO as any);

    expect(exitCode).toBe(0);
    const calls = mockWriteLine.mock.calls.map((c: any[]) => c[1]);
    const aliveLines = calls.filter((l: string) => l && l.includes('alive-session'));
    const deadLines = calls.filter((l: string) => l && l.includes('dead-session'));
    expect(aliveLines.length).toBe(1);
    expect(deadLines.length).toBe(1);
  });

  it('shows helpful empty message when no active sessions', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeFetchResponse([
      { id: '11111111-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'killed', displayName: 'dead-session' },
    ])) as any;

    const { handleList } = await importList();
    const exitCode = await handleList([], mockIO as any);

    expect(exitCode).toBe(0);
    const calls = mockWriteLine.mock.calls.map((c: any[]) => c[1]);
    const emptyMsg = calls.find((l: string) => l && l.includes('--all'));
    expect(emptyMsg).toBeDefined();
  });

  it('still passes --status filter to server', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeFetchResponse([])) as any;

    const { handleList } = await importList();
    await handleList(['--status', 'idle'], mockIO as any);

    const fetchUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(fetchUrl).toContain('status=idle');
  });

  it('--all does not add --all tip', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeFetchResponse([
      { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'idle', displayName: 'alive-session' },
    ])) as any;

    const { handleList } = await importList();
    await handleList(['--all'], mockIO as any);

    const calls = mockWriteLine.mock.calls.map((c: any[]) => c[1]);
    const allTip = calls.filter((l: string) => l && l.includes('--all'));
    expect(allTip.length).toBe(0);
  });
});

// Restore fetch after all tests
import { afterAll } from 'vitest';
afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('handleList --json (#4457)', () => {
  it('outputs structured { sessions, pagination } with --json', async () => {
    const sessions = [
      { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'idle', displayName: 'test-session' },
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        sessions,
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      }),
    }) as any;

    const { handleList } = await importList();
    const exitCode = await handleList(['--json'], mockIO as any);

    expect(exitCode).toBe(0);
    const calls = mockWriteLine.mock.calls.map((c: any[]) => c[1]);
    const jsonCall = calls.find((l: string) => l && l.startsWith('{'));
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall!);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.pagination).toEqual({ page: 1, limit: 50, total: 1, totalPages: 1 });
  });

  it('outputs empty sessions array with --json when no active sessions', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        sessions: [
          { id: '11111111-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'killed', displayName: 'dead' },
        ],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      }),
    }) as any;

    const { handleList } = await importList();
    const exitCode = await handleList(['--json'], mockIO as any);

    expect(exitCode).toBe(0);
    const calls = mockWriteLine.mock.calls.map((c: any[]) => c[1]);
    const jsonCall = calls.find((l: string) => l && l.startsWith('{'));
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall!);
    expect(parsed.sessions).toHaveLength(0);
  });

  it('outputs JSON error when server returns error and --json is set', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: 'Invalid API key' }),
    }) as any;

    const { handleList } = await importList();
    const exitCode = await handleList(['--json'], mockIO as any);

    expect(exitCode).toBe(1);
    const calls = mockWriteLine.mock.calls.map((c: any[]) => c[1]);
    const jsonCall = calls.find((l: string) => l && l.startsWith('{'));
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall!);
    expect(parsed.error).toBe('Invalid API key');
  });

  it('--json --all includes killed sessions in output', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        sessions: [
          { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'idle', displayName: 'alive' },
          { id: '11111111-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'killed', displayName: 'dead' },
        ],
        pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
      }),
    }) as any;

    const { handleList } = await importList();
    const exitCode = await handleList(['--json', '--all'], mockIO as any);

    expect(exitCode).toBe(0);
    const calls = mockWriteLine.mock.calls.map((c: any[]) => c[1]);
    const jsonCall = calls.find((l: string) => l && l.startsWith('{'));
    const parsed = JSON.parse(jsonCall!);
    expect(parsed.sessions).toHaveLength(2);
  });
});

  it('--status active filters out terminal statuses', async () => {
    const sessions = [
      { id: 'a1', status: 'idle', displayName: 'alive' },
      { id: 'b2', status: 'killed', displayName: 'dead' },
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status:200, json: async () => ({ sessions, pagination: { page:1, limit:50, total:2, totalPages:1 } }) }) as any;
    const { handleList } = await importList();
    const exitCode = await handleList(['--status', 'active', '--json'], mockIO as any);
    expect(exitCode).toBe(0);
    const calls = mockWriteLine.mock.calls.map((c: any[]) => c[1]);
    const jsonCall = calls.find((l: string) => l && l.startsWith('{'));
    const parsed = JSON.parse(jsonCall!);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0].status).toBe('idle');
  });
