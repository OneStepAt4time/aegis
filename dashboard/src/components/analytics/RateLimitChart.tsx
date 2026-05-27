/**
 * components/analytics/RateLimitChart.tsx — Per-key quota usage bars (Issue #2283). // token-ok // token-ok
 *
 * Bar chart showing sessions, tokens, and spend usage per API key
 * with color-coded thresholds: <66% cyan, 66-90% amber, >90% red.
 *
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
import type { RateLimitKeyUsage } from '../../types';
import { useT } from '../../i18n/context';
import { CHART_COLORS, CHART_RGB } from '../../utils/chartTheme';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

export function barColor(ratio: number): string {
  if (ratio >= 0.9) return CHART_COLORS.danger;
  if (ratio >= 0.66) return CHART_COLORS.warning;
  return CHART_COLORS.cyan;
}

function barColorRgb(ratio: number): string {
  if (ratio >= 0.9) return `rgba(${CHART_RGB.danger}, 0.7)`;
  if (ratio >= 0.66) return `rgba(${CHART_RGB.warning}, 0.7)`;
  return `rgba(${CHART_RGB.cyan}, 0.7)`;
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

  const chart = {
    labels: data.map((d) => d.name),
    datasets: [
      {
        label: 'Sessions',
        data: data.map((d) => d.sessionRatio),
        backgroundColor: data.map((d) => barColorRgb(d.sessionRatio)),
        borderRadius: 4,
        borderSkipped: false as const,
      },
      {
        label: 'Tokens',
        data: data.map((d) => d.tokenRatio),
        backgroundColor: data.map((d) => barColorRgb(d.tokenRatio)),
        borderRadius: 4,
        borderSkipped: false as const,
      },
      {
        label: 'Spend',
        data: data.map((d) => d.spendRatio),
        backgroundColor: data.map((d) => barColorRgb(d.spendRatio)),
        borderRadius: 4,
        borderSkipped: false as const,
      },
    ],
  };

  const options: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    scales: {
      x: {
        min: 0,
        max: 1,
        grid: {
          color: 'rgba(255, 255, 255, 0.06)',
          drawTicks: false,
        },
        ticks: {
          color: '#9ca3af',
          font: { size: 11 },
          callback: (val) => `${Math.round((val as number ?? 0) * 100)}%`,
        },
        border: { color: 'rgba(255, 255, 255, 0.06)' },
      },
      y: {
        grid: { display: false },
        ticks: {
          color: '#f3f4f6',
          font: { size: 11 },
        },
        border: { color: 'rgba(255, 255, 255, 0.06)' },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15, 15, 25, 0.95)',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 12,
        titleColor: '#9ca3af',
        bodyColor: '#f3f4f6',
        displayColors: false,
        callbacks: {
          title: (items) => items[0]?.label ?? '',
          label: (ctx) => {
            const row = data[ctx.dataIndex];
            if (!row) return '';
            return [
              `Sessions: ${row.sessions}${row.sessionsMax != null ? ` / ${row.sessionsMax}` : ''}`,
              `Tokens: ${formatTokenCount(row.tokens)}${row.tokensMax != null ? ` / ${formatTokenCount(row.tokensMax)}` : ''}`,
              `Spend: ${formatUsd(row.spend)}${row.spendMax != null ? ` / ${formatUsd(row.spendMax)}` : ''}`,
            ];
          },
        },
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
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_COLORS.cyan }} />
          Sessions
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_COLORS.warning }} />
          Tokens
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_COLORS.danger }} />
          Spend
        </span>
      </div>

      <div style={{ width: '100%', height: Math.max(200, data.length * 60) }}>
        <Bar data={chart} options={options} />
      </div>
    </section>
  );
}
