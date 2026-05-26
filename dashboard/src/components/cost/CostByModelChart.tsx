/**
 * CostByModelChart.tsx — Horizontal bar chart showing cost per model.
 * Migrated from recharts to chart.js for bundle savings.
 * @ticket #4310
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
import { MODEL_COLORS, CHART_RGB } from '../../utils/chartTheme';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

export interface CostByModelDataPoint {
  model: string;
  cost: number;
}

export interface CostByModelChartProps {
  data?: CostByModelDataPoint[];
  loading?: boolean;
  className?: string;
}

const MOCK_DATA: CostByModelDataPoint[] = [
  { model: 'claude-opus-4.7', cost: 47.82 },
  { model: 'claude-sonnet-4.6', cost: 28.15 },
  { model: 'claude-haiku-4.5', cost: 3.40 },
  { model: 'gpt-5.4', cost: 12.67 },
  { model: 'gpt-4.1', cost: 5.91 },
];

function getColorForModel(model: string): string {
  const cssVar = MODEL_COLORS[model] ?? MODEL_COLORS.other;
  // Map CSS var to rgba
  const rgbMap: Record<string, string> = {
    'var(--color-accent-cyan)': CHART_RGB.cyan,
    'var(--color-accent-purple)': CHART_RGB.purple,
    'var(--color-success)': CHART_RGB.success,
    'var(--color-warning)': CHART_RGB.warning,
    'var(--color-info)': CHART_RGB.info,
    'var(--color-text-muted)': CHART_RGB.cyan,
  };
  const rgb = rgbMap[cssVar] ?? CHART_RGB.cyan;
  return `rgba(${rgb}, 0.7)`;
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

  const chartJsData = {
    labels: chartData.map((d) => d.model),
    datasets: [
      {
        data: chartData.map((d) => d.cost),
        backgroundColor: chartData.map((d) => getColorForModel(d.model)),
        borderWidth: 0,
        borderRadius: 4,
        barPercentage: 0.7,
      },
    ],
  };

  const options: ChartOptions<'bar'> = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15, 15, 20, 0.95)',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        bodyColor: 'rgba(255, 255, 255, 0.9)',
        bodyFont: { weight: 'bold' as const },
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          label: (item) => formatCurrency(Number(item.raw)),
        },
      },
    },
    scales: {
      x: {
        grid: { drawOnChartArea: true, color: 'rgba(255, 255, 255, 0.06)' },
        ticks: {
          color: 'rgba(255, 255, 255, 0.4)',
          font: { size: 11 },
          callback: (value) => `$${Number(value).toFixed(0)}`,
        },
        border: { color: 'rgba(255, 255, 255, 0.06)' },
      },
      y: {
        grid: { display: false },
        ticks: { color: 'rgba(255, 255, 255, 0.4)', font: { size: 11 } },
        border: { color: 'rgba(255, 255, 255, 0.06)' },
      },
    },
  };

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

      <div style={{ height: 256 }}>
        <Bar data={chartJsData} options={options} />
      </div>
    </section>
  );
}
