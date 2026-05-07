/**
 * components/shared/ModelDistributionBar.tsx — Segmented horizontal bar showing model usage distribution.
 *
 * Displays model proportions as colored stacked segments with labels.
 * Used by CostPage, SessionDetailPage, and project cards (#2808, #2832).
 *
 * Supports:
 * - Custom model → color mapping
 * - Compact mode (bar only) and expanded mode (bar + legend)
 * - Responsive layout
 * - Dark/light mode via CSS variables
 */

import { useMemo } from 'react';

export interface ModelSegment {
  /** Model identifier (e.g. "claude-opus-4.7") */
  model: string;
  /** Numeric value (cost, tokens, count) */
  value: number;
  /** Display label override */
  label?: string;
  /** Color override */
  color?: string;
}

export interface ModelDistributionBarProps {
  /** Model segments, sorted or unsorted */
  segments: ModelSegment[];
  /** Total value (computed from segments if omitted) */
  total?: number;
  /** Unit for tooltip display */
  unit?: string;
  /** Compact mode — bar only, no legend */
  compact?: boolean;
  /** Bar height in pixels */
  height?: number;
  /** Show percentage labels inside segments */
  showPercentInBar?: boolean;
  /** Minimum percentage to show a label inside the bar */
  minPercentForLabel?: number;
  /** Additional CSS classes */
  className?: string;
}

const DEFAULT_MODEL_COLORS: Record<string, string> = {
  'claude-opus': 'var(--color-accent-purple, #8b5cf6)',
  'claude-sonnet': 'var(--color-accent-cyan, #06b6d4)',
  'claude-haiku': 'var(--color-success, #22c55e)',
  'gpt-5': 'var(--color-warning, #eab308)',
  'gpt-4': 'var(--color-info, #3b82f6)',
};

function getModelColor(model: string, fallback?: string): string {
  if (fallback) return fallback;
  const key = Object.keys(DEFAULT_MODEL_COLORS).find((k) => model.includes(k));
  return key ? DEFAULT_MODEL_COLORS[key] : 'var(--color-text-muted, #94a3b8)';
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function ModelDistributionBar({
  segments,
  total: totalProp,
  unit = '',
  compact = false,
  height = 10,
  showPercentInBar = true,
  minPercentForLabel = 0.08,
  className = '',
}: ModelDistributionBarProps) {
  const total = totalProp ?? useMemo(
    () => segments.reduce((s, seg) => s + seg.value, 0),
    [segments],
  );

  const sortedSegments = useMemo(() => {
    if (total === 0) return [];
    return [...segments]
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((s) => ({
        ...s,
        ratio: s.value / total,
        color: getModelColor(s.model, s.color),
        label: s.label ?? s.model,
      }));
  }, [segments, total]);

  if (sortedSegments.length === 0) {
    return (
      <div className={`text-xs text-[var(--color-text-muted)] ${className}`}>
        No data
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Bar */}
      <div
        className="flex w-full overflow-hidden rounded-full"
        style={{ height: `${height}px`, minHeight: `${height}px` }}
        role="img"
        aria-label={`Model distribution: ${sortedSegments.map((s) => `${s.label} ${formatPercent(s.ratio)}`).join(', ')}`}
      >
        {sortedSegments.map((seg) => (
          <div
            key={seg.model}
            className="relative transition-all duration-300 first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${seg.ratio * 100}%`,
              backgroundColor: seg.color,
              minWidth: seg.ratio > 0 ? '2px' : '0',
            }}
            title={`${seg.label}: ${formatPercent(seg.ratio)} (${seg.value.toLocaleString()} ${unit})`}
          >
            {showPercentInBar && seg.ratio >= minPercentForLabel && height >= 10 && (
              <span
                className="absolute inset-0 flex items-center justify-center text-[9px] font-medium text-white mix-blend-difference select-none"
                aria-hidden="true"
              >
                {formatPercent(seg.ratio)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      {!compact && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {sortedSegments.map((seg) => (
            <div key={seg.model} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-sm shrink-0"
                style={{ backgroundColor: seg.color }}
                aria-hidden="true"
              />
              <span className="text-[10px] text-[var(--color-text-muted)]">
                {seg.label}
              </span>
              <span className="text-[10px] font-mono font-medium text-[var(--color-text-primary)]">
                {formatPercent(seg.ratio)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
