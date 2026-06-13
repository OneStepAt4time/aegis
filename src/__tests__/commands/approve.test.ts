/**
 * commands/approve.test.ts — Unit tests for `ag approve` CLI command.
 * Issue #4685: CLI approval commands for headless/agent use cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleApprove } from '../../commands/approve.js';

// Mock cli-http module
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

// Mock read.js for resolveSessionId
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

  it('approves pending approval when exactly one exists', async () => {
    const io = mockIO();
    
    // Mock pending approval response
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ pending: [{ approvalId: 'approval-123', toolName: 'bash' }] }),
    } as Response);
    
    // Mock approve response
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'working' }),
    } as Response);

    const result = await handleApprove(['acc154fb'], io);
    
    expect(result).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenNthCalledWith(1, 
      'http://localhost:9100/v1/sessions/acc154fb-ec97-4e64-bd8c-b23fbcec6889/approval/pending',
      expect.any(Object)
    );
    expect(global.fetch).toHaveBeenNthCalledWith(2,
      'http://localhost:9100/v1/sessions/acc154fb-ec97-4e64-bd8c-b23fbcec6889/approval/approve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ approvalId: 'approval-123' }),
      })
    );
  });

  it('approves specific approval when ID is provided', async () => {
    const io = mockIO();
    
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'working' }),
    } as Response);

    const result = await handleApprove(['acc154fb', 'approval-456'], io);
    
    expect(result).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:9100/v1/sessions/acc154fb-ec97-4e64-bd8c-b23fbcec6889/approval/approve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ approvalId: 'approval-456' }),
      })
    );
  });

  it('returns error when multiple pending approvals and no ID specified', async () => {
    const io = mockIO();
    
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ 
        pending: [
          { approvalId: 'approval-1', toolName: 'bash' },
          { approvalId: 'approval-2', toolName: 'write' },
        ] 
      }),
    } as Response);

    const result = await handleApprove(['acc154fb'], io);
    
    expect(result).toBe(1);
    expect(io.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Multiple pending approvals'));
  });

  it('returns error when no pending approvals', async () => {
    const io = mockIO();
    
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ pending: [] }),
    } as Response);

    const result = await handleApprove(['acc154fb'], io);
    
    expect(result).toBe(1);
    expect(io.stderr.write).toHaveBeenCalledWith(expect.stringContaining('No pending approvals'));
  });

  it('returns error on API failure', async () => {
    const io = mockIO();
    
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'Server error' }),
    } as Response);

    const result = await handleApprove(['acc154fb', 'approval-123'], io);
    
    expect(result).toBe(1);
    expect(io.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Server error'));
  });
});
