/**
 * components/overview/MetricCard.tsx — Dark card for a single metric.
 */

import type { ReactNode } from 'react';
import { SparkLine } from './SparkLine';

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
  /** Sparkline trend data */
  sparkData?: number[];
  /** Custom root classes for advanced layout constraints (like col-span-2) */
  className?: string;
  /** Pass a custom data storytelling component (like a RingGauge) to override the main visual */
  customVisual?: ReactNode;
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

export default function MetricCard({ label, value, icon, suffix, subLabel, color = 'blue', bar, sparkData, className = '', customVisual }: MetricCardProps) {
  return (
    <div
      role="article"
      aria-label={`${label}: ${value}${suffix ?? ''}`}
      className={`card-glass card-glass-interactive animate-bento-reveal p-5 flex flex-col ${className}`}
    >
      <div className="mb-2 flex items-center gap-2 text-sm text-[var(--color-text-muted)] font-medium">
        {icon}
        {label}
      </div>

      {customVisual ? (
        <div className="flex-1 flex items-center justify-center">
          {customVisual}
        </div>
      ) : (
        <>
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
        </>
      )}

      {subLabel && !customVisual && (
        <div className="mt-1.5 text-xs text-[#666]">{subLabel}</div>
      )}
      {sparkData && sparkData.length >= 2 && (
        <div className="mt-2">
          <SparkLine data={sparkData} color={color === "blue" ? "var(--color-accent-cyan)" : color === "green" ? "var(--color-success)" : color === "amber" ? "var(--color-warning)" : color === "red" ? "var(--color-error)" : "var(--color-accent)"} />
        </div>
      )}
    </div>
  );
}
