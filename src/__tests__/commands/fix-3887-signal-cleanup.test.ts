/**
 * Issue #3887: ag run timeout leaves orphaned sessions in idle state
 *
 * Tests that killSessionOnExit correctly calls the kill endpoint,
 * swallows errors, and handles edge cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('killSessionOnExit (Issue #3887)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should POST to /sessions/:id/kill with auth token', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) });

    // Dynamic import to get fresh module
    const mod = await import('../../commands/run.js?' + Date.now());
    await mod.killSessionOnExit('http://127.0.0.1:9100/v1', 'session-123', 'test-token');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9100/v1/sessions/session-123/kill',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
      }),
    );
  });

  it('should POST to /sessions/:id/kill without auth token', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) });

    const mod = await import('../../commands/run.js?' + Date.now());
    await mod.killSessionOnExit('http://127.0.0.1:9100/v1', 'session-456', undefined);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:9100/v1/sessions/session-456/kill');
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual({});
  });

  it('should swallow network errors (best-effort)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const mod = await import('../../commands/run.js?' + Date.now());
    await expect(
      mod.killSessionOnExit('http://127.0.0.1:9100/v1', 'session-789', 'token'),
    ).resolves.toBeUndefined();
  });

  it('should swallow abort/timeout errors (best-effort)', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new DOMException('Aborted', 'AbortError')));

    const mod = await import('../../commands/run.js?' + Date.now());
    await expect(
      mod.killSessionOnExit('http://127.0.0.1:9100/v1', 'session-abc', 'token'),
    ).resolves.toBeUndefined();
  });

  it('should handle 404 gracefully (session already gone)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Not found' }) });

    const mod = await import('../../commands/run.js?' + Date.now());
    await expect(
      mod.killSessionOnExit('http://127.0.0.1:9100/v1', 'session-gone', 'token'),
    ).resolves.toBeUndefined();
  });
});
