/**
 * components/shared/SparklineCard.tsx — Metric card with inline 7-day sparkline.
 * Uses Recharts for visualization. Hover shows exact value for that day.
 */

import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';
import { formatNumber } from '../../utils/formatNumber';

interface SparklineCardProps {
  label: string;
  value: string | number;
  data: Array<{ day: string; value: number }>;
  color?: string;
  className?: string;
}

function SparklineTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value: number; payload: { day: string } }> }) {
  if (!active || !payload?.[0]) return null;
  
  const { value, payload: dataPoint } = payload[0];
  
  return (
    <div className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-primary)] shadow-lg">
      <p className="font-medium">{dataPoint.day}</p>
      <p className="text-[var(--color-text-muted)]">{formatNumber(value, { maximumFractionDigits: 2 })}</p>
    </div>
  );
}

export function SparklineCard({ label, value, data, color = 'var(--color-accent-cyan)', className = '' }: SparklineCardProps) {
  return (
    <div className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4 ${className}`}>
      <div className="mb-2 text-xs text-[var(--color-text-muted)]">{label}</div>
      <div className="mb-3 text-2xl font-bold font-mono text-[var(--color-text-primary)]">{value}</div>
      
      {data.length > 0 && (
        <div className="h-12 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
            <LineChart data={data}>
              <Tooltip content={<SparklineTooltip />} />
              <Line 
                type="monotone" 
                dataKey="value" 
                stroke={color}
                strokeWidth={2}
                dot={false}
                animationDuration={300}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
