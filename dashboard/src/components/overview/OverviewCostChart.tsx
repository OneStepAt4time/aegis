/**
 * OverviewCostChart — lazy-loaded cost chart for OverviewPage.
 * Migrated from recharts to chart.js for ~300KB bundle savings.
 * @ticket #4310
 */

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { formatDateShort } from '../../utils/formatDate';
import { CHART_RGB } from '../../utils/chartTheme';

// Register only the components we use
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip);

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
        borderColor: `rgba(${CHART_RGB.cyan}, 1)`,
        borderWidth: 1,
        borderRadius: 4,
        barPercentage: 0.7,
      },
    ],
  };

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15, 15, 20, 0.95)',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        titleColor: 'rgba(255, 255, 255, 0.6)',
        bodyColor: 'rgba(255, 255, 255, 0.9)',
        bodyFont: { weight: "bold" as const },
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          title: (items) => formatDateShort(items[0].label),
          label: (item) => `$${Number(item.raw).toFixed(2)}`,
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: true,
          drawOnChartArea: true,
          drawTicks: false,
          color: 'rgba(255, 255, 255, 0.06)',
        },
        ticks: {
          color: 'rgba(255, 255, 255, 0.4)',
          font: { size: 11 },
          callback: function (value) {
            const label = this.getLabelForValue(value as number);
            return formatDateShort(label);
          },
          maxRotation: 0,
        },
        border: { color: 'rgba(255, 255, 255, 0.06)' },
      },
      y: {
        grid: {
          drawOnChartArea: true,
          drawTicks: false,
          color: 'rgba(255, 255, 255, 0.06)',
        },
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
    <div style={{ width: '100%', height: 220 }}>
      <Bar data={chartData} options={options} />
    </div>
  );
}
