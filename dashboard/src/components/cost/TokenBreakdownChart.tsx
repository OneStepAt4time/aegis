/**
 * TokenBreakdownChart.tsx — Stacked bar chart for token usage breakdown.
 * Migrated from recharts to chart.js for bundle savings.
 * @ticket #4310
 */

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { formatCompact } from '../../utils/formatNumber';
import { formatDateShort } from '../../utils/formatDate';
import { TOKEN_LABELS, CHART_RGB } from '../../utils/chartTheme';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

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

// Map CSS var colors to rgba for chart.js canvas rendering
const TOKEN_RGBA = {
  inputTokens: `rgba(${CHART_RGB.cyan}, 0.7)`,
  outputTokens: `rgba(${CHART_RGB.purple}, 0.7)`,
  cacheReadTokens: `rgba(${CHART_RGB.success}, 0.7)`,
  cacheWriteTokens: `rgba(${CHART_RGB.warning}, 0.7)`,
};

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

  const keys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const;

  const chartJsData = {
    labels: chartData.map((d) => d.date),
    datasets: keys.map((key) => ({
      label: TOKEN_LABELS[key] ?? key,
      data: chartData.map((d) => d[key]),
      backgroundColor: TOKEN_RGBA[key],
      borderWidth: 0,
      borderRadius: key === 'cacheWriteTokens' ? { topLeft: 4, topRight: 4 } : 0,
    })),
  };

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    plugins: {
      legend: {
        display: true,
        position: 'bottom' as const,
        labels: {
          color: 'rgba(255, 255, 255, 0.4)',
          font: { size: 12 },
          usePointStyle: true,
          pointStyle: 'rectRounded',
          padding: 16,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(15, 15, 20, 0.95)',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        titleColor: 'rgba(255, 255, 255, 0.6)',
        bodyColor: 'rgba(255, 255, 255, 0.9)',
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          title: (items) => formatDateShort(items[0].label),
          label: (item) => `${item.dataset.label}: ${formatCompact(Number(item.raw))}`,
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { drawOnChartArea: true, color: 'rgba(255, 255, 255, 0.06)' },
        ticks: {
          color: 'rgba(255, 255, 255, 0.4)',
          font: { size: 11 },
          callback: function (value) { return formatDateShort(this.getLabelForValue(value as number)); },
          maxRotation: 0,
        },
        border: { color: 'rgba(255, 255, 255, 0.06)' },
      },
      y: {
        stacked: true,
        grid: { drawOnChartArea: true, color: 'rgba(255, 255, 255, 0.06)' },
        ticks: {
          color: 'rgba(255, 255, 255, 0.4)',
          font: { size: 11 },
          callback: (value) => formatCompact(Number(value)),
        },
        border: { color: 'rgba(255, 255, 255, 0.06)' },
      },
    },
  };

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
      <div style={{ height: 288 }}>
        <Bar data={chartJsData} options={options} />
      </div>
    </section>
  );
}
