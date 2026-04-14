/**
 * components/overview/MetricCard.tsx — Dark card for a single metric.
 */

import type { ReactNode } from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  suffix?: string;
  /** Secondary detail line below the value */
  subLabel?: string;
  /** Color variant for the value text */
  color?: 'blue' | 'green' | 'amber' | 'red' | 'purple';
  /** Optional progress bar (0–100) */
  bar?: number;
}

const colorMap: Record<string, string> = {
  blue: 'text-[var(--color-accent)]',
  green: 'text-[var(--color-success)]',
  amber: 'text-[var(--color-warning)]',
  red: 'text-[var(--color-error)]',
  purple: 'text-[var(--color-info)]',
};

const barColorMap: Record<string, string> = {
  blue: 'bg-[var(--color-accent)]',
  green: 'bg-[var(--color-success)]',
  amber: 'bg-[var(--color-warning)]',
  red: 'bg-[var(--color-error)]',
  purple: 'bg-[var(--color-info)]',
};

export default function MetricCard({ label, value, icon, suffix, subLabel, color = 'blue', bar }: MetricCardProps) {
  return (
    <div
      role="article"
      aria-label={`${label}: ${value}${suffix ?? ''}`}
      className="rounded-lg border border-void-lighter bg-[var(--color-surface)] p-4"
    >
      <div className="mb-2 flex items-center gap-2 text-sm text-[#888]">
        {icon}
        {label}
      </div>
      <div className={`font-mono text-2xl ${colorMap[color]}`}>
        {value}
        {suffix && <span className="ml-1 text-base text-[#666]">{suffix}</span>}
      </div>
      {bar !== undefined && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-void-dark)]">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColorMap[color]}`}
            style={{ width: `${Math.min(100, Math.max(0, bar))}%` }}
          />
        </div>
      )}
      {subLabel && (
        <div className="mt-1.5 text-xs text-[#666]">{subLabel}</div>
      )}
    </div>
  );
}
