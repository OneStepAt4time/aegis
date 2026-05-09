/**
 * components/analytics/ModelDistributionBar.tsx — CCMeter-inspired model distribution.
 *
 * Stacked horizontal bar showing the relative usage of different AI models
 * within a session or project. Color-coded per CCMeter convention:
 *   Opus   → Purple
 *   Sonnet → Blue (accent)
 *   Haiku  → Green
 *   Other  → Muted
 *
 * Uses CSS vars for all colors (light + dark mode).
 */

export interface ModelSegment {
  /** Model identifier (e.g. "claude-opus-4.7") */
  model: string;
  /** Fraction of total usage (0–1). All segments should sum to ~1. */
  fraction: number;
  /** Optional display label override */
  label?: string;
}

export interface ModelDistributionBarProps {
  /** Segments to render (ordered left-to-right) */
  segments: ModelSegment[];
  /** Bar height in px (default: 8) */
  barHeight?: number;
  /** Show legend below the bar (default: true) */
  showLegend?: boolean;
  /** Accessible label */
  ariaLabel?: string;
  className?: string;
}

/** Map known model patterns to CSS var colors */
const MODEL_STYLES: Record<string, { color: string; label: string }> = {
  opus: { color: 'var(--color-accent-purple)', label: 'Opus' },
  sonnet: { color: 'var(--color-accent)', label: 'Sonnet' },
  haiku: { color: 'var(--color-success)', label: 'Haiku' },
};

function getModelStyle(model: string): { color: string; label: string } {
  const lower = model.toLowerCase();
  for (const [key, style] of Object.entries(MODEL_STYLES)) {
    if (lower.includes(key)) return style;
  }
  return { color: 'var(--color-text-muted)', label: model };
}

export function ModelDistributionBar({
  segments,
  barHeight = 8,
  showLegend = true,
  ariaLabel,
  className = '',
}: ModelDistributionBarProps) {
  if (segments.length === 0) {
    return (
      <div className={`text-[10px] text-[var(--color-text-muted)] ${className}`}>
        No model data
      </div>
    );
  }

  // Normalize fractions to sum to 1
  const total = segments.reduce((sum, s) => sum + s.fraction, 0);
  const normalized = total > 0
    ? segments.map((s) => ({ ...s, fraction: s.fraction / total }))
    : segments;

  const label = ariaLabel || 'Model distribution';

  return (
    <div className={className}>
      {/* Stacked bar */}
      <div
        className="flex overflow-hidden rounded-full"
        style={{ height: barHeight }}
        role="img"
        aria-label={label}
      >
        {normalized.map((segment, i) => {
          const style = getModelStyle(segment.model);
          return (
            <div
              key={`${segment.model}-${i}`}
              className="transition-all "
              style={{
                width: `${segment.fraction * 100}%`,
                backgroundColor: style.color,
                minWidth: segment.fraction > 0 ? '2px' : '0',
              }}
              title={`${style.label}: ${(segment.fraction * 100).toFixed(1)}%`}
            />
          );
        })}
      </div>

      {/* Legend */}
      {showLegend && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {normalized
            .filter((s) => s.fraction > 0.01)
            .map((segment, i) => {
              const style = getModelStyle(segment.model);
              return (
                <span
                  key={`legend-${segment.model}-${i}`}
                  className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]"
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: style.color }}
                    aria-hidden="true"
                  />
                  {segment.label || style.label}
                  <span className="font-mono tabular-nums">
                    {(segment.fraction * 100).toFixed(0)}%
                  </span>
                </span>
              );
            })}
        </div>
      )}
    </div>
  );
}
