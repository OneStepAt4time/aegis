/**
 * CostByModelChart.tsx — Horizontal bar chart showing cost per model.
 *
 * Displays total USD grouped by model with color coding.
 * Part of issue #3273: Cost Analytics Panels.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import { formatCurrency } from '../../utils/formatNumber';
import { ChartFrame } from '../shared/ChartFrame';

export interface CostByModelDataPoint {
  model: string;
  cost: number;
}

export interface CostByModelChartProps {
  data?: CostByModelDataPoint[];
  loading?: boolean;
  className?: string;
}

const MODEL_COLORS: Record<string, string> = {
  'claude-opus-4.7': 'var(--color-accent-purple)',
  'claude-sonnet-4.6': 'var(--color-accent-cyan)',
  'claude-haiku-4.5': 'var(--color-success)',
  'gpt-5.4': 'var(--color-warning)',
  'gpt-4.1': 'var(--color-info)',
  other: 'var(--color-text-muted)',
};

const MOCK_DATA: CostByModelDataPoint[] = [
  { model: 'claude-opus-4.7', cost: 47.82 },
  { model: 'claude-sonnet-4.6', cost: 28.15 },
  { model: 'claude-haiku-4.5', cost: 3.40 },
  { model: 'gpt-5.4', cost: 12.67 },
  { model: 'gpt-4.1', cost: 5.91 },
];

function CustomTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: CostByModelDataPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 shadow-xl">
      <p className="mb-1 text-xs font-mono text-[var(--color-text-muted)]">
        {point.model}
      </p>
      <p className="text-sm font-mono font-medium text-[var(--color-text-primary)]">
        {formatCurrency(point.cost)}
      </p>
    </div>
  );
}

export function CostByModelChart({ data, loading = false, className = '' }: CostByModelChartProps) {
  const chartData = data ?? MOCK_DATA;

  if (loading) {
    return (
      <section
        className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
        aria-label="Cost by model chart loading"
      >
        <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
          Cost by Model
        </h3>
        <div className="flex h-64 items-center justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent-purple)] border-t-transparent" />
        </div>
      </section>
    );
  }

  if (chartData.length === 0) {
    return (
      <section
        className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
        aria-label="Cost by model chart"
      >
        <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
          Cost by Model
        </h3>
        <p className="py-12 text-center text-sm text-[var(--color-text-muted)]">
          No model cost data available yet.
        </p>
      </section>
    );
  }

  return (
    <section
      className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
      aria-label="Cost by model chart"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--color-text-primary)]">
          Cost by Model
        </h3>
        <span className="text-xs text-[var(--color-text-muted)]">
          Total spend per model
        </span>
      </div>

      {/* Legend */}
      <div className="mb-3 flex flex-wrap gap-3">
        {chartData.map((entry) => (
          <div key={entry.model} className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: MODEL_COLORS[entry.model] ?? MODEL_COLORS.other }}
            />
            <span className="text-xs text-[var(--color-text-muted)]">{entry.model}</span>
          </div>
        ))}
      </div>

      <ChartFrame className="h-64 min-w-0" label="Cost by model chart loading">
        {({ width, height }) => (
          <BarChart width={width} height={height} data={chartData} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-void-lighter)" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
              stroke="var(--color-void-lighter)"
            />
            <YAxis
              type="category"
              dataKey="model"
              tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
              stroke="var(--color-void-lighter)"
              width={120}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="cost" radius={[0, 4, 4, 0]} animationDuration={500}>
              {chartData.map((entry) => (
                <Cell
                  key={entry.model}
                  fill={MODEL_COLORS[entry.model] ?? MODEL_COLORS.other}
                />
              ))}
            </Bar>
          </BarChart>
        )}
      </ChartFrame>
    </section>
  );
}
