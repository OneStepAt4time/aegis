/**
 * OverviewCostChart — lazy-loaded cost chart for OverviewPage.
 * Separated so recharts loads on demand.
 * @ticket #2934 // token-ok
 */

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { formatDateShort } from '../../utils/formatDate';

interface CostTrend {
  date: string;
  cost: number;
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number; name: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-lg">
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p className="text-sm font-semibold text-[var(--color-text-primary)]">
        ${payload[0].value.toFixed(2)}
      </p>
    </div>
  );
}

interface OverviewCostChartProps {
  data: CostTrend[];
}

export function OverviewCostChart({ data }: OverviewCostChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220} minWidth={1} minHeight={1}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-void-lighter)" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDateShort}
          tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
          stroke="var(--color-void-lighter)"
        />
        <YAxis
          tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
          stroke="var(--color-void-lighter)"
        />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="cost" name="Daily Cost" fill="var(--color-accent-cyan)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
