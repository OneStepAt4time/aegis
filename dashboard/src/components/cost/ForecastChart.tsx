/**
 * ForecastChart.tsx — Cost forecast line chart with projected trend.
 *
 * Shows actual daily spend and a linear regression projection line.
 * Part of issue #3125: Budget Alerts & Cost Forecasts.
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Legend,
} from 'recharts';
import { formatCurrency } from '../../utils/formatNumber';
import { formatDateShort } from '../../utils/formatDate';
import { ChartFrame } from '../shared/ChartFrame';
import { useT } from '../../i18n/context';

export interface ForecastChartProps {
  /** Daily cost trends from analytics API. */
  dailyTrends: Array<{
    date: string;
    estimatedCostUsd: number;
    sessions: number;
  }>;
  /** Optional monthly budget cap for reference line. Zero = no line. */
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

  // Build regression from actual data points
  const regressionPoints = dailyTrends.map((d, i) => ({
    x: i,
    y: d.estimatedCostUsd,
  }));
  const { slope, intercept } = linearRegression(regressionPoints);

  // Generate chart data: actual days + projected remaining days
  const chartData: ChartPoint[] = [];

  // Actual data points
  dailyTrends.forEach((d) => {
    chartData.push({
      date: d.date,
      actual: d.estimatedCostUsd,
      projected: null,
    });
  });

  // Projected data: start from last actual point, extend to end of month
  if (dailyTrends.length >= 2) {
    const lastIdx = dailyTrends.length - 1;
    const lastDate = new Date(dailyTrends[lastIdx].date + 'T00:00:00Z');
    const lastDay = lastDate.getDate();

    // Add the last actual point as projection start for continuity
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

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string; dataKey?: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 shadow-xl">
      <p className="mb-2 text-xs font-medium text-[var(--color-text-primary)]">
        {label ? formatDateShort(label) : ''}
      </p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center justify-between gap-4 text-xs">
          <span className="text-[var(--color-text-muted)]">{entry.name}:</span>
          <span className="font-mono font-medium text-[var(--color-text-primary)]">
            {formatCurrency(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
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

  // Calculate projected monthly total for display
  const lastProjected = chartData.filter(d => d.projected !== null);
  const projectedMonthlyTotal = lastProjected.length > 0
    ? lastProjected.reduce((sum, d) => sum + (d.projected ?? 0), 0) + 
      chartData.filter(d => d.actual !== null && d.projected === null).reduce((sum, d) => sum + (d.actual ?? 0), 0)
    : 0;

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

      <ChartFrame className="h-72 min-w-0" label="Cost forecast loading">
        {({ width, height }) => (
          <LineChart width={width} height={height} data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-void-lighter)" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateShort}
              tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
              stroke="var(--color-void-lighter)"
            />
            <YAxis
              tickFormatter={(value) => `$${value.toFixed(2)}`}
              tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
              stroke="var(--color-void-lighter)"
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ color: 'var(--color-text-muted)', fontSize: 12 }}
            />
            <Line
              type="monotone"
              dataKey="actual"
              name="Actual Spend"
              stroke="var(--color-accent-cyan)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--color-accent-cyan)' }}
              connectNulls={false}
              animationDuration={500}
            />
            <Line
              type="monotone"
              dataKey="projected"
              name="Projected"
              stroke="var(--color-accent-cyan)"
              strokeWidth={2}
              strokeDasharray="8 4"
              dot={false}
              connectNulls={false}
              animationDuration={500}
            />
            {monthlyCap > 0 && (
              <ReferenceLine
                y={monthlyCap}
                stroke="var(--color-danger)"
                strokeDasharray="4 4"
                label={{
                  value: `Cap: ${formatCurrency(monthlyCap)}`,
                  position: 'right',
                  fill: 'var(--color-danger)',
                  fontSize: 11,
                }}
              />
            )}
          </LineChart>
        )}
      </ChartFrame>
    </section>
  );
}
