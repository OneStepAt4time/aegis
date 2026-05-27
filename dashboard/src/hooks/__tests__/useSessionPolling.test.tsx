import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSessionPolling } from '../useSessionPolling';

// Mock API client
vi.mock('../../api/client', () => ({
  getSession: vi.fn().mockResolvedValue({ id: 's1', status: 'idle' }),
  getSessionHealth: vi.fn().mockResolvedValue({ alive: true, health: 'ok' }),
  getSessionPane: vi.fn().mockResolvedValue({ pane: '$ ' }),
  getSessionMetrics: vi.fn().mockResolvedValue({ tokens: 100 }),
  getSessionLatency: vi.fn().mockResolvedValue({ avg: 50 }),
  subscribeSSE: vi.fn().mockReturnValue(() => {}),
}));

vi.mock('../../api/schemas', () => ({
  SessionSSEEventDataSchema: {
    safeParse: vi.fn().mockReturnValue({ success: false }),
  },
}));

vi.mock('../../store/useStore', () => ({
  useStore: Object.assign(
    (s: (state: Record<string, unknown>) => unknown) => s({ token: 'test-token' }),
    { getState: () => ({ token: 'test-token' }) },
  ),
}));

vi.mock('../../store/useToastStore', () => ({
  useToastStore: () => ({ addToast: vi.fn() }),
}));

describe('useSessionPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns initial loading state', () => {
    const { result } = renderHook(() => useSessionPolling('s1'));
    expect(result.current.loading).toBe(true);
    expect(result.current.session).toBeNull();
    expect(result.current.notFound).toBe(false);
  });

  it('returns pane loading state initially', () => {
    const { result } = renderHook(() => useSessionPolling('s1'));
    expect(result.current.paneLoading).toBe(true);
    expect(result.current.paneContent).toBe('');
  });

  it('returns metrics loading state initially', () => {
    const { result } = renderHook(() => useSessionPolling('s1'));
    expect(result.current.metricsLoading).toBe(true);
    expect(result.current.metrics).toBeNull();
  });

  it('returns latency loading state initially', () => {
    const { result } = renderHook(() => useSessionPolling('s1'));
    expect(result.current.latencyLoading).toBe(true);
    expect(result.current.latency).toBeNull();
  });

  it('loads session data on mount', async () => {
    const { result } = renderHook(() => useSessionPolling('s1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.session).toEqual({ id: 's1', status: 'idle' });
    expect(result.current.notFound).toBe(false);
  });

  it('sets notFound on 404', async () => {
    const { getSession } = await import('../../api/client');
    const err = new Error('Not found') as Error & { statusCode: number };
    err.statusCode = 404;
    vi.mocked(getSession).mockRejectedValueOnce(err);

    const { result } = renderHook(() => useSessionPolling('s1'));

    await waitFor(() => {
      expect(result.current.notFound).toBe(true);
    });
  });

  it('exposes refetchPaneAndMetrics function', () => {
    const { result } = renderHook(() => useSessionPolling('s1'));
    expect(typeof result.current.refetchPaneAndMetrics).toBe('function');
  });

  it('loads pane content', async () => {
    const { result } = renderHook(() => useSessionPolling('s1'));

    await waitFor(() => {
      expect(result.current.paneLoading).toBe(false);
    });

    expect(result.current.paneContent).toBe('$ ');
  });

  it('loads metrics', async () => {
    const { result } = renderHook(() => useSessionPolling('s1'));

    await waitFor(() => {
      expect(result.current.metricsLoading).toBe(false);
    });

    expect(result.current.metrics).toEqual({ tokens: 100 });
  });

  it('loads latency', async () => {
    const { result } = renderHook(() => useSessionPolling('s1'));

    await waitFor(() => {
      expect(result.current.latencyLoading).toBe(false);
    });

    expect(result.current.latency).toEqual({ avg: 50 });
  });
});
