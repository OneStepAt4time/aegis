/**
 * commands/read.test.ts — Unit tests for `ag read` CLI command.
 * Issue #4684: Fix TypeError crash on non-text content.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveSessionId } from '../../commands/read.js';

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

const mockIO = () => ({
  stdin: process.stdin,
  stdout: { write: vi.fn() } as unknown as NodeJS.WritableStream,
  stderr: { write: vi.fn() } as unknown as NodeJS.WritableStream,
});

describe('resolveSessionId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('returns full UUID as-is', async () => {
    const io = mockIO();
    const id = 'acc154fb-ec97-4e64-bd8c-b23fbcec6889';
    const result = await resolveSessionId(id, 'http://localhost:9100', {}, io);
    expect(result).toBe(id);
  });

  it('resolves prefix to full UUID', async () => {
    const io = mockIO();
    
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sessions: [{ id: 'acc154fb-ec97-4e64-bd8c-b23fbcec6889' }],
      }),
    } as Response);

    const result = await resolveSessionId('acc154fb', 'http://localhost:9100', {}, io);
    expect(result).toBe('acc154fb-ec97-4e64-bd8c-b23fbcec6889');
  });

  it('returns null for ambiguous prefix', async () => {
    const io = mockIO();
    
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sessions: [
          { id: 'acc154fb-ec97-4e64-bd8c-b23fbcec6889' },
          { id: 'acc154fb-ec97-4e64-bd8c-b23fbcec688a' },
        ],
      }),
    } as Response);

    const result = await resolveSessionId('acc154fb', 'http://localhost:9100', {}, io);
    expect(result).toBeNull();
  });
});
