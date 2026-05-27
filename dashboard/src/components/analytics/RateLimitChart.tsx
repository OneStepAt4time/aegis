/**
 * components/analytics/RateLimitChart.tsx — Per-key quota usage bars.
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
import type { RateLimitKeyUsage } from '../../types';
import { useT } from '../../i18n/context';
import { CHART_RGB } from '../../utils/chartTheme';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

function barColorRgb(ratio: number): string {
  if (ratio >= 0.9) return CHART_RGB.danger;
  if (ratio >= 0.66) return CHART_RGB.warning;
  return CHART_RGB.cyan;
}

export function barColor(ratio: number): string {
  return `rgba(${barColorRgb(ratio)}, 0.8)`;
}

export interface RateLimitChartProps {
  perKey: RateLimitKeyUsage[];
}

interface ChartRow {
  name: string;
  sessions: number;
  sessionsMax: number | null;
  tokens: number;
  tokensMax: number | null;
  spend: number;
  spendMax: number | null;
  sessionRatio: number;
  tokenRatio: number;
  spendRatio: number;
}

function toChartRows(perKey: RateLimitKeyUsage[]): ChartRow[] {
  return perKey.map((k) => {
    const sr = k.maxSessions != null && k.maxSessions > 0 ? k.activeSessions / k.maxSessions : 0;
    const tr = k.maxTokens != null && k.maxTokens > 0 ? k.tokensInWindow / k.maxTokens : 0;
    const spr = k.maxSpendUsd != null && k.maxSpendUsd > 0 ? k.spendInWindowUsd / k.maxSpendUsd : 0;
    return {
      name: k.keyName,
      sessions: k.activeSessions,
      sessionsMax: k.maxSessions,
      tokens: k.tokensInWindow,
      tokensMax: k.maxTokens,
      spend: k.spendInWindowUsd,
      spendMax: k.maxSpendUsd,
      sessionRatio: sr,
      tokenRatio: tr,
      spendRatio: spr,
    };
  });
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function RateLimitChart({ perKey }: RateLimitChartProps) {
  const t = useT();

  if (perKey.length === 0) {
    return (
      <div
        className="flex h-[200px] items-center justify-center text-sm text-[var(--color-text-muted)]"
        role="status"
        aria-label={t("aria.noRateLimitData")}
      >
        No rate-limit data available
      </div>
    );
  }

  const data = toChartRows(perKey);

  const chartJsData = {
    labels: data.map((d) => d.name),
    datasets: [
      {
        label: 'Sessions',
        data: data.map((d) => d.sessionRatio),
        backgroundColor: data.map((d) => barColor(d.sessionRatio)),
        borderWidth: 0,
        borderRadius: 4,
        barPercentage: 0.8,
      },
      {
        label: 'Tokens',
        data: data.map((d) => d.tokenRatio),
        backgroundColor: data.map((d) => barColor(d.tokenRatio)),
        borderWidth: 0,
        borderRadius: 4,
        barPercentage: 0.8,
      },
      {
        label: 'Spend',
        data: data.map((d) => d.spendRatio),
        backgroundColor: data.map((d) => barColor(d.spendRatio)),
        borderWidth: 0,
        borderRadius: 4,
        barPercentage: 0.8,
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
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          label: (item) => {
            const idx = item.dataIndex;
            const row = data[idx];
            if (!row) return '';
            const ds = item.dataset.label;
            if (ds === 'Sessions') return `Sessions: ${row.sessions}${row.sessionsMax != null ? ` / ${row.sessionsMax}` : ''}`;
            if (ds === 'Tokens') return `Tokens: ${formatTokenCount(row.tokens)}${row.tokensMax != null ? ` / ${formatTokenCount(row.tokensMax)}` : ''}`;
            if (ds === 'Spend') return `Spend: ${formatUsd(row.spend)}${row.spendMax != null ? ` / ${formatUsd(row.spendMax)}` : ''}`;
            return '';
          },
        },
      },
    },
    scales: {
      x: {
        min: 0,
        max: 1,
        grid: { drawOnChartArea: true, color: 'rgba(255, 255, 255, 0.06)' },
        ticks: {
          color: 'rgba(255, 255, 255, 0.4)',
          font: { size: 11 },
          callback: (value) => `${Math.round(Number(value) * 100)}%`,
        },
        border: { color: 'rgba(255, 255, 255, 0.06)' },
      },
      y: {
        grid: { display: false },
        ticks: { color: 'rgba(255, 255, 255, 0.9)', font: { size: 11 } },
        border: { color: 'rgba(255, 255, 255, 0.06)' },
      },
    },
  };

  return (
    <section
      className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5"
      aria-label={t("aria.rateLimitChart")}
      role="region"
    >
      <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
        Per-Key Rate-Limit Usage
      </h3>

      {/* Dimension legend */}
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: `rgba(${CHART_RGB.cyan}, 0.8)` }} />
          Sessions
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: `rgba(${CHART_RGB.warning}, 0.8)` }} />
          Tokens
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: `rgba(${CHART_RGB.danger}, 0.8)` }} />
          Spend
        </span>
      </div>

      <div style={{ height: Math.max(200, data.length * 60) }}>
        <Bar data={chartJsData} options={options} />
      </div>
    </section>
  );
}
