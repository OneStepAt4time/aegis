import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockAddToast = vi.fn();
vi.mock('../../store/useToastStore', () => ({
  useToastStore: Object.assign(
    (selector: (s: { addToast: ReturnType<typeof vi.fn> }) => unknown) => selector({ addToast: mockAddToast }),
    { getState: () => ({ addToast: mockAddToast }) },
  ),
}));

describe('useApiData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches data on mount', async () => {
    const { useApiData } = await import('../useApiData');
    const fetcher = vi.fn().mockResolvedValue({ items: [1, 2, 3] });
    const { result } = renderHook(() => useApiData(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ items: [1, 2, 3] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('skips fetch when fetchOnMount=false', async () => {
    const { useApiData } = await import('../useApiData');
    const fetcher = vi.fn().mockResolvedValue('data');
    const { result } = renderHook(() => useApiData(fetcher, { fetchOnMount: false }));
    expect(result.current.loading).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sets error on fetch failure', async () => {
    const { useApiData } = await import('../useApiData');
    const fetcher = vi.fn().mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useApiData(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Network error');
    expect(mockAddToast).toHaveBeenCalledWith('error', 'Failed to fetch data', 'Network error');
  });

  it('shows rate limit message on 429', async () => {
    const { useApiData } = await import('../useApiData');
    const err = new Error('Too many requests') as Error & { statusCode: number };
    err.statusCode = 429;
    const fetcher = vi.fn().mockRejectedValue(err);
    const { result } = renderHook(() => useApiData(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Rate limit reached. Retrying automatically.');
  });

  it('refetch works manually', async () => {
    const { useApiData } = await import('../useApiData');
    const fetcher = vi.fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');
    const { result } = renderHook(() => useApiData(fetcher));
    await waitFor(() => expect(result.current.data).toBe('first'));
    await act(async () => { await result.current.refetch(); });
    expect(result.current.data).toBe('second');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('setData updates data optimistically', async () => {
    const { useApiData } = await import('../useApiData');
    const fetcher = vi.fn().mockResolvedValue('initial');
    const { result } = renderHook(() => useApiData(fetcher));
    await waitFor(() => expect(result.current.data).toBe('initial'));
    act(() => { result.current.setData('optimistic'); });
    expect(result.current.data).toBe('optimistic');
  });

  it('does not poll when pollingMs=0', async () => {
    const { useApiData } = await import('../useApiData');
    const fetcher = vi.fn().mockResolvedValue('once');
    renderHook(() => useApiData(fetcher, { pollingMs: 0 }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    // Wait a bit — no more calls
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns refreshing=true during refetch', async () => {
    const { useApiData } = await import('../useApiData');
    let resolveRefetch: (v: string) => void;
    const fetcher = vi.fn()
      .mockResolvedValueOnce('first')
      .mockImplementationOnce(() => new Promise(r => { resolveRefetch = r; }));
    const { result } = renderHook(() => useApiData(fetcher, { pollingMs: 0 }));
    await waitFor(() => expect(result.current.data).toBe('first'));
    act(() => { result.current.refetch(); });
    // refreshing should be true while in flight
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    await act(async () => { resolveRefetch!('second'); });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.data).toBe('second');
  });
});
