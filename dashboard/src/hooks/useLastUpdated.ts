/**
 * hooks/useLastUpdated.ts — Track the last time data was successfully refreshed.
 *
 * Returns a timestamp (ms since epoch) and a function to mark "just refreshed."
 * The tick() method should be called after every successful data fetch.
 */

import { useCallback, useRef, useState } from 'react';

export function useLastUpdated() {
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const tickRef = useRef(setLastUpdated);

  const tick = useCallback(() => {
    tickRef.current(Date.now());
  }, []);

  return { lastUpdated, tick };
}
