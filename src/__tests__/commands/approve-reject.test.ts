/**
 * commands/approve-reject.test.ts — Unit tests for `ag approve` and `ag reject` CLI commands.
 * Issue #4685: Programmatic approval/rejection of pending tool calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleApprove } from '../../commands/approve.js';
import { handleReject } from '../../commands/reject.js';

vi.mock('../../cli-http.js', async () => {
  const actual = await vi.importActual('../../cli-http.js');
  return {
    ...actual,
    resolveBaseUrl: vi.fn().mockResolvedValue('http://localhost:9100'),
    resolveAuthToken: vi.fn().mockResolvedValue('test-token'),
    requireServer: vi.fn().mockResolvedValue(true),
    buildHeaders: vi.fn().mockReturnValue({ Authorization: 'Bearer test-token' }),
  };
});

vi.mock('../../commands/read.js', async () => {
  const actual = await vi.importActual('../../commands/read.js');
  return {
    ...actual,
    resolveSessionId: vi.fn().mockImplementation(async (id: string) => {
      if (id === 'acc154fb') return 'acc154fb-ec97-4e64-bd8c-b23fbcec6889';
      if (id === 'acc154fb-ec97-4e64-bd8c-b23fbcec6889') return id;
      return null;
    }),
  };
});

const mockIO = () => ({
  stdin: process.stdin,
  stdout: { write: vi.fn() } as unknown as NodeJS.WritableStream,
  stderr: { write: vi.fn() } as unknown as NodeJS.WritableStream,
});

describe('handleApprove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('returns error when session ID is missing', async () => {
    const io = mockIO();
    const result = await handleApprove([], io);
    expect(result).toBe(1);
    expect(io.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Missing session ID'));
  });

  it('approves permission for a full UUID', async () => {
    const io = mockIO();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    const result = await handleApprove(['acc154fb-ec97-4e64-bd8c-b23fbcec6889'], io);
    expect(result).toBe(0);
    expect(io.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Approved'));
  });

  it('approves permission for a prefix', async () => {
    const io = mockIO();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    const result = await handleApprove(['acc154fb'], io);
    expect(result).toBe(0);
    expect(io.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Approved'));
  });

  it('returns error on API failure', async () => {
    const io = mockIO();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      statusText: 'Not Found',
      json: async () => ({ error: 'Session not found' }),
    } as Response);

    const result = await handleApprove(['acc154fb'], io);
    expect(result).toBe(1);
    expect(io.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Session not found'));
  });
});

describe('handleReject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('returns error when session ID is missing', async () => {
    const io = mockIO();
    const result = await handleReject([], io);
    expect(result).toBe(1);
    expect(io.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Missing session ID'));
  });

  it('rejects permission for a full UUID', async () => {
    const io = mockIO();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    const result = await handleReject(['acc154fb-ec97-4e64-bd8c-b23fbcec6889'], io);
    expect(result).toBe(0);
    expect(io.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Rejected'));
  });

  it('rejects permission for a prefix', async () => {
    const io = mockIO();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    const result = await handleReject(['acc154fb'], io);
    expect(result).toBe(0);
    expect(io.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Rejected'));
  });

  it('returns error on API failure', async () => {
    const io = mockIO();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      statusText: 'Not Found',
      json: async () => ({ error: 'Session not found' }),
    } as Response);

    const result = await handleReject(['acc154fb'], io);
    expect(result).toBe(1);
    expect(io.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Session not found'));
  });
});
