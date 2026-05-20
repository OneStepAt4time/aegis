/**
 * hooks/useLastUpdated.ts — Tracks the last successful data refresh timestamp.
 *
 * Returns a human-readable relative time string (e.g. "12s ago", "2m ago")
 * that updates every second. Call `markUpdated()` on every successful SSE event
 * or poll completion.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export function useLastUpdated() {
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [, forceUpdate] = useState(0);

  // Tick every second to refresh relative time display
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      forceUpdate((n) => n + 1);
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const markUpdated = useCallback(() => {
    setLastUpdated(Date.now());
  }, []);

  const secondsAgo = Math.floor((Date.now() - lastUpdated) / 1000);

  let relativeTime: string;
  if (secondsAgo < 5) {
    relativeTime = 'just now';
  } else if (secondsAgo < 60) {
    relativeTime = `${secondsAgo}s ago`;
  } else if (secondsAgo < 3600) {
    relativeTime = `${Math.floor(secondsAgo / 60)}m ago`;
  } else {
    relativeTime = `${Math.floor(secondsAgo / 3600)}h ago`;
  }

  const isStale = secondsAgo > 30;

  return { relativeTime, isStale, markUpdated, lastUpdated };
}
