/**
 * Tests for ag send CLI command (Issue #4487)
 *
 * Covers: argument parsing, error handling, success response.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSend } from '../../commands/send.js';

// Mock cli-http helpers
vi.mock('../../cli-http.js', () => ({
  resolveBaseUrl: vi.fn(() => 'http://localhost:3000'),
  resolveAuthToken: vi.fn(() => 'test-token'),
  buildHeaders: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
  requireServer: vi.fn(() => Promise.resolve(true)),
  writeLine: vi.fn(),
}));

// Mock resolveSessionId
vi.mock('../../commands/read.js', () => ({
  resolveSessionId: vi.fn((_id: string, _url: string, _headers: Record<string, string>, _io: unknown) =>
    Promise.resolve('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  ),
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { writeLine } from '../../cli-http.js';

function makeIo() {
  return { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } } as unknown as import('../../cli-http.js').CliIO;
}

describe('ag send command', () => {
  const io = makeIo();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should send message to resolved session', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ delivered: true, attempts: 1 }),
    });

    const result = await handleSend(['aaaaaaaa', 'use', 'the', 'other', 'approach'], io);

    expect(result).toBe(0);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/v1/sessions/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/send',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'use the other approach' }),
      }),
    );
  });

  it('should handle queued message (attempts === 0)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ delivered: false, attempts: 0 }),
    });

    const result = await handleSend(['aaaaaaaa', 'queued msg'], io);
    expect(result).toBe(0);
  });

  it('should return 1 when no session ID provided', async () => {
    const result = await handleSend([], io);
    expect(result).toBe(1);
    expect(writeLine).toHaveBeenCalledWith(expect.objectContaining({ write: expect.any(Function) }), expect.stringContaining('Missing session ID'));
  });

  it('should return 1 when no message provided', async () => {
    const result = await handleSend(['aaaaaaaa'], io);
    expect(result).toBe(1);
    expect(writeLine).toHaveBeenCalledWith(expect.objectContaining({ write: expect.any(Function) }), expect.stringContaining('Missing message'));
  });

  it('should return 1 on server error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'Session not found' }),
    });

    const result = await handleSend(['aaaaaaaa', 'hello'], io);
    expect(result).toBe(1);
  });
});
