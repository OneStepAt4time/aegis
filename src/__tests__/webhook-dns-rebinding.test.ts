/**
 * webhook-dns-rebinding.test.ts — Tests for DNS rebinding protection in webhook delivery.
 *
 * Validates that deliverWithRetry resolves DNS before each fetch attempt
 * and blocks delivery when DNS rebinding points to a private/internal IP.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SessionEventPayload } from '../channels/types.js';

// Mock SSRF module — resolveAndCheckIp is forwarded to a controllable mock
const mockResolveAndCheckIp = vi.fn();
vi.mock('../ssrf.js', () => ({
  validateWebhookUrl: vi.fn().mockReturnValue(null),
  resolveAndCheckIp: (...args: unknown[]) => mockResolveAndCheckIp(...args),
  buildConnectionUrl: (url: string, ip: string) => {
    const parsed = new URL(url);
    const originalHost = parsed.host;
    parsed.hostname = ip;
    return { connectionUrl: parsed.toString(), hostHeader: originalHost };
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocks
const { WebhookChannel } = await import('../channels/webhook.js');

function makePayload(): SessionEventPayload {
  return {
    event: 'session.created',
    timestamp: new Date().toISOString(),
    session: { id: 'test-1', name: 'test', workDir: '/tmp' },
    detail: 'test',
  };
}

describe('WebhookChannel DNS rebinding protection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
    mockResolveAndCheckIp.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function flushTimers(promise: Promise<void>, iterations = 30): Promise<void> {
    for (let i = 0; i < iterations; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    await promise;
  }

  it('resolves DNS and uses connection URL with IP substitution', async () => {
    mockResolveAndCheckIp.mockResolvedValue({
      error: null,
      resolvedIp: '93.184.216.34',
    });
    mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook', timeoutMs: 1000 }],
    });

    await channel.onSessionCreated(makePayload());

    expect(mockResolveAndCheckIp).toHaveBeenCalledWith('example.com');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Fetch URL should contain the resolved IP
    const fetchUrl = mockFetch.mock.calls[0][0] as string;
    expect(fetchUrl).toContain('93.184.216.34');
    // Host header should preserve original hostname
    const fetchOpts = mockFetch.mock.calls[0][1] as RequestInit;
    expect((fetchOpts.headers as Record<string, string>)['Host']).toBe('example.com');
  });

  it('blocks delivery when DNS resolves to private IP', async () => {
    mockResolveAndCheckIp.mockResolvedValue({
      error: 'DNS resolution points to a private/internal IP: 10.0.0.1',
      resolvedIp: null,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook', timeoutMs: 1000 }],
    });

    const promise = channel.onSessionCreated(makePayload());
    await flushTimers(promise);

    // Fetch should never be called
    expect(mockFetch).not.toHaveBeenCalled();
    // DNS check retried MAX_RETRIES times
    expect(mockResolveAndCheckIp).toHaveBeenCalledTimes(3);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('detects DNS rebinding on retry: public then private', async () => {
    // First attempt: DNS resolves to public IP but fetch fails (5xx)
    mockResolveAndCheckIp.mockResolvedValueOnce({
      error: null,
      resolvedIp: '93.184.216.34',
    });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    // Second attempt: DNS rebinds to private IP
    mockResolveAndCheckIp.mockResolvedValueOnce({
      error: 'DNS resolution points to a private/internal IP: 169.254.169.254',
      resolvedIp: null,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook', timeoutMs: 1000 }],
    });

    const promise = channel.onSessionCreated(makePayload());
    await flushTimers(promise);

    // First fetch was called with the public IP
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchUrl = mockFetch.mock.calls[0][0] as string;
    expect(fetchUrl).toContain('93.184.216.34');
    // DNS checked at least twice: once before first fetch, once before second
    expect(mockResolveAndCheckIp.mock.calls.length).toBeGreaterThanOrEqual(2);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('skips DNS check for localhost (dev mode)', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

    const channel = new WebhookChannel({
      endpoints: [{ url: 'http://127.0.0.1:3000/hook' }],
    });

    await channel.onSessionCreated(makePayload());

    expect(mockResolveAndCheckIp).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:3000/hook');
  });

  it('handles DNS failure gracefully', async () => {
    mockResolveAndCheckIp.mockResolvedValue({
      error: 'DNS resolution failed for example.com',
      resolvedIp: null,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook', timeoutMs: 1000 }],
    });

    const promise = channel.onSessionCreated(makePayload());
    await flushTimers(promise);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockResolveAndCheckIp).toHaveBeenCalledTimes(3);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('re-resolves DNS on each retry attempt', async () => {
    mockResolveAndCheckIp.mockResolvedValue({
      error: null,
      resolvedIp: '93.184.216.34',
    });
    mockFetch.mockResolvedValue({ ok: false, status: 503 } as Response);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const channel = new WebhookChannel({
      endpoints: [{ url: 'https://example.com/hook', timeoutMs: 1000 }],
    });

    const promise = channel.onSessionCreated(makePayload());
    await flushTimers(promise);

    // DNS checked before each of the 3 fetch attempts (Issue #2144: MAX_RETRIES=3)
    expect(mockResolveAndCheckIp).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
