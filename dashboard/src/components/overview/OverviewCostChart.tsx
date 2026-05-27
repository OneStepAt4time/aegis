/**
 * OverviewCostChart — lazy-loaded cost chart for OverviewPage.
 * Uses chart.js + react-chartjs-2 for smaller bundle vs recharts.
 * @ticket #2934 // token-ok
 * @ticket #3399 — chart polish with design tokens // token-ok
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
import { formatDateShort } from '../../utils/formatDate';
import { CHART_RGB } from '../../utils/chartTheme';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface CostTrend {
  date: string;
  cost: number;
}

interface OverviewCostChartProps {
  data: CostTrend[];
}

export function OverviewCostChart({ data }: OverviewCostChartProps) {
  const chartData = {
    labels: data.map((d) => d.date),
    datasets: [
      {
        label: 'Daily Cost',
        data: data.map((d) => d.cost),
        backgroundColor: `rgba(${CHART_RGB.cyan}, 0.7)`,
        hoverBackgroundColor: `rgba(${CHART_RGB.cyan}, 0.9)`,
        borderRadius: 4,
        borderSkipped: false as const,
      },
    ],
  };

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 500,
    },
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
        bodyFont: { size: 13, weight: 'bold' as const },
        bodyColor: '#f3f4f6',
        displayColors: false,
        callbacks: {
          title: (items) => formatDateShort(items[0]?.label ?? ''),
          label: (ctx) => `$${(ctx.parsed.y ?? 0).toFixed(2)}`,
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: '#9ca3af',
          font: { size: 11 },
          maxRotation: 45,
          callback: function (val, idx) {
            const label = this.getLabelForValue(val as number);
            return idx !== undefined && idx % Math.ceil(data.length / 8) === 0
              ? formatDateShort(label)
              : '';
          },
        },
        border: {
          color: 'rgba(255, 255, 255, 0.06)',
        },
      },
      y: {
        grid: {
          color: 'rgba(255, 255, 255, 0.06)',
          drawTicks: false,
        },
        ticks: {
          color: '#9ca3af',
          font: { size: 11 },
          callback: (val) => `$${(val as number).toFixed(2)}`,
        },
        border: {
          color: 'rgba(255, 255, 255, 0.06)',
        },
      },
    },
  };

  return (
    <div style={{ width: '100%', height: 220 }}>
      <Bar data={chartData} options={options} />
    </div>
  );
}
