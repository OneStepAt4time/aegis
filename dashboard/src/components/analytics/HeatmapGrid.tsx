/**
 * components/analytics/HeatmapGrid.tsx — GitHub-style contribution heatmap.
 *
 * Renders a grid of colored cells where:
 * - Each cell = one day
 * - Rows = days of week (Mon–Sun)
 * - Columns = weeks
 * - Color intensity maps to the metric value
 *
 * Pure SVG implementation (no chart library dependency).
 * Follows the SparkLine.tsx pattern for theming via CSS custom properties.
 */

import { useMemo, useState, useCallback } from 'react';

export interface HeatmapDataPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

interface HeatmapGridProps {
  data: HeatmapDataPoint[];
  /** Number of weeks to display. Defaults to 53 (~1 year). */
  weeks?: number;
  /** Color accent for cells. Defaults to cyan. */
  color?: 'cyan' | 'purple' | 'green';
  /** Label shown in legend / aria. */
  metricLabel?: string;
  /** Format function for tooltip values. */
  formatValue?: (value: number) => string;
  className?: string;
}

const COLOR_SCALES = {
  cyan: {
    empty: 'var(--color-void-light)',
    level1: 'color-mix(in srgb, var(--color-accent-cyan) 20%, transparent)',
    level2: 'color-mix(in srgb, var(--color-accent-cyan) 40%, transparent)',
    level3: 'color-mix(in srgb, var(--color-accent-cyan) 65%, transparent)',
    level4: 'color-mix(in srgb, var(--color-accent-cyan) 90%, transparent)',
  },
  purple: {
    empty: 'var(--color-void-light)',
    level1: 'color-mix(in srgb, var(--color-accent-purple) 20%, transparent)',
    level2: 'color-mix(in srgb, var(--color-accent-purple) 40%, transparent)',
    level3: 'color-mix(in srgb, var(--color-accent-purple) 65%, transparent)',
    level4: 'color-mix(in srgb, var(--color-accent-purple) 90%, transparent)',
  },
  green: {
    empty: 'var(--color-void-light)',
    level1: 'color-mix(in srgb, var(--color-success) 20%, transparent)',
    level2: 'color-mix(in srgb, var(--color-success) 40%, transparent)',
    level3: 'color-mix(in srgb, var(--color-success) 65%, transparent)',
    level4: 'color-mix(in srgb, var(--color-success) 90%, transparent)',
  },
} as const;

type ColorScale = typeof COLOR_SCALES[keyof typeof COLOR_SCALES];
type IntensityLevel = 0 | 1 | 2 | 3 | 4;

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''] as const;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const CELL_SIZE = 12;
const CELL_GAP = 2;
const CELL_RADIUS = 2;
const LABEL_WIDTH = 32;
const MONTH_LABEL_HEIGHT = 18;

function getIntensityLevel(value: number, max: number): IntensityLevel {
  if (value === 0 || max === 0) return 0;
  const ratio = value / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function getLevelColor(level: IntensityLevel, scale: ColorScale): string {
  switch (level) {
    case 0: return scale.empty;
    case 1: return scale.level1;
    case 2: return scale.level2;
    case 3: return scale.level3;
    case 4: return scale.level4;
  }
}

interface GridCell {
  date: string;
  row: number;
  col: number;
  value: number;
  level: IntensityLevel;
}

interface MonthMarker {
  label: string;
  col: number;
}

interface TooltipState {
  date: string;
  value: number;
  x: number;
  y: number;
}

export function HeatmapGrid({
  data,
  weeks = 53,
  color = 'cyan',
  metricLabel = 'Activity',
  formatValue = (v) => String(v),
  className = '',
}: HeatmapGridProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const scale = COLOR_SCALES[color];

  // Build date → value lookup
  const valueMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const dp of data) {
      map.set(dp.date, dp.value);
    }
    return map;
  }, [data]);

  const maxValue = useMemo(() => Math.max(1, ...data.map((d) => d.value)), [data]);

  // Generate grid cells starting from Monday, `weeks` weeks back from today
  const { cells, monthMarkers } = useMemo(() => {
    const today = new Date();
    // Find the most recent Sunday (end of current week)
    const dayOfWeek = today.getDay(); // 0=Sun
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + ((7 - dayOfWeek) % 7));

    // Start from `weeks` weeks before, aligned to Monday
    const start = new Date(endOfWeek);
    start.setDate(endOfWeek.getDate() - (weeks * 7 - 1));
    const startDay = start.getDay();
    const mondayOffset = startDay === 0 ? -6 : 1 - startDay;
    start.setDate(start.getDate() + mondayOffset);

    const result: GridCell[] = [];
    const markers: MonthMarker[] = [];
    let lastMonth = -1;

    for (let week = 0; week < weeks; week++) {
      for (let day = 0; day < 7; day++) {
        const d = new Date(start);
        d.setDate(start.getDate() + week * 7 + day);

        const dateStr = d.toISOString().split('T')[0] ?? '';
        const value = valueMap.get(dateStr) ?? 0;
        const level = getIntensityLevel(value, maxValue);

        result.push({ date: dateStr, row: day, col: week, value, level });

        const month = d.getMonth();
        if (day === 0 && month !== lastMonth) {
          markers.push({ label: MONTH_LABELS[month], col: week });
          lastMonth = month;
        }
      }
    }

    return { cells: result, monthMarkers: markers };
  }, [weeks, valueMap, maxValue]);

  const handleCellEnter = useCallback(
    (cell: GridCell) => {
      setTooltip({
        date: cell.date,
        value: cell.value,
        x: LABEL_WIDTH + cell.col * (CELL_SIZE + CELL_GAP),
        y: MONTH_LABEL_HEIGHT + cell.row * (CELL_SIZE + CELL_GAP),
      });
    },
    [],
  );

  const handleCellLeave = useCallback(() => setTooltip(null), []);

  const svgWidth = LABEL_WIDTH + weeks * (CELL_SIZE + CELL_GAP);
  const svgHeight = MONTH_LABEL_HEIGHT + 7 * (CELL_SIZE + CELL_GAP);

  return (
    <div className={className}>
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        role="img"
        aria-label={`${metricLabel} heatmap: ${cells.length} days`}
      >
        {/* Month labels */}
        {monthMarkers.map((m, i) => (
          <text
            key={`${m.label}-${i}`}
            x={LABEL_WIDTH + m.col * (CELL_SIZE + CELL_GAP)}
            y={12}
            fill="var(--color-text-muted)"
            fontSize={10}
            fontFamily="ui-monospace, monospace"
          >
            {m.label}
          </text>
        ))}

        {/* Day labels */}
        {DAY_LABELS.map((label, i) =>
          label ? (
            <text
              key={label}
              x={0}
              y={
                MONTH_LABEL_HEIGHT +
                i * (CELL_SIZE + CELL_GAP) +
                CELL_SIZE / 2 +
                3
              }
              fill="var(--color-text-muted)"
              fontSize={9}
              fontFamily="ui-monospace, monospace"
            >
              {label}
            </text>
          ) : null,
        )}

        {/* Cells */}
        {cells.map((cell) => (
          <rect
            key={cell.date}
            x={LABEL_WIDTH + cell.col * (CELL_SIZE + CELL_GAP)}
            y={MONTH_LABEL_HEIGHT + cell.row * (CELL_SIZE + CELL_GAP)}
            width={CELL_SIZE}
            height={CELL_SIZE}
            rx={CELL_RADIUS}
            fill={getLevelColor(cell.level, scale)}
            stroke="var(--color-void-lighter)"
            strokeWidth={0.5}
            onMouseEnter={() => handleCellEnter(cell)}
            onMouseLeave={handleCellLeave}
            role="gridcell"
            aria-label={`${cell.date}: ${formatValue(cell.value)} ${metricLabel}`}
          >
            <title>{`${cell.date}: ${formatValue(cell.value)}`}</title>
          </rect>
        ))}

        {/* Tooltip overlay */}
        {tooltip && (
          <g pointerEvents="none">
            <rect
              x={tooltip.x - 56}
              y={tooltip.y - 32}
              width={112}
              height={24}
              rx={4}
              fill="var(--color-surface-strong)"
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            <text
              x={tooltip.x}
              y={tooltip.y - 16}
              textAnchor="middle"
              fill="var(--color-text-primary)"
              fontSize={10}
              fontFamily="ui-monospace, monospace"
            >
              {tooltip.date}: {formatValue(tooltip.value)}
            </text>
          </g>
        )}
      </svg>

      {/* Legend */}
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-[var(--color-text-muted)]">
        <span>Less</span>
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <div
            key={level}
            className="rounded-sm border border-[var(--color-void-lighter)]"
            style={{
              width: CELL_SIZE,
              height: CELL_SIZE,
              backgroundColor: getLevelColor(level, scale),
            }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
