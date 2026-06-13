/**
 * commands/reject.test.ts — Unit tests for `ag reject` CLI command.
 * Issue #4685: CLI approval commands for headless/agent use cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  return {
    resolveSessionId: vi.fn().mockResolvedValue('acc154fb-ec97-4e64-bd8c-b23fbcec6889'),
  };
});

const mockIO = () => ({
  stdin: process.stdin,
  stdout: { write: vi.fn() } as unknown as NodeJS.WritableStream,
  stderr: { write: vi.fn() } as unknown as NodeJS.WritableStream,
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

  it('rejects specific approval without reason', async () => {
    const io = mockIO();
    
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'working' }),
    } as Response);

    const result = await handleReject(['acc154fb', 'approval-456'], io);
    
    expect(result).toBe(0);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:9100/v1/sessions/acc154fb-ec97-4e64-bd8c-b23fbcec6889/approval/reject',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ approvalId: 'approval-456' }),
      })
    );
  });

  it('returns error on API failure', async () => {
    const io = mockIO();
    
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      statusText: 'Not Found',
      json: async () => ({ error: 'Session not found' }),
    } as Response);

    const result = await handleReject(['acc154fb', 'approval-123'], io);
    
    expect(result).toBe(1);
    expect(io.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Session not found'));
  });
});
