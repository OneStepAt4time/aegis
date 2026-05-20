import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { createSessionWithFallback } from '../api/client';

function mockJsonResponse(data: unknown, status = 201) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  } as Response;
}

const validSession = {
  id: 'session-123',
  displayName: 'test-session',
  workDir: '/tmp',
  status: 'idle',
  createdAt: Date.now(),
  lastActivity: Date.now(),
  stallThresholdMs: 300000,
  byteOffset: 0,
  monitorOffset: 0,
  permissionMode: 'default',
};

describe('createSessionWithFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns session directly when API response is valid', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(validSession));

    const result = await createSessionWithFallback({ workDir: '/tmp' });

    expect(result.id).toBe('session-123');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('falls back to session list when create response fails Zod validation', async () => {
    // First call: create returns 201 but with malformed body → Zod throws
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: 'weird shape' }));
    // Second call: getSessions returns valid session
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        sessions: [validSession],
        pagination: { page: 1, limit: 1, total: 1, totalPages: 1 },
      }),
    );

    const result = await createSessionWithFallback({ workDir: '/tmp' });

    expect(result.id).toBe('session-123');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws custom error when both create and list return nothing useful', async () => {
    // Create returns malformed → validation error → fallback
    mockFetch.mockResolvedValueOnce(mockJsonResponse({}));
    // List returns empty
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        sessions: [],
        pagination: { page: 1, limit: 1, total: 0, totalPages: 0 },
      }),
    );

    await expect(createSessionWithFallback({ workDir: '/tmp' })).rejects.toThrow(
      'Session was created but session info could not be retrieved',
    );
  });

  it('propagates HTTP 401 errors immediately (no fallback)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ error: 'Unauthorized' }),
      headers: new Headers(),
    } as Response);

    await expect(createSessionWithFallback({ workDir: '/tmp' })).rejects.toThrow('Unauthorized');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('propagates HTTP 500 errors immediately (no fallback)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: 'Internal Server Error' }),
      headers: new Headers(),
    } as Response);

    await expect(createSessionWithFallback({ workDir: '/tmp' })).rejects.toThrow('Internal Server Error');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('propagates network errors immediately (no fallback)', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(createSessionWithFallback({ workDir: '/tmp' })).rejects.toThrow('Failed to fetch');
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
