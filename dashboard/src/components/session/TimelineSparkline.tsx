/**
 * components/session/TimelineSparkline.tsx — session activity sparkline.
 *
 * Issue 04.6 of the session-cockpit epic. See
 * `.claude/epics/session-cockpit/epic.md`.
 *
 * Renders a time-bucketed bar chart of transcript-entry timestamps. No
 * server endpoint is required — we derive the signal from the same
 * `state.entries` array the rest of the Metrics tab reads.
 *
 * Deferred from this PR:
 *   - Scroll-sync with the transcript (04.6 acceptance ref to issue 05):
 *     the transcript's virtualizer is scoped inside TranscriptView and
 *     lifting its ref through the StreamTab / SessionDetailPage tree is
 *     architecturally intrusive. Kept as a follow-up.
 *   - Event-kind colouring (message / tool / approval) — current data
 *     model does not carry approval/status events as transcript entries.
 */

import { useMemo, useState } from 'react';
import type { ParsedEntry } from '../../types';

export type TimelineRange = '1H' | '12H' | 'Today' | '7D' | '14D';

const RANGE_CONFIG: Record<
  TimelineRange,
  { windowMs: number; bucketCount: number }
> = {
  '1H': { windowMs: 60 * 60 * 1000, bucketCount: 60 },
  '12H': { windowMs: 12 * 60 * 60 * 1000, bucketCount: 72 },
  'Today': { windowMs: 24 * 60 * 60 * 1000, bucketCount: 48 },
  '7D': { windowMs: 7 * 24 * 60 * 60 * 1000, bucketCount: 56 },
  '14D': { windowMs: 14 * 24 * 60 * 60 * 1000, bucketCount: 56 },
};

interface TimelineSparklineProps {
  entries: readonly ParsedEntry[];
  /** Override current time for tests. Defaults to Date.now() at render. */
  nowMs?: number;
  /** Callback fired when the user clicks a bucket. Receives the bucket's
   *  midpoint timestamp in ms. */
  onSeek?: (timestampMs: number) => void;
  initialRange?: TimelineRange;
}

interface Bucket {
  startMs: number;
  endMs: number;
  count: number;
}

/** Pure bucket-fill helper. Exported for unit tests. */
export function bucketEntries(
  entries: readonly ParsedEntry[],
  range: TimelineRange,
  nowMs: number,
): Bucket[] {
  const { windowMs, bucketCount } = RANGE_CONFIG[range];
  const startMs = nowMs - windowMs;
  const bucketWidthMs = windowMs / bucketCount;

  const buckets: Bucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    startMs: startMs + i * bucketWidthMs,
    endMs: startMs + (i + 1) * bucketWidthMs,
    count: 0,
  }));

  for (const entry of entries) {
    if (!entry.timestamp) continue;
    const ts = Date.parse(entry.timestamp);
    if (Number.isNaN(ts)) continue;
    if (ts < startMs || ts > nowMs) continue;
    const idx = Math.min(
      bucketCount - 1,
      Math.floor((ts - startMs) / bucketWidthMs),
    );
    buckets[idx].count += 1;
  }

  return buckets;
}

export function TimelineSparkline({
  entries,
  nowMs,
  onSeek,
  initialRange = 'Today',
}: TimelineSparklineProps) {
  const [range, setRange] = useState<TimelineRange>(initialRange);

  const resolvedNow = nowMs ?? Date.now();
  const buckets = useMemo(
    () => bucketEntries(entries, range, resolvedNow),
    [entries, range, resolvedNow],
  );

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const totalEvents = buckets.reduce((sum, b) => sum + b.count, 0);

  return (
    <div className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          Timeline
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {totalEvents} {totalEvents === 1 ? 'event' : 'events'} in {range}
        </span>
        <div
          className="ml-auto flex gap-0.5 rounded-md bg-[var(--color-void-lighter)]/30 p-0.5"
          role="tablist"
          aria-label="Timeline range"
        >
          {(Object.keys(RANGE_CONFIG) as TimelineRange[]).map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={`px-2 py-0.5 text-[10px] font-mono uppercase rounded transition-colors ${
                range === r
                  ? 'bg-[var(--color-accent)] text-[var(--color-void)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div
        className="flex h-16 items-end gap-[1px]"
        data-testid="timeline-sparkline-bars"
        aria-label={`Activity sparkline, ${totalEvents} events in ${range}`}
      >
        {buckets.map((bucket, i) => {
          const heightPct = (bucket.count / maxCount) * 100;
          const isEmpty = bucket.count === 0;
          const midMs = (bucket.startMs + bucket.endMs) / 2;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSeek?.(midMs)}
              disabled={isEmpty}
              title={
                isEmpty
                  ? `No activity — ${new Date(bucket.startMs).toLocaleTimeString()}`
                  : `${bucket.count} ${bucket.count === 1 ? 'event' : 'events'} at ${new Date(bucket.startMs).toLocaleTimeString()}`
              }
              className={`flex-1 rounded-sm transition-all ${
                isEmpty
                  ? 'bg-[var(--color-void-lighter)]/30 cursor-default'
                  : 'bg-[var(--color-accent-cyan)]/70 hover:bg-[var(--color-accent-cyan)] cursor-pointer'
              }`}
              style={{
                height: isEmpty ? '2px' : `${Math.max(4, heightPct)}%`,
                transition: 'height var(--duration-slow) var(--ease-decelerate)',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
