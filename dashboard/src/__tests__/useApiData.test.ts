/**
 * __tests__/useApiData.test.ts — Tests for shared data-fetching hook.
 * @ticket #2935
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useApiData } from '../hooks/useApiData';

// Mock toast store
vi.mock('../store/useToastStore', () => ({
  useToastStore: (selector: (state: { addToast: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

describe('useApiData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts in loading state when fetchOnMount is true', () => {
    const fetcher = vi.fn(() => new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useApiData(fetcher));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('fetches data on mount and resolves', async () => {
    const mockData = [{ id: '1', name: 'test' }];
    const fetcher = vi.fn(async () => mockData);
    const { result } = renderHook(() => useApiData(fetcher, { pollingMs: 0 }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBeNull();
    expect(fetcher).toHaveBeenCalled(); // React strict mode may double-invoke
  });

  it('does not fetch on mount when fetchOnMount is false', () => {
    const fetcher = vi.fn(async () => []);
    renderHook(() => useApiData(fetcher, { fetchOnMount: false }));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('handles fetch errors and sets error state', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('Network error');
    });
    const { result } = renderHook(() =>
      useApiData(fetcher, { errorPrefix: 'Failed to load' })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('Network error');
  });

  it('handles rate limit errors with friendly message', async () => {
    const error = new Error('Too many requests') as Error & { statusCode: number };
    error.statusCode = 429;
    const fetcher = vi.fn(async () => { throw error; });
    const { result } = renderHook(() => useApiData(fetcher));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Rate limit reached. Retrying automatically.');
  });

  it('refetch function is exposed and callable', () => {
    const fetcher = vi.fn(async () => ['data']);
    const { result } = renderHook(() => useApiData(fetcher, { fetchOnMount: false }));

    expect(result.current.refetch).toBeDefined();
    expect(typeof result.current.refetch).toBe('function');
  });

  it('setData allows optimistic updates', async () => {
    const fetcher = vi.fn(async () => ['server-data']);
    const { result } = renderHook(() => useApiData(fetcher, { fetchOnMount: false }));

    act(() => {
      result.current.setData(['optimistic-data']);
    });

    expect(result.current.data).toEqual(['optimistic-data']);
  });

  it('sets refreshing flag during refetch', async () => {
    let resolveRef: () => void;
    const fetcher = vi.fn(() => new Promise<string[]>((resolve) => {
      resolveRef = () => resolve(['data']);
    }));

    const { result } = renderHook(() => useApiData(fetcher, { fetchOnMount: false }));

    // Start refetch
    let refetchPromise: Promise<unknown>;
    act(() => {
      refetchPromise = result.current.refetch();
    });

    expect(result.current.refreshing).toBe(true);

    // Resolve the fetch
    await act(async () => {
      resolveRef!();
      await refetchPromise;
    });

    expect(result.current.refreshing).toBe(false);
  });
});
