import { useEffect } from 'react';
import { perfRecorder } from '../utils/perfRecorder';

/**
 * Record per-route page-load timing using a double-requestAnimationFrame
 * pattern ("after first paint").  Runs on every `pathname` change.
 *
 * The start time is captured **inside the effect** so the first sample
 * measures time from the route change to the next paint, not from app
 * mount to the first paint.  (See Argus review on PR #4723.)
 */
export function usePerfPageLoad(pathname: string) {
  useEffect(() => {
    const route = pathname;
    const startedAt = performance.now();
    let cancelled = false;

    const finalize = () => {
      if (cancelled) return;
      const ms = performance.now() - startedAt;
      perfRecorder.recordPageLoad(route, ms, true);
    };

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => finalize());
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [pathname]);
}
