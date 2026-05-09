/**
 * components/shared/ContributionHeatmap.tsx — GitHub-style contribution heatmap.
 *
 * Displays daily activity as a grid of colored cells (7 rows × N weeks).
 * Used by CostPage, SessionDetailPage, and AnalyticsPage (#2808, #2832). // token-ok
 *
 * Supports:
 * - Custom color scale (dark-first by default)
 * - Tooltip on hover with exact date and value
 * - Responsive week count
 * - Accessibility: screen reader summary, keyboard focus
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface HeatmapDay {
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  /** Numeric value (tokens, cost, lines, etc.) */
  value: number;
}

export interface ContributionHeatmapProps {
  /** Daily data points, expected in chronological order */
  data: HeatmapDay[];
  /** Label shown above the heatmap */
  label?: string;
  /** Unit for tooltip (e.g. "tokens", "$") */
  unit?: string;
  /** CSS color for empty/zero cells */
  emptyColor?: string;
  /** 5-step color scale from lowest to highest intensity */
  colorScale?: string[];
  /** Number of weeks to show (0 = auto-fit to data range) */
  weeks?: number;
  /** Cell size in pixels */
  cellSize?: number;
  /** Gap between cells in pixels */
  gap?: number;
  /** Callback when a cell is clicked */
  onCellClick?: (day: HeatmapDay) => void;
  /** Additional CSS classes */
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Defaults                                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_COLOR_SCALE = [
  'rgba(6, 182, 212, 0.08)',   // level 0 — near-invisible // token-ok
  'rgba(6, 182, 212, 0.25)',   // level 1 // token-ok
  'rgba(6, 182, 212, 0.50)',   // level 2 // token-ok
  'rgba(6, 182, 212, 0.75)',   // level 3 // token-ok
  'rgba(6, 182, 212, 1.00)',   // level 4 — full intensity // token-ok
];

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Quantile-based bucketing — distributes data into 5 levels evenly. */
function computeBuckets(values: number[]): number[] {
  if (values.length === 0) return [0, 0, 0, 0, 0];

  const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return [0, 0, 0, 0, 0];

  const thresholds = [0];
  for (let i = 1; i <= 4; i++) {
    const idx = Math.floor((nonZero.length * i) / 5);
    thresholds.push(nonZero[Math.min(idx, nonZero.length - 1)]);
  }

  // Ensure strictly increasing thresholds
  for (let i = 1; i < thresholds.length; i++) {
    if (thresholds[i] <= thresholds[i - 1]) {
      thresholds[i] = thresholds[i - 1] + 1;
    }
  }

  return thresholds;
}

function getLevel(value: number, buckets: number[]): number {
  if (value <= 0) return 0;
  for (let i = 1; i < buckets.length; i++) {
    if (value <= buckets[i]) return i;
  }
  return 4;
}

function formatValue(value: number, unit?: string): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ${unit ?? ''}`.trim();
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K ${unit ?? ''}`.trim();
  return `${value.toLocaleString()} ${unit ?? ''}`.trim();
}

/* ------------------------------------------------------------------ */
/*  Tooltip                                                            */
/* ------------------------------------------------------------------ */

function HeatmapTooltip({
  day,
  unit,
  cellSize,
}: {
  day: HeatmapDay;
  unit?: string;
  cellSize: number;
}) {
  const dateObj = new Date(day.date + 'T00:00:00');
  const dateStr = dateObj.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div
      className="pointer-events-none absolute z-50 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs shadow-xl whitespace-nowrap"
      style={{ transform: `translate(-50%, calc(-100% - ${cellSize + 4}px))` }}
    >
      <p className="font-medium text-[var(--color-text-primary)]">{dateStr}</p>
      <p className="text-[var(--color-text-muted)]">
        {formatValue(day.value, unit)}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ContributionHeatmap({
  data,
  label,
  unit = '',
  emptyColor = 'rgba(6, 182, 212, 0.06)', // token-ok
  colorScale = DEFAULT_COLOR_SCALE,
  weeks = 0,
  cellSize = 11,
  gap = 2,
  onCellClick,
  className = '',
}: ContributionHeatmapProps) {
  const [hoveredDay, setHoveredDay] = useState<HeatmapDay | null>(null);
  const [hoveredRect, setHoveredRect] = useState<{ x: number; y: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Build a sparse map: date string → value
  const dateMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of data) m.set(d.date, d.value);
    return m;
  }, [data]);

  // Determine date range
  const { startDate, numWeeks } = useMemo(() => {
    if (data.length === 0) {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - 364);
      return { startDate: start, numWeeks: weeks || 52 };
    }

    const dates = data.map((d) => new Date(d.date + 'T00:00:00'));
    const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));

    // Align minDate to the previous Monday
    const dayOfWeek = minDate.getDay();
    const aligned = new Date(minDate);
    aligned.setDate(aligned.getDate() - ((dayOfWeek + 6) % 7));

    // Align maxDate to the next Sunday
    const endDay = maxDate.getDay();
    const endPadding = (7 - endDay) % 7;
    const totalDays = maxDate.getTime() - aligned.getTime() + endPadding * 86400000;

    const w = weeks || Math.max(1, Math.ceil(totalDays / (7 * 86400000)) + 1);

    return { startDate: aligned, numWeeks: Math.min(w, 53) };
  }, [data, weeks]);

  // Compute buckets from actual values
  const buckets = useMemo(() => computeBuckets(data.map((d) => d.value)), [data]);

  // Build grid cells
  const cells = useMemo(() => {
    const result: Array<{
      date: string;
      value: number;
      level: number;
      weekIdx: number;
      dayIdx: number;
    }> = [];

    const cursor = new Date(startDate);
    for (let w = 0; w < numWeeks; w++) {
      for (let d = 0; d < 7; d++) {
        const dateStr = cursor.toISOString().slice(0, 10);
        const value = dateMap.get(dateStr) ?? 0;
        result.push({
          date: dateStr,
          value,
          level: getLevel(value, buckets),
          weekIdx: w,
          dayIdx: d,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    return result;
  }, [startDate, numWeeks, dateMap, buckets]);

  // Summary for screen readers
  const totalValue = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  const activeDays = useMemo(() => data.filter((d) => d.value > 0).length, [data]);

  const handleMouseEnter = useCallback(
    (day: HeatmapDay, e: React.MouseEvent) => {
      setHoveredDay(day);
      if (gridRef.current) {
        const rect = gridRef.current.getBoundingClientRect();
        setHoveredRect({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
    },
    [],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredDay(null);
    setHoveredRect(null);
  }, []);

  // Dismiss tooltip on scroll
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const parent = el.closest('.overflow-auto, .overflow-x-auto, .overflow-y-auto');
    if (!parent) return;
    const handler = () => {
      setHoveredDay(null);
      setHoveredRect(null);
    };
    parent.addEventListener('scroll', handler, { passive: true });
    return () => parent.removeEventListener('scroll', handler);
  }, []);

  const step = cellSize + gap;

  return (
    <div className={className} role="img" aria-label={`${label ?? 'Contribution heatmap'}: ${formatValue(totalValue, unit)} across ${activeDays} active days`}>
      {label && (
        <div className="mb-2 text-xs font-medium text-[var(--color-text-muted)]">
          {label}
        </div>
      )}

      <div className="relative">
        {/* Day-of-week labels */}
        <div
          className="flex flex-col"
          style={{ gap: `${gap}px`, position: 'absolute', left: 0, top: 0 }}
          aria-hidden="true"
        >
          {DAY_LABELS.map((d, i) => (
            <div
              key={i}
              style={{ height: `${cellSize}px`, lineHeight: `${cellSize}px` }}
              className="text-[9px] text-[var(--color-text-muted)] pr-1 text-right select-none"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Heatmap grid */}
        <div
          ref={gridRef}
          className="relative"
          style={{
            marginLeft: '26px',
            display: 'grid',
            gridTemplateColumns: `repeat(${numWeeks}, ${cellSize}px)`,
            gridTemplateRows: `repeat(7, ${cellSize}px)`,
            gap: `${gap}px`,
          }}
          onMouseLeave={handleMouseLeave}
        >
          {cells.map((cell) => {
            const isHovered = hoveredDay?.date === cell.date;
            const bgColor = cell.level === 0
              ? emptyColor
              : colorScale[Math.min(cell.level, colorScale.length - 1)];

            return (
              <div
                key={cell.date}
                role="gridcell"
                aria-label={`${cell.date}: ${formatValue(cell.value, unit)}`}
                tabIndex={onCellClick ? 0 : undefined}
                className="rounded-sm cursor-default transition-[outline] "
                style={{
                  width: `${cellSize}px`,
                  height: `${cellSize}px`,
                  backgroundColor: bgColor,
                  outline: isHovered ? '2px solid var(--color-text-primary)' : 'none',
                  outlineOffset: '0px',
                }}
                onMouseEnter={(e) =>
                  handleMouseEnter({ date: cell.date, value: cell.value }, e)
                }
                onClick={() => onCellClick?.({ date: cell.date, value: cell.value })}
                onKeyDown={(e) => {
                  if (onCellClick && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onCellClick({ date: cell.date, value: cell.value });
                  }
                }}
              />
            );
          })}

          {/* Tooltip */}
          {hoveredDay && hoveredRect && (
            <HeatmapTooltip
              day={hoveredDay}
              unit={unit}
              cellSize={cellSize}
            />
          )}
        </div>

        {/* Month labels */}
        <div
          className="flex text-[9px] text-[var(--color-text-muted)] select-none"
          style={{
            marginLeft: '26px',
            marginTop: `${gap}px`,
            gap: `${gap}px`,
          }}
          aria-hidden="true"
        >
          {Array.from({ length: numWeeks }, (_, w) => {
            const d = new Date(startDate);
            d.setDate(d.getDate() + w * 7);
            if (d.getDate() <= 7) {
              const month = d.toLocaleString('en-US', { month: 'short' });
              return (
                <div
                  key={w}
                  style={{
                    width: `${step * getWeeksInMonth(d) - gap}px`,
                  }}
                  className="truncate"
                >
                  {month}
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}

/** Count how many weeks a month spans starting from a given position. */
function getWeeksInMonth(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth();
  const monthEnd = new Date(year, month + 1, 0);
  const daysInMonth = monthEnd.getDate() - date.getDate() + 1;
  return Math.ceil(daysInMonth / 7);
}
