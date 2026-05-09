/**
 * components/shared/EfficiencyGauge.tsx — Colored efficiency bar with tok/ln metric.
 *
 * Visual indicator: green (high efficiency) → yellow (moderate) → red (low).
 * Used by CostPage, SessionDetailPage, and project cards (#2808, #2832). // token-ok
 *
 * Supports:
 * - Color gradient based on efficiency threshold
 * - Animated fill bar
 * - Compact and expanded variants
 * - Dark/light mode via CSS variables
 */

interface EfficiencyGaugeProps {
  /** Current efficiency value (e.g. tokens per line) */
  value: number;
  /** Maximum value for 100% fill */
  max: number;
  /** Thresholds: [low, medium, high] — colors shift at these boundaries */
  thresholds?: [number, number];
  /** Display label (e.g. "156 tok/ln") */
  label?: string;
  /** Compact mode — no label, just the bar */
  compact?: boolean;
  /** Bar height in pixels */
  height?: number;
  /** Additional CSS classes */
  className?: string;
}

function getEfficiencyColor(value: number, max: number, thresholds: [number, number]): string {
  const ratio = max > 0 ? value / max : 0;
  const [low, high] = thresholds;

  if (ratio >= high) return 'var(--color-success, #22c55e)'; // token-ok
  if (ratio >= low) return 'var(--color-warning, #eab308)'; // token-ok
  return 'var(--color-error, #ef4444)'; // token-ok
}

function getEfficiencyGradient(ratio: number, thresholds: [number, number]): string {
  const [, high] = thresholds;

  if (ratio >= high) {
    return 'linear-gradient(90deg, rgba(34,197,94,0.6), rgba(34,197,94,1))'; // token-ok
  }
  if (ratio >= thresholds[0]) {
    return 'linear-gradient(90deg, rgba(234,179,8,0.6), rgba(234,179,8,1))'; // token-ok
  }
  return 'linear-gradient(90deg, rgba(239,68,68,0.6), rgba(239,68,68,1))'; // token-ok
}

export function EfficiencyGauge({
  value,
  max,
  thresholds = [0.3, 0.6],
  label,
  compact = false,
  height = 6,
  className = '',
}: EfficiencyGaugeProps) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  const color = getEfficiencyColor(value, max, thresholds);
  const gradient = getEfficiencyGradient(ratio, thresholds);
  const percentDisplay = Math.round(ratio * 100);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {!compact && label && (
        <span className="text-xs font-mono text-[var(--color-text-muted)] whitespace-nowrap">
          {label}
        </span>
      )}

      <div
        className="flex-1 rounded-full overflow-hidden bg-[var(--color-border-strong, #334155)]" // token-ok
        style={{ height: `${height}px`, minHeight: `${height}px` }}
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? `Efficiency: ${percentDisplay}%`}
      >
        <div
          className="h-full rounded-full transition-all ease-out"
          style={{
            width: `${percentDisplay}%`,
            background: gradient,
            minWidth: ratio > 0 ? `${height}px` : '0',
          }}
        />
      </div>

      {!compact && (
        <span
          className="text-xs font-mono font-medium min-w-[2.5rem] text-right"
          style={{ color }}
        >
          {percentDisplay}%
        </span>
      )}
    </div>
  );
}
