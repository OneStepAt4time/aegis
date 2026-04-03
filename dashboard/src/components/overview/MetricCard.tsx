/**
 * components/overview/MetricCard.tsx — Dark card for a single metric.
 */

import type { ReactNode } from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  suffix?: string;
  detail?: ReactNode;
  valueClassName?: string;
}

export default function MetricCard({ label, value, icon, suffix, detail, valueClassName }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-void-lighter bg-[#111118] p-4">
      <div className="mb-2 flex items-center gap-2 text-sm text-[#888]">
        {icon}
        {label}
      </div>
      <div className={`font-mono text-2xl ${valueClassName ?? 'text-[#00e5ff]'}`}>
        {value}
        {suffix && <span className="ml-1 text-base text-[#666]">{suffix}</span>}
      </div>
      {detail ? <div className="mt-3 text-xs text-[#888]">{detail}</div> : null}
    </div>
  );
}
