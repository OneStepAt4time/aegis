/**
 * BurnRateChart.tsx — Session burn rate line chart.
 *
 * Shows cost velocity over time (USD on Y, date on X).
 * Part of issue #3273: Cost Analytics Panels.
 */

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { formatCurrency } from '../../utils/formatNumber';
import { formatDateShort } from '../../utils/formatDate';
import { ChartFrame } from '../shared/ChartFrame';
import {
  CHART_COLORS,
  CHART_GRID, CHART_TICK, CHART_AXIS,
  CHART_ANIMATION, CHART_DOT, CHART_ACTIVE_DOT, CHART_STROKE,
  GradientDefs, TOOLTIP_STYLE,
} from '../../utils/chartTheme';

export interface BurnRateDataPoint {
  date: string;
  cost: number;
}

export interface BurnRateChartProps {
  data?: BurnRateDataPoint[];
  loading?: boolean;
  className?: string;
}

function generateMockData(days: number): BurnRateDataPoint[] {
  const today = new Date();
  const data: BurnRateDataPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // Upward trend with noise
    const base = 2 + (days - i) * 0.15;
    const noise = (Math.sin(i * 1.7) * 0.8 + Math.cos(i * 0.3) * 0.5);
    data.push({ date: dateStr, cost: Math.max(0.1, base + noise) });
  }
  return data;
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className={TOOLTIP_STYLE.container}>
      <p className={TOOLTIP_STYLE.label}>
        {label ? formatDateShort(label) : ''}
      </p>
      <p className="text-sm font-mono font-medium text-[var(--color-accent-cyan)]">
        {formatCurrency(payload[0].value)}
      </p>
    </div>
  );
}

export function BurnRateChart({ data, loading = false, className = '' }: BurnRateChartProps) {
  const chartData = data ?? generateMockData(30);

  if (loading) {
    return (
      <section
        className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
        aria-label="Burn rate chart loading"
      >
        <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
          Session Burn Rate
        </h3>
        <div className="flex h-64 items-center justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent-cyan)] border-t-transparent" />
        </div>
      </section>
    );
  }

  if (chartData.length === 0) {
    return (
      <section
        className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
        aria-label="Burn rate chart"
      >
        <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
          Session Burn Rate
        </h3>
        <p className="py-12 text-center text-sm text-[var(--color-text-muted)]">
          No cost data available yet. Start a session to begin tracking.
        </p>
      </section>
    );
  }

  return (
    <section
      className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
      aria-label="Session burn rate chart"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--color-text-primary)]">
          Session Burn Rate
        </h3>
        <span className="text-xs text-[var(--color-text-muted)]">
          Cost velocity over time
        </span>
      </div>
      <ChartFrame className="h-72 min-w-0" label="Burn rate chart loading">
        {({ width, height }) => (
          <AreaChart width={width} height={height} data={chartData}>
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
            <Tooltip content={<CustomTooltip />} />
            <GradientDefs gradients={['cyan']} />
            <Area
              type="monotone"
              dataKey="cost"
              stroke={CHART_COLORS.cyan}
              strokeWidth={CHART_STROKE.width}
              fill="url(#gradientCyan)"
              dot={{ r: CHART_DOT.r, fill: CHART_COLORS.cyan }}
              activeDot={{ r: CHART_ACTIVE_DOT.r, fill: CHART_COLORS.cyan }}
              animationDuration={CHART_ANIMATION.duration}
            />
          </AreaChart>
        )}
      </ChartFrame>
    </section>
  );
}
