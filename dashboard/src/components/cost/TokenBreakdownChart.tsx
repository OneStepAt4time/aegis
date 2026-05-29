/**
 * TokenBreakdownChart.tsx — Stacked bar chart for token usage breakdown.
 *
 * Shows input, output, cache-read, and cache-write tokens per day.
 * Part of issue #3273: Cost Analytics Panels. // token-ok
 * @ticket #4310 — recharts → chart.js migration
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
import { CHART_RGB, TOKEN_LABELS } from '../../utils/chartTheme';
import { useT } from '../../i18n/context';

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

const TOKEN_COLORS_MAP = {
  inputTokens: `rgba(${CHART_RGB.cyan}, 0.7)`,
  outputTokens: `rgba(${CHART_RGB.purple}, 0.7)`,
  cacheReadTokens: `rgba(${CHART_RGB.success}, 0.7)`,
  cacheWriteTokens: `rgba(${CHART_RGB.warning}, 0.7)`,
} as const;

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
  const t = useT();
  const chartData = data ?? generateMockData(14);

  if (loading) {
    return (
      <section
        className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
        aria-label={t('aria.tokenBreakdownChartLoading')}
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
        aria-label={t('aria.tokenBreakdownChart')}
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

  const chart = {
    labels: chartData.map((d) => d.date),
    datasets: keys.map((key, idx) => ({
      label: TOKEN_LABELS[key] ?? key,
      data: chartData.map((d) => d[key]),
      backgroundColor: TOKEN_COLORS_MAP[key],
      borderRadius: idx === keys.length - 1 ? { topLeft: 4, topRight: 4 } : 0,
      borderSkipped: false as const,
    })),
  };

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        ticks: {
          color: '#9ca3af',
          font: { size: 11 },
          maxTicksLimit: 8,
          callback: function (val, i) {
            return i !== undefined && i % Math.ceil(chartData.length / 8) === 0
              ? formatDateShort(this.getLabelForValue(val as number))
              : '';
          },
        },
        border: { color: 'rgba(255, 255, 255, 0.06)' },
      },
      y: {
        stacked: true,
        grid: {
          color: 'rgba(255, 255, 255, 0.06)',
          drawTicks: false,
        },
        ticks: {
          color: '#9ca3af',
          font: { size: 11 },
          callback: (val) => formatCompact(val as number ?? 0),
        },
        border: { color: 'rgba(255, 255, 255, 0.06)' },
      },
    },
    plugins: {
      legend: {
        display: true,
        position: 'bottom' as const,
        labels: {
          color: '#9ca3af',
          font: { size: 12 },
          boxWidth: 10,
          boxHeight: 10,
          usePointStyle: true,
          pointStyle: 'rectRounded' as const,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(15, 15, 25, 0.95)',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 12,
        titleFont: { size: 11 },
        titleColor: '#9ca3af',
        bodyFont: { family: 'monospace', size: 12 },
        bodyColor: '#f3f4f6',
        callbacks: {
          title: (items) => formatDateShort(items[0]?.label ?? ''),
          label: (ctx) => `${ctx.dataset.label}: ${formatCompact(ctx.parsed.y ?? 0)}`,
        },
      },
    },
  };

  return (
    <section
      className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
      aria-label={t('aria.tokenBreakdownChart')}
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--color-text-primary)]">
          Token Breakdown
        </h3>
        <span className="text-xs text-[var(--color-text-muted)]">
          Stacked by category
        </span>
      </div>
      <div className="h-72 min-w-0">
        <Bar data={chart} options={options} />
      </div>
    </section>
  );
}
