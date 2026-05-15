/**
 * OverviewCostChart — lazy-loaded cost chart for OverviewPage.
 * Separated so recharts loads on demand.
 * @ticket #2934 // token-ok
 * @ticket #3399 — chart polish with design tokens
 */

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { formatDateShort } from '../../utils/formatDate';
import {
  CHART_GRID, CHART_TICK, CHART_AXIS, CHART_COLORS,
  CHART_ANIMATION, CHART_BAR_RADIUS, TOOLTIP_STYLE,
} from '../../utils/chartTheme';

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
    <div className={TOOLTIP_STYLE.container}>
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
        <CartesianGrid {...CHART_GRID} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDateShort}
          tick={CHART_TICK}
          {...CHART_AXIS}
        />
        <YAxis
          tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          tick={CHART_TICK}
          {...CHART_AXIS}
        />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="cost" name="Daily Cost" fill={CHART_COLORS.cyan} radius={CHART_BAR_RADIUS} animationDuration={CHART_ANIMATION.duration} />
      </BarChart>
    </ResponsiveContainer>
  );
}
