/**
 * PerfPanel.tsx — Dev-only floating panel showing live perfRecorder numbers.
 *
 * Enable with `?perf=1` in the URL. Useful for the Endurance Test #4683
 * runner: a screenshot of this panel at the end of the run is the
 * cheapest way to capture the numbers without writing a scraping script.
 *
 * Renders nothing in production builds, regardless of the query string.
 */

import { useEffect, useState } from 'react';
import { perfRecorder, type PerfSnapshot } from '../utils/perfRecorder';

const POLL_MS = 1000;

function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function routeSummary(snap: PerfSnapshot): string {
  const routes = Object.entries(snap.pageLoadByRoute);
  if (routes.length === 0) return '—';
  return routes
    .map(([route, stat]) => {
      const p95 = formatMs(stat.p95Ms);
      const max = formatMs(stat.maxMs);
      return `${route}: n=${stat.count} p95=${p95} max=${max}`;
    })
    .join('\n');
}

function endpointSummary(
  bucket: Record<string, { opens: { count: number }; reconnects: { count: number }; giveUps: { count: number } }>,
  label: string,
): string {
  const keys = Object.keys(bucket);
  if (keys.length === 0) return `${label}: —`;
  return keys
    .map((k) => {
      const ep = bucket[k];
      return `${label} ${k.replace(/^.*\/\/[^/]+/, '')}: opens=${ep.opens.count} reconnects=${ep.reconnects.count} giveUps=${ep.giveUps.count}`;
    })
    .join('\n');
}

export function PerfPanel(): React.ReactElement | null {
  const enabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get('perf') === '1';
  const [snap, setSnap] = useState<PerfSnapshot | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => {
      setSnap(perfRecorder.snapshot());
    }, POLL_MS);
    setSnap(perfRecorder.snapshot());
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled || !snap) return null;

  const sseSumm = endpointSummary(snap.sse, 'SSE');
  const wsSumm = endpointSummary(snap.websocket, 'WS');

  return (
    <div
      data-testid="perf-panel"
      style={{
        position: 'fixed',
        right: 8,
        bottom: 8,
        zIndex: 9999,
        maxWidth: 480,
        maxHeight: '70vh',
        overflow: 'auto',
        padding: 12,
        background: 'rgba(10, 10, 15, 0.92)',
        color: '#e5e7eb',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        lineHeight: 1.4,
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.1)',
        whiteSpace: 'pre-wrap',
        pointerEvents: 'none',
      }}
    >
{`Aegis perf — uptime ${formatUptime(snap.uptimeMs)}

webVitals
  fcp=${formatMs(snap.webVitals.fcpMs)}
  lcp=${formatMs(snap.webVitals.lcpMs)}
  cls=${snap.webVitals.cls ?? '—'}
  inp=${formatMs(snap.webVitals.longestEventDurationMs)}

page-load by route
${routeSummary(snap)}

${sseSumm}

${wsSumm}

sessionList
  ssePushToRender: n=${snap.sessionList.ssePushToRenderCount} p50=${formatMs(snap.sessionList.ssePushToRenderP50Ms)} p95=${formatMs(snap.sessionList.ssePushToRenderP95Ms)} max=${formatMs(snap.sessionList.ssePushToRenderMaxMs)}
  apiRefreshToRender: n=${snap.sessionList.apiRefreshToRenderCount} p50=${formatMs(snap.sessionList.apiRefreshToRenderP50Ms)} p95=${formatMs(snap.sessionList.apiRefreshToRenderP95Ms)} max=${formatMs(snap.sessionList.apiRefreshToRenderMaxMs)}

memory
  usedJsHeapMb=${snap.memory?.usedJsHeapMb ?? '—'} totalJsHeapMb=${snap.memory?.totalJsHeapMb ?? '—'}`}
    </div>
  );
}
