/**
 * ForecastChart.tsx — Cost forecast line chart with projected trend.
 * Migrated from recharts to chart.js for bundle savings.
 * @ticket #4310
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
import { Line } from 'react-chartjs-2';
import { formatCurrency } from '../../utils/formatNumber';
import { formatDateShort } from '../../utils/formatDate';
import { CHART_RGB } from '../../utils/chartTheme';
import { useT } from '../../i18n/context';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

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
  const regressionPoints = dailyTrends.map((d, i) => ({ x: i, y: d.estimatedCostUsd }));
  const { slope, intercept } = linearRegression(regressionPoints);
  const chartData: ChartPoint[] = [];
  dailyTrends.forEach((d) => {
    chartData.push({ date: d.date, actual: d.estimatedCostUsd, projected: null });
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
      chartData.push({ date: dateStr, actual: null, projected: projectedValue });
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

  const cyan = `rgba(${CHART_RGB.cyan}, 1)`;
  const danger = `rgba(${CHART_RGB.danger}, 1)`;

  const datasets = [
    {
      label: 'Actual Spend',
      data: chartData.map((d) => d.actual),
      borderColor: cyan,
      backgroundColor: cyan,
      pointRadius: 3,
      pointBackgroundColor: cyan,
      borderWidth: 2,
      spanGaps: false,
    },
    {
      label: 'Projected',
      data: chartData.map((d) => d.projected),
      borderColor: cyan,
      borderDash: [8, 4],
      pointRadius: 0,
      borderWidth: 2,
      spanGaps: false,
    },
  ];

  // Add budget cap as a horizontal annotation line (via a flat dataset)
  if (monthlyCap > 0) {
    datasets.push({
      label: `Cap: ${formatCurrency(monthlyCap)}`,
      data: chartData.map(() => monthlyCap),
      borderColor: danger,
      borderDash: [4, 4],
      pointRadius: 0,
      borderWidth: 1,
      spanGaps: true,
    });
  }

  const chartJsData = { labels: chartData.map((d) => d.date), datasets };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    plugins: {
      legend: {
        display: true,
        labels: { color: 'rgba(255, 255, 255, 0.4)', font: { size: 12 } },
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
          label: (item) => `${item.dataset.label}: ${formatCurrency(Number(item.raw))}`,
        },
      },
    },
    scales: {
      x: {
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
        grid: { drawOnChartArea: true, color: 'rgba(255, 255, 255, 0.06)' },
        ticks: {
          color: 'rgba(255, 255, 255, 0.4)',
          font: { size: 11 },
          callback: (value) => `$${Number(value).toFixed(2)}`,
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
      <div style={{ height: 288 }}>
        <Line data={chartJsData} options={options} />
      </div>
    </section>
  );
}
