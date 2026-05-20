/**
 * components/shared/LastUpdatedIndicator.tsx — Displays "Last updated: Xs ago" text.
 * Shows an amber pulse when data is stale (>30s since last update).
 */

interface LastUpdatedIndicatorProps {
  relativeTime: string;
  isStale: boolean;
}

export function LastUpdatedIndicator({ relativeTime, isStale }: LastUpdatedIndicatorProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs tabular-nums transition-colors ${
        isStale
          ? 'text-amber-400'
          : 'text-[var(--color-text-muted)]'
      }`}
      role="status" aria-live="polite"
      aria-label={`Last updated ${relativeTime}`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          isStale
            ? 'bg-amber-400 animate-pulse'
            : 'bg-emerald-400'
        }`}
      />
      Updated {relativeTime}
    </span>
  );
}
