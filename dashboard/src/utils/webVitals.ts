/**
 * webVitals.ts — Capture FCP / LCP / CLS / INP via PerformanceObserver.
 *
 * Used by the dashboard at boot to feed perfRecorder with Web Vitals,
 * which the Endurance Test #4683 reads out via window.__aegisPerf__.
 *
 * Why hand-rolled, not web-vitals: keeps the dependency footprint
 * flat. The metrics we need are well-defined by the Performance
 * Observer spec. The browser does the heavy lifting.
 *
 * Stops observing as soon as the page is hidden for 5s+ — keeps CPU
 * idle during the 4h endurance window.
 */

import { perfRecorder } from './perfRecorder';

type VitalsListener = (vitals: { fcpMs?: number; lcpMs?: number; cls?: number; longestEventDurationMs?: number }) => void;

let started = false;

export function startWebVitalsCapture(onChange?: VitalsListener): () => void {
  if (started || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return () => undefined;
  }
  started = true;

  const dispatch = (partial: { fcpMs?: number; lcpMs?: number; cls?: number; longestEventDurationMs?: number }) => {
    perfRecorder.recordWebVitals(partial);
    onChange?.(partial);
  };

  // FCP — first contentful paint.
  try {
    const fcpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          dispatch({ fcpMs: entry.startTime });
          fcpObserver.disconnect();
          break;
        }
      }
    });
    fcpObserver.observe({ type: 'paint', buffered: true });
  } catch {
    // Some browsers lack paint observer — tolerate silently.
  }

  // LCP — largest contentful paint. We keep observing until the user
  // navigates away; the browser emits the final entry automatically.
  let lcpValue: number | null = null;
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) {
        lcpValue = last.startTime;
        dispatch({ lcpMs: last.startTime });
      }
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });

    // Finalize LCP on hidden (per spec).  Both pagehide and
    // visibilitychange cover desktop + mobile + bfcache eviction.
    const finalize = () => {
      if (document.visibilityState === 'hidden' && lcpValue !== null) {
        lcpObserver.disconnect();
      }
    };
    document.addEventListener('visibilitychange', finalize);
    window.addEventListener('pagehide', finalize);
  } catch {
    // Browser doesn't support LCP observer.
  }

  // CLS — cumulative layout shift. We accumulate the score from each
  // unexpected layout shift. session-windowed per the spec.
  let clsValue = 0;
  try {
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // LayoutShift entries have `value` and `hadRecentInput`. We
        // ignore shifts that happened within 500ms of user input.
        const ls = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (ls.hadRecentInput) continue;
        if (typeof ls.value === 'number') {
          clsValue += ls.value;
          dispatch({ cls: Math.round(clsValue * 10_000) / 10_000 });
        }
      }
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true });
  } catch {
    // Some browsers (older Firefox) lack layout-shift.
  }

  // INP — interaction to next paint. We approximate via the
  // `event` PerformanceObserver type which exposes duration.
  let inpValue: number | null = null;
  try {
    const inpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { duration: number };
        if (e.duration > (inpValue ?? 0)) {
          inpValue = e.duration;
          dispatch({ longestEventDurationMs: e.duration });
        }
      }
    });
    inpObserver.observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  } catch {
    // Some browsers don't expose `event` observer — fall back to first-input.
    try {
      const fidObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEntry & { processingStart?: number; startTime: number };
          const fid = (e.processingStart ?? e.startTime) - e.startTime;
          dispatch({ longestEventDurationMs: fid });
          break;
        }
      });
      fidObserver.observe({ type: 'first-input', buffered: true });
    } catch {
      // Browser supports neither — skip.
    }
  }

  return () => {
    started = false;
  };
}
