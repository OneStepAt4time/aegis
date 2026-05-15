/**
 * TokenBreakdownChart.tsx — Stacked bar chart for token usage breakdown.
 *
 * Shows input, output, cache-read, and cache-write tokens per day.
 * Part of issue #3273: Cost Analytics Panels.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { formatCompact } from '../../utils/formatNumber';
import { formatDateShort } from '../../utils/formatDate';
import { ChartFrame } from '../shared/ChartFrame';
import {
  TOKEN_COLORS as THEME_TOKEN_COLORS, TOKEN_LABELS as THEME_TOKEN_LABELS,
  CHART_GRID, CHART_TICK, CHART_AXIS,
  CHART_BAR_RADIUS, TOOLTIP_STYLE,
} from '../../utils/chartTheme';

export interface TokenBreakdownDataPoint {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface TokenBreakdownChartProps {
  data?: TokenBreakdownDataPoint[];
  loading?: boolean;
  className?: string;
}

const TOKEN_COLORS = THEME_TOKEN_COLORS;

const TOKEN_LABELS = THEME_TOKEN_LABELS;

function generateMockData(days: number): TokenBreakdownDataPoint[] {
  const today = new Date();
  const data: TokenBreakdownDataPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    data.push({
      date: dateStr,
      inputTokens: Math.floor(8000 + Math.random() * 12000),
      outputTokens: Math.floor(3000 + Math.random() * 8000),
      cacheReadTokens: Math.floor(2000 + Math.random() * 6000),
      cacheWriteTokens: Math.floor(500 + Math.random() * 3000),
    });
  }
  return data;
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className={TOOLTIP_STYLE.container}>
      <p className={TOOLTIP_STYLE.label}>
        {label ? formatDateShort(label) : ''}
      </p>
      {payload.map((entry, index) => (
        <div key={index} className={TOOLTIP_STYLE.row}>
          <span className={TOOLTIP_STYLE.rowLabel}>
            {TOKEN_LABELS[entry.name] ?? entry.name}:
          </span>
          <span className={TOOLTIP_STYLE.rowValue}>
            {formatCompact(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function CustomLegend({ payload }: { payload?: Array<{ value: string; color: string }> }) {
  if (!payload) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-4">
      {payload.map((entry) => (
        <div key={entry.value} className="flex items-center gap-1.5">
          <div
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-xs text-[var(--color-text-muted)]">
            {TOKEN_LABELS[entry.value] ?? entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TokenBreakdownChart({ data, loading = false, className = '' }: TokenBreakdownChartProps) {
  const chartData = data ?? generateMockData(14);

  if (loading) {
    return (
      <section
        className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
        aria-label="Token breakdown chart loading"
      >
        <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
          Token Breakdown
        </h3>
        <div className="flex h-72 items-center justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent-purple)] border-t-transparent" />
        </div>
      </section>
    );
  }

  if (chartData.length === 0) {
    return (
      <section
        className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
        aria-label="Token breakdown chart"
      >
        <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
          Token Breakdown
        </h3>
        <p className="py-12 text-center text-sm text-[var(--color-text-muted)]">
          No token data available yet.
        </p>
      </section>
    );
  }

  return (
    <section
      className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
      aria-label="Token breakdown chart"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--color-text-primary)]">
          Token Breakdown
        </h3>
        <span className="text-xs text-[var(--color-text-muted)]">
          Stacked by category
        </span>
      </div>
      <ChartFrame className="h-72 min-w-0" label="Token breakdown chart loading">
        {({ width, height }) => (
          <BarChart width={width} height={height} data={chartData}>
            <CartesianGrid {...CHART_GRID} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateShort}
              tick={CHART_TICK}
              {...CHART_AXIS}
            />
            <YAxis
              tickFormatter={(v: number) => formatCompact(v)}
              tick={CHART_TICK}
              {...CHART_AXIS}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend content={<CustomLegend />} />
            <Bar dataKey="inputTokens" stackId="tokens" fill={TOKEN_COLORS.inputTokens} radius={[0, 0, 0, 0]} />
            <Bar dataKey="outputTokens" stackId="tokens" fill={TOKEN_COLORS.outputTokens} />
            <Bar dataKey="cacheReadTokens" stackId="tokens" fill={TOKEN_COLORS.cacheReadTokens} />
            <Bar dataKey="cacheWriteTokens" stackId="tokens" fill={TOKEN_COLORS.cacheWriteTokens} radius={CHART_BAR_RADIUS} />
          </BarChart>
        )}
      </ChartFrame>
    </section>
  );
}
