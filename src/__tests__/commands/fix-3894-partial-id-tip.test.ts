/**
 * Tests for Issue #3894 — ag list mentions partial ID support in tips.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWriteLine = vi.fn();
const mockStdout = { write: vi.fn() };
const mockStderr = { write: vi.fn() };
const mockIO = { stdout: mockStdout, stderr: mockStderr };

vi.mock('../../cli-http.js', () => ({
  resolveBaseUrl: vi.fn().mockResolvedValue('http://localhost:9100'),
  resolveAuthToken: vi.fn().mockResolvedValue('test-token'),
  buildHeaders: vi.fn().mockReturnValue({ Authorization: 'Bearer test-token' }),
  requireServer: vi.fn().mockResolvedValue(true),
  writeLine: (...args: any[]) => mockWriteLine(...args),
}));

const originalFetch = globalThis.fetch;
beforeEach(() => {
  vi.clearAllMocks();
  mockWriteLine.mockImplementation(() => {});
});

async function importList() {
  return import('../../commands/list.js');
}

function makeSessions(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${String(i).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`,
    status: 'idle',
    displayName: `session-${i}`,
  }));
}

describe('ag list partial ID tip (#3894)', () => {
  it('shows partial ID tip when sessions exist', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ sessions: makeSessions(2) }),
    }) as any;

    const { handleList } = await importList();
    await handleList([], mockIO as any);

    const calls = mockWriteLine.mock.calls.map((c: any[]) => c[1]);
    const partialTip = calls.find((l: string) => l && l.includes('Partial IDs'));
    expect(partialTip).toBeDefined();
    expect(partialTip).toContain('ag read');
  });

  it('shows partial ID tip even with --all', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ sessions: makeSessions(1) }),
    }) as any;

    const { handleList } = await importList();
    await handleList(['--all'], mockIO as any);

    const calls = mockWriteLine.mock.calls.map((c: any[]) => c[1]);
    const partialTip = calls.find((l: string) => l && l.includes('Partial IDs'));
    expect(partialTip).toBeDefined();
  });

  it('does not show partial ID tip when no sessions', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ sessions: [] }),
    }) as any;

    const { handleList } = await importList();
    await handleList([], mockIO as any);

    const calls = mockWriteLine.mock.calls.map((c: any[]) => c[1]);
    const partialTip = calls.find((l: string) => l && l.includes('Partial IDs'));
    expect(partialTip).toBeUndefined();
  });
});

import { afterAll } from 'vitest';
afterAll(() => {
  globalThis.fetch = originalFetch;
});
