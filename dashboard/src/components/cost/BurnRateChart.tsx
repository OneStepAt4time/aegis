/**
 * BurnRateChart.tsx — Session burn rate line chart.
 *
 * Shows cost velocity over time (USD on Y, date on X).
 * Part of issue #3273: Cost Analytics Panels. // token-ok
 * @ticket #4310 — recharts → chart.js migration
 */

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { formatCurrency } from '../../utils/formatNumber';
import { formatDateShort } from '../../utils/formatDate';
import { CHART_RGB } from '../../utils/chartTheme';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

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
    const base = 2 + (days - i) * 0.15;
    const noise = (Math.sin(i * 1.7) * 0.8 + Math.cos(i * 0.3) * 0.5);
    data.push({ date: dateStr, cost: Math.max(0.1, base + noise) });
  }
  return data;
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

  const chart = {
    labels: chartData.map((d) => d.date),
    datasets: [
      {
        label: 'Cost',
        data: chartData.map((d) => d.cost),
        borderColor: `rgba(${CHART_RGB.cyan}, 1)`,
        backgroundColor: (ctx: { chart: { ctx: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } } }) => {
          const { ctx: canvasCtx, chartArea } = ctx.chart;
          if (!chartArea) return `rgba(${CHART_RGB.cyan}, 0)`;
          const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, `rgba(${CHART_RGB.cyan}, 0.3)`);
          gradient.addColorStop(1, `rgba(${CHART_RGB.cyan}, 0)`);
          return gradient;
        },
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: `rgba(${CHART_RGB.cyan}, 1)`,
        borderWidth: 2,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
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
        titleFont: { size: 11 },
        titleColor: '#9ca3af',
        bodyFont: { family: 'monospace', size: 13, weight: 'bold' as const },
        bodyColor: '#f3f4f6',
        displayColors: false,
        callbacks: {
          title: (items) => formatDateShort(items[0]?.label ?? ''),
          label: (ctx) => formatCurrency(ctx.parsed.y ?? 0),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: '#9ca3af',
          font: { size: 11 },
          maxTicksLimit: 8,
          callback: function (val, idx) {
            return idx !== undefined && idx % Math.ceil(chartData.length / 8) === 0
              ? formatDateShort(this.getLabelForValue(val as number))
              : '';
          },
        },
        border: { color: 'rgba(255, 255, 255, 0.06)' },
      },
      y: {
        grid: {
          color: 'rgba(255, 255, 255, 0.06)',
          drawTicks: false,
        },
        ticks: {
          color: '#9ca3af',
          font: { size: 11 },
          callback: (val) => `$${(val as number ?? 0).toFixed(2)}`,
        },
        border: { color: 'rgba(255, 255, 255, 0.06)' },
      },
    },
  };

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
      <div className="h-72 min-w-0">
        <Line data={chart} options={options} />
      </div>
    </section>
  );
}
