/**
 * components/analytics/EfficiencyGauge.tsx — CCMeter-inspired efficiency gauge.
 *
 * Horizontal bar that transitions from green (efficient) → yellow (moderate)
 * → red (inefficient) based on a 0–100 score.
 *
 * Displays tokens-per-line (tok/ln) or any efficiency metric.
 * Uses CSS vars for all colors (light + dark mode).
 */

import { useMemo } from 'react';

export interface EfficiencyGaugeProps {
  /** Efficiency score 0–100 (100 = most efficient) */
  score: number;
  /** Label for the metric (e.g. "tok/ln") */
  unit: string;
  /** Display value (formatted) */
  displayValue: string;
  /** Accessible label */
  ariaLabel?: string;
  /** Bar height in px (default: 6) */
  barHeight?: number;
  className?: string;
}

function getBarColor(score: number): string {
  if (score >= 70) return 'var(--color-success)';
  if (score >= 40) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function getBarBg(score: number): string {
  if (score >= 70) return 'rgba(var(--color-success-rgb, 34,197,94), 0.15)';
  if (score >= 40) return 'rgba(var(--color-warning-rgb, 245,158,11), 0.15)';
  return 'rgba(var(--color-danger-rgb, 239,68,68), 0.15)';
}

export function EfficiencyGauge({
  score,
  unit,
  displayValue,
  ariaLabel,
  barHeight = 6,
  className = '',
}: EfficiencyGaugeProps) {
  const clampedScore = Math.max(0, Math.min(100, score));

  const barColor = useMemo(() => getBarColor(clampedScore), [clampedScore]);
  const barBg = useMemo(() => getBarBg(clampedScore), [clampedScore]);

  const label = ariaLabel || `Efficiency: ${displayValue} ${unit}`;

  return (
    <div className={`flex items-center gap-3 ${className}`} role="meter" aria-label={label} aria-valuenow={clampedScore} aria-valuemin={0} aria-valuemax={100}>
      {/* Value display */}
      <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--color-text-primary)]">
        {displayValue}
      </span>

      {/* Bar */}
      <div
        className="relative flex-1 overflow-hidden rounded-full"
        style={{ height: barHeight, backgroundColor: barBg }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${clampedScore}%`,
            backgroundColor: barColor,
          }}
        />
      </div>

      {/* Unit label */}
      <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">
        {unit}
      </span>
    </div>
  );
}
