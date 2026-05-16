/**
 * components/shared/EffortIndicator.tsx — Compact effort level indicator.
 *
 * Shows a small colored dot + label for the session's effort level.
 * Renders nothing when effort is undefined/null (graceful degradation).
 *
 * Effort levels (from CC convention):
 *   high   → Orange (max thinking)
 *   medium → Yellow (default)
 *   low    → Green (fast mode)
 */

const EFFORT_STYLES: Record<string, { color: string; label: string }> = {
  high: { color: 'var(--color-warning)', label: 'High' },
  medium: { color: 'var(--color-accent-cyan)', label: 'Med' },
  low: { color: 'var(--color-success)', label: 'Low' },
};

function getEffortStyle(effort: string): { color: string; label: string } {
  const lower = effort.toLowerCase();
  if (EFFORT_STYLES[lower]) return EFFORT_STYLES[lower];

  // Handle numeric effort (0.0–1.0)
  const num = parseFloat(effort);
  if (!isNaN(num)) {
    if (num >= 0.7) return EFFORT_STYLES.high;
    if (num >= 0.3) return EFFORT_STYLES.medium;
    return EFFORT_STYLES.low;
  }

  return { color: 'var(--color-text-muted)', label: effort };
}

export interface EffortIndicatorProps {
  /** Effort level (e.g. "high", "medium", "low", "0.8"). When undefined, renders nothing. */
  effort?: string | null;
  className?: string;
}

export function EffortIndicator({ effort, className = '' }: EffortIndicatorProps) {
  if (!effort) return null;

  const { color, label } = getEffortStyle(effort);

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] leading-none text-[var(--color-text-muted)] ${className}`}
      title={`Effort: ${effort}`}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
