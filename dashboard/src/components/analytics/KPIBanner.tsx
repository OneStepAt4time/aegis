/**
 * components/analytics/KPIBanner.tsx — CCMeter-inspired KPI banner.
 *
 * Condensed single-row display of 5-8 key metrics in monospace,
 * color-coded by data type per CCMeter convention:
 *   Blue   → Input tokens
 *   Purple → Output tokens
 *   Orange → Cost
 *   Green  → Efficiency / Acceptance
 *   Cyan   → Time / Duration
 *
 * Uses CSS vars for all colors (light + dark mode).
 */

import { useT } from '../../i18n/context';

export interface KPIItem {
  /** Unique key for React list rendering */
  id: string;
  /** Display label (i18n key or plain string) */
  label: string;
  /** Formatted value string (monospace) */
  value: string;
  /** Color category — maps to CSS var */
  color: 'input' | 'output' | 'cost' | 'efficiency' | 'time' | 'neutral';
  /** Optional sub-text (e.g. "+12% from yesterday") */
  subtitle?: string;
  /** Optional trend direction */
  trend?: 'up' | 'down' | 'flat';
}

interface KPIBannerProps {
  items: KPIItem[];
  className?: string;
}

const COLOR_MAP: Record<KPIItem['color'], string> = {
  input: 'text-[var(--color-accent-cyan)]',
  output: 'text-[var(--color-accent-purple)]',
  cost: 'text-[var(--color-warning)]',
  efficiency: 'text-[var(--color-success)]',
  time: 'text-[var(--color-accent)]',
  neutral: 'text-[var(--color-text-primary)]',
};

const TREND_ICON: Record<string, string> = {
  up: '▲',
  down: '▼',
  flat: '●',
};

const TREND_COLOR: Record<string, string> = {
  up: 'text-[var(--color-success)]',
  down: 'text-[var(--color-danger)]',
  flat: 'text-[var(--color-text-muted)]',
};

export function KPIBanner({ items, className = '' }: KPIBannerProps) {
  const t = useT();

  if (items.length === 0) {
    return (
      <div
        className="flex h-[52px] items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-muted)]"
        role="status"
        aria-label={t("aria.noKpiData")}
      >
        {t('analytics.noData') || 'No data available'}
      </div>
    );
  }

  return (
    <div
      className={`grid divide-x divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] ${className}`}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      role="list"
      aria-label={t("aria.keyPerformanceIndicators")}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="flex flex-col items-center justify-center px-3 py-3"
          role="listitem"
          aria-label={`${item.label}: ${item.value}`}
        >
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
            {item.label}
          </span>
          <span className={`font-mono text-lg font-semibold tabular-nums ${COLOR_MAP[item.color]}`}>
            {item.value}
          </span>
          {item.subtitle && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
              {item.trend && (
                <span className={TREND_COLOR[item.trend]} aria-hidden="true">
                  {TREND_ICON[item.trend]}
                </span>
              )}
              {item.subtitle}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
