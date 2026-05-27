/**
 * ForecastChart.tsx — Cost forecast line chart with projected trend.
 *
 * Shows actual daily spend and a linear regression projection line.
 * Part of issue #3125: Budget Alerts & Cost Forecasts. // token-ok
 * @ticket #4310 — recharts → chart.js migration
 */

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import { Line } from 'react-chartjs-2';
import { formatCurrency } from '../../utils/formatNumber';
import { formatDateShort } from '../../utils/formatDate';
import { CHART_RGB } from '../../utils/chartTheme';
import { useT } from '../../i18n/context';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, annotationPlugin);

export interface ForecastChartProps {
  dailyTrends: Array<{
    date: string;
    estimatedCostUsd: number;
    sessions: number;
  }>;
  monthlyCap?: number;
}

interface ChartPoint {
  date: string;
  actual: number | null;
  projected: number | null;
}

function linearRegression(points: Array<{ x: number; y: number }>): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? points[0].y : 0 };

  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function buildChartData(dailyTrends: ForecastChartProps['dailyTrends']): ChartPoint[] {
  if (dailyTrends.length === 0) return [];

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const regressionPoints = dailyTrends.map((d, i) => ({
    x: i,
    y: d.estimatedCostUsd,
  }));
  const { slope, intercept } = linearRegression(regressionPoints);

  const chartData: ChartPoint[] = [];

  dailyTrends.forEach((d) => {
    chartData.push({
      date: d.date,
      actual: d.estimatedCostUsd,
      projected: null,
    });
  });

  if (dailyTrends.length >= 2) {
    const lastIdx = dailyTrends.length - 1;
    const lastDate = new Date(dailyTrends[lastIdx].date + 'T00:00:00Z');
    const lastDay = lastDate.getDate();

    chartData[lastIdx].projected = dailyTrends[lastIdx].estimatedCostUsd;

    for (let day = lastDay + 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const projectedIdx = lastIdx + (day - lastDay);
      const projectedValue = Math.max(0, slope * projectedIdx + intercept);
      chartData.push({
        date: dateStr,
        actual: null,
        projected: projectedValue,
      });
    }
  }

  return chartData;
}

export function ForecastChart({ dailyTrends, monthlyCap = 0 }: ForecastChartProps) {
  const t = useT();

  const chartData = buildChartData(dailyTrends);
  const hasData = chartData.length > 0;

  if (!hasData) {
    return (
      <div
        className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5"
        aria-label={t("aria.costForecastChart")}
      >
        <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
          Cost Forecast
        </h3>
        <p className="text-sm text-[var(--color-text-muted)]">
          Not enough data for forecasting. Collect at least 2 days of cost data.
        </p>
      </div>
    );
  }

  const lastProjected = chartData.filter(d => d.projected !== null);
  const projectedMonthlyTotal = lastProjected.length > 0
    ? lastProjected.reduce((sum, d) => sum + (d.projected ?? 0), 0) +
      chartData.filter(d => d.actual !== null && d.projected === null).reduce((sum, d) => sum + (d.actual ?? 0), 0)
    : 0;

  const chart = {
    labels: chartData.map((d) => d.date),
    datasets: [
      {
        label: 'Actual Spend',
        data: chartData.map((d) => d.actual),
        borderColor: `rgba(${CHART_RGB.cyan}, 1)`,
        backgroundColor: `rgba(${CHART_RGB.cyan}, 1)`,
        pointRadius: 3,
        pointBackgroundColor: `rgba(${CHART_RGB.cyan}, 1)`,
        borderWidth: 2,
        spanGaps: false,
      },
      {
        label: 'Projected',
        data: chartData.map((d) => d.projected),
        borderColor: `rgba(${CHART_RGB.cyan}, 0.6)`,
        borderDash: [8, 4],
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: false,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    plugins: {
      legend: {
        display: true,
        labels: {
          color: '#9ca3af',
          font: { size: 12 },
          boxWidth: 12,
          boxHeight: 2,
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
        bodyFont: { family: 'monospace', size: 13, weight: 'bold' as const },
        bodyColor: '#f3f4f6',
        callbacks: {
          title: (items) => formatDateShort(items[0]?.label ?? ''),
          label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y ?? 0)}`,
        },
      },
      ...(monthlyCap > 0 ? {
        annotation: {
          annotations: {
            capLine: {
              type: 'line' as const,
              yMin: monthlyCap,
              yMax: monthlyCap,
              borderColor: `rgba(${CHART_RGB.danger}, 0.8)`,
              borderWidth: 1,
              borderDash: [4, 4],
              label: {
                display: true,
                content: `Cap: ${formatCurrency(monthlyCap)}`,
                position: 'end' as const,
                color: `rgba(${CHART_RGB.danger}, 1)`,
                font: { size: 11 },
              },
            },
          },
        },
      } : {}),
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
      className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5"
      aria-label={t("aria.costForecastChart")}
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--color-text-primary)]">
          Cost Forecast
        </h3>
        {projectedMonthlyTotal > 0 && (
          <p className="text-sm text-[var(--color-text-muted)]">
            Projected total: <span className="font-mono font-bold text-[var(--color-text-primary)]">
              {formatCurrency(projectedMonthlyTotal)}
            </span>
          </p>
        )}
      </div>

      <div className="h-72 min-w-0">
        <Line data={chart} options={options} />
      </div>
    </section>
  );
}
