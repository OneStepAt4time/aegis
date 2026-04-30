/**
 * components/analytics/RateLimitForecastCard.tsx — Bottleneck forecast (Issue #2283).
 *
 * Shows predicted session capacity and bottleneck type with severity
 * indicators: green (>10 or unlimited), amber (1-10), red (0).
 */

import type { RateLimitForecast } from '../../types';

export interface RateLimitForecastCardProps {
  forecast: RateLimitForecast;
}

type Severity = 'green' | 'amber' | 'red';

function severityForRemaining(remaining: number | null): Severity {
  if (remaining === null) return 'green';
  if (remaining === 0) return 'red';
  if (remaining <= 10) return 'amber';
  return 'green';
}

const SEVERITY_COLORS: Record<Severity, string> = {
  green: 'var(--color-success)',
  amber: 'var(--color-warning)',
  red: 'var(--color-danger)',
};

const BOTTLENECK_LABELS: Record<string, string> = {
  concurrent_sessions: 'Concurrent Sessions',
  tokens_per_window: 'Token Budget',
  spend_per_window: 'Spend Budget',
};

function formatRemaining(value: number | null): string {
  if (value === null) return 'Unlimited';
  return String(value);
}

export function RateLimitForecastCard({ forecast }: RateLimitForecastCardProps) {
  const { estimatedSessionsRemaining, bottleneck } = forecast;
  const severity = severityForRemaining(estimatedSessionsRemaining);
  const color = SEVERITY_COLORS[severity];
  const bottleneckLabel = bottleneck
    ? BOTTLENECK_LABELS[bottleneck] ?? bottleneck
    : 'No bottleneck detected';

  return (
    <section
      className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5"
      aria-label="Rate-limit forecast"
      role="region"
    >
      <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
        Capacity Forecast
      </h3>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
        {/* Sessions remaining */}
        <div className="flex items-center gap-3">
          <div
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: color }}
            aria-label={`${severity} indicator`}
          />
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Estimated Sessions Remaining</div>
            <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
              {formatRemaining(estimatedSessionsRemaining)}
            </div>
          </div>
        </div>

        {/* Bottleneck type */}
        <div className="flex items-center gap-3">
          <div
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: bottleneck ? SEVERITY_COLORS.amber : SEVERITY_COLORS.green }}
            aria-label={bottleneck ? 'Bottleneck detected' : 'No bottleneck'}
          />
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Bottleneck</div>
            <div className="text-sm font-medium text-[var(--color-text-primary)]">
              {bottleneckLabel}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
