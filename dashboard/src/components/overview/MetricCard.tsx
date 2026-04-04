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
  blue: 'text-[#3b82f6]',
  green: 'text-[#22c55e]',
  amber: 'text-[#f59e0b]',
  red: 'text-[#ef4444]',
  purple: 'text-[#a78bfa]',
};

const barColorMap: Record<string, string> = {
  blue: 'bg-[#3b82f6]',
  green: 'bg-[#22c55e]',
  amber: 'bg-[#f59e0b]',
  red: 'bg-[#ef4444]',
  purple: 'bg-[#a78bfa]',
};

export default function MetricCard({ label, value, icon, suffix, subLabel, color = 'blue', bar }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-void-lighter bg-[#111118] p-4">
      <div className="mb-2 flex items-center gap-2 text-sm text-[#888]">
        {icon}
        {label}
      </div>
      <div className={`font-mono text-2xl ${colorMap[color]}`}>
        {value}
        {suffix && <span className="ml-1 text-base text-[#666]">{suffix}</span>}
      </div>
      {bar !== undefined && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#1e1e2a]">
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
