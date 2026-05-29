/**
 * CostByModelChart.tsx — Horizontal bar chart showing cost per model.
 *
 * Displays total USD grouped by model with color coding.
 * Part of issue #3273: Cost Analytics Panels. // token-ok
 * @ticket #4310 — recharts → chart.js migration
 */

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { formatCurrency } from '../../utils/formatNumber';
import { useT } from '../../i18n/context';
import {
  MODEL_COLORS as THEME_MODEL_COLORS,
  CHART_RGB,
} from '../../utils/chartTheme';

export interface CostByModelDataPoint {
  model: string;
  cost: number;
}

export interface CostByModelChartProps {
  data?: CostByModelDataPoint[];
  loading?: boolean;
  className?: string;
}

const MODEL_COLORS = THEME_MODEL_COLORS;

const MOCK_DATA: CostByModelDataPoint[] = [
  { model: 'claude-opus-4.7', cost: 47.82 },
  { model: 'claude-sonnet-4.6', cost: 28.15 },
  { model: 'claude-haiku-4.5', cost: 3.40 },
  { model: 'gpt-5.4', cost: 12.67 },
  { model: 'gpt-4.1', cost: 5.91 },
];

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

export function CostByModelChart({ data, loading = false, className = '' }: CostByModelChartProps) {
  const t = useT();
  const chartData = data ?? MOCK_DATA;

  if (loading) {
    return (
      <section
        className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
        aria-label={t('aria.costByModelChartLoading')}
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
        aria-label={t('aria.costByModelChart')}
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

  const colorMap: Record<string, string> = {
    'claude-opus-4.7': `rgba(${CHART_RGB.purple}, 0.7)`,
    'claude-sonnet-4.6': `rgba(${CHART_RGB.cyan}, 0.7)`,
    'claude-haiku-4.5': `rgba(${CHART_RGB.success}, 0.7)`,
    'gpt-5.4': `rgba(${CHART_RGB.warning}, 0.7)`,
    'gpt-4.1': `rgba(${CHART_RGB.info}, 0.7)`,
    other: `rgba(${CHART_RGB.cyan}, 0.3)`,
  };

  const barColors = chartData.map((d) => colorMap[d.model] ?? colorMap.other);

  const chart = {
    labels: chartData.map((d) => d.model),
    datasets: [
      {
        label: 'Cost',
        data: chartData.map((d) => d.cost),
        backgroundColor: barColors,
        hoverBackgroundColor: barColors.map((c) => c.replace('0.7)', '0.9)')),
        borderRadius: 4,
        borderSkipped: false as const,
      },
    ],
  };

  const options: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15, 15, 25, 0.95)',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 12,
        titleFont: { family: 'monospace', size: 11 },
        titleColor: '#9ca3af',
        bodyFont: { family: 'monospace', size: 13, weight: 'bold' as const },
        bodyColor: '#f3f4f6',
        displayColors: false,
        callbacks: {
          label: (ctx) => formatCurrency(ctx.parsed.x ?? 0),
        },
      },
    },
    scales: {
      x: {
        grid: {
          color: 'rgba(255, 255, 255, 0.06)',
          drawTicks: false,
        },
        ticks: {
          color: '#9ca3af',
          font: { size: 11 },
          callback: (val) => `$${(val as number ?? 0).toFixed(0)}`,
        },
        border: { color: 'rgba(255, 255, 255, 0.06)' },
      },
      y: {
        grid: { display: false },
        ticks: {
          color: '#9ca3af',
          font: { size: 11 },
        },
        border: { color: 'rgba(255, 255, 255, 0.06)' },
      },
    },
  };

  return (
    <section
      className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
      aria-label={t('aria.costByModelChart')}
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

      <div className="h-64 min-w-0">
        <Bar data={chart} options={options} />
      </div>
    </section>
  );
}
