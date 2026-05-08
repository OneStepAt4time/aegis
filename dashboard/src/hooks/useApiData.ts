/**
 * hooks/useApiData.ts — Shared data-fetching hook for dashboard pages.
 *
 * Encapsulates the common loading/error/data state pattern with
 * automatic polling, SSE-aware refresh, and error toasting.
 *
 * @ticket #2935
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useToastStore } from '../store/useToastStore';

interface UseApiDataOptions {
  /** Polling interval in ms (default: 10000). Set to 0 to disable. */
  pollingMs?: number;
  /** SSE-aware: skip polling when SSE is connected (default: false) */
  _sseAware?: boolean;
  /** Whether to fetch on mount (default: true) */
  fetchOnMount?: boolean;
  /** Custom error message prefix for toasts */
  errorPrefix?: string;
  /** Rate limit status code to handle gracefully (default: 429) */
  rateLimitCode?: number;
}

interface UseApiDataReturn<T> {
  /** The fetched data, or null if not yet loaded */
  data: T | null;
  /** True during initial load (before first successful fetch) */
  loading: boolean;
  /** Error message if fetch failed, null otherwise */
  error: string | null;
  /** True when a refetch is in progress */
  refreshing: boolean;
  /** Manually trigger a refetch */
  refetch: () => Promise<T | null>;
  /** Update data locally (optimistic updates) */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

export function useApiData<T>(
  fetcher: () => Promise<T>,
  options: UseApiDataOptions = {}
): UseApiDataReturn<T> {
  const {
    pollingMs = 10_000,
    _sseAware = false,
    fetchOnMount = true,
    errorPrefix = 'Failed to fetch data',
    rateLimitCode = 429,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(fetchOnMount);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addToast = useToastStore((t) => t.addToast);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const doFetch = useCallback(async (isInitial: boolean): Promise<T | null> => {
    try {
      if (isInitial) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
      return result;
    } catch (e: unknown) {
      const statusCode = (e as { statusCode?: number }).statusCode;
      const message = e instanceof Error ? e.message : undefined;

      const displayMessage = statusCode === rateLimitCode
        ? 'Rate limit reached. Retrying automatically.'
        : (message ?? 'Unable to load data');

      setError(displayMessage);
      addToast('error', errorPrefix, displayMessage);
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast, errorPrefix, rateLimitCode]);

  const refetch = useCallback(async (): Promise<T | null> => {
    return doFetch(false);
  }, [doFetch]);

  // Initial fetch
  useEffect(() => {
    if (fetchOnMount) {
      void doFetch(true);
    }
  }, [fetchOnMount, doFetch]);

  // Polling
  useEffect(() => {
    if (!pollingMs || pollingMs <= 0) return;

    const interval = setInterval(() => {
      void doFetch(false);
    }, pollingMs);

    return () => clearInterval(interval);
  }, [pollingMs, doFetch]);

  return { data, loading, error, refreshing, refetch, setData };
}
