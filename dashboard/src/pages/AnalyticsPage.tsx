/**
 * pages/AnalyticsPage.tsx — Analytics dashboard with charts (Issue #1970). // token-ok // token-ok
 *
 * Displays session volume, token usage by model, cost trends,
 * top API keys, duration trends, and error/permission stats.
 * @ticket #4310 — recharts → chart.js migration
 */

import { useState, useEffect, useCallback } from 'react';
import { useT } from '../i18n/context';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Bar as BarChart, Line as LineChart, Pie as PieChart } from 'react-chartjs-2';
import { BarChart3, Loader2 } from 'lucide-react';
import { KPIBanner } from '../components/analytics/KPIBanner';
import type { KPIItem } from '../components/analytics/KPIBanner';
import { ModelDistributionBar } from '../components/analytics/ModelDistributionBar';
import { getAnalyticsSummary, getRateLimitAnalytics } from '../api/client';
import { formatCurrency } from '../utils/formatNumber';
import { formatDateShort } from '../utils/formatDate';
import { ErrorState } from '../components/ErrorState';
import { getErrorVariant } from '../utils/getErrorVariant';
import type { AnalyticsSummary, RateLimitAnalyticsResponse } from '../types';
import { RateLimitChart } from '../components/analytics/RateLimitChart';
import { RateLimitForecastCard } from '../components/analytics/RateLimitForecastCard';
import { AgentContributionsPanel } from '../components/analytics/AgentContributionsPanel';
import {
  MODEL_COLORS as CHART_MODEL_COLORS,
  CHART_RGB,
} from '../utils/chartTheme';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Tooltip);

const MODEL_COLORS = CHART_MODEL_COLORS;

const MODEL_RGB: Record<string, string> = {
  'claude-opus-4.7': CHART_RGB.purple,
  'claude-sonnet-4.6': CHART_RGB.cyan,
  'claude-haiku-4.5': CHART_RGB.success,
  'gpt-5.4': CHART_RGB.warning,
  'gpt-4.1': CHART_RGB.info,
  other: CHART_RGB.cyan,
};

const darkTooltip = {
  backgroundColor: 'rgba(15, 15, 25, 0.95)',
  borderColor: 'rgba(255, 255, 255, 0.1)',
  borderWidth: 1,
  cornerRadius: 8,
  padding: 12,
  titleFont: { size: 11 },
  titleColor: '#9ca3af',
  bodyFont: { family: 'monospace' as const, size: 13, weight: 'bold' as const },
  bodyColor: '#f3f4f6',
  displayColors: false,
};

const gridColor = 'rgba(255, 255, 255, 0.06)';
const tickColor = '#9ca3af';
const tickFont = { size: 11 };

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function AnalyticsPage() {
  const t = useT();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [rateLimitData, setRateLimitData] = useState<RateLimitAnalyticsResponse | null>(null);
  const [error, setError] = useState<{ raw: unknown; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [summary, rateLimits] = await Promise.allSettled([
        getAnalyticsSummary(),
        getRateLimitAnalytics(),
      ]);
      if (summary.status === 'fulfilled') {
        setData(summary.value);
        setError(null);
      } else {
        setError({ raw: summary.reason, message: summary.reason instanceof Error ? summary.reason.message : t('analytics.loadError') });
      }
      if (rateLimits.status === 'fulfilled') setRateLimitData(rateLimits.value);
    } catch (e) {
      setError({ raw: e, message: e instanceof Error ? e.message : t('analytics.loadError') });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]" role="status" aria-busy="true">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--color-accent-cyan)]" />
        <span className="ml-3 text-sm text-[var(--color-text-muted)]">Loading analytics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        variant={getErrorVariant(error.raw)}
        message={error.message}
        onRetry={() => { void fetchData(); }}
      />
    );
  }

  if (!data) return null;

  const totalCost = (data.tokenUsageByModel ?? []).reduce((sum, m) => sum + m.estimatedCostUsd, 0);
  const totalTokens = (data.tokenUsageByModel ?? []).reduce(
    (sum, m) => sum + m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens,
    0,
  );
  const avgDuration = (data.durationTrends ?? []).length > 0
    ? Math.round(
        (data.durationTrends ?? []).reduce((sum, d) => sum + d.avgDurationSec * d.count, 0)
        / (data.durationTrends ?? []).reduce((sum, d) => sum + d.count, 0),
      )
    : 0;

  function buildKPIItems(
    analytics: AnalyticsSummary,
    cost: number,
    tokens: number,
    avgDur: number,
  ): KPIItem[] {
    const totalSessions = analytics.errorRates.totalSessions;
    const errorRate = totalSessions > 0
      ? ((analytics.errorRates.failedSessions / totalSessions) * 100).toFixed(1)
      : '0';
    return [
      { id: 'cost', label: 'Total Cost', value: formatCurrency(cost), color: 'cost', subtitle: (analytics.costTrends ?? []).length > 1 ? t('analytics.last14Days') : undefined },
      { id: 'tokens', label: 'Total Tokens', value: formatTokenCount(tokens), color: 'input', subtitle: tokens > 0 ? `${formatTokenCount(tokens)} processed` : undefined },
      { id: 'sessions', label: 'Sessions', value: String(totalSessions), color: 'neutral' },
      { id: 'duration', label: 'Avg Duration', value: formatDuration(avgDur), color: 'time' },
      { id: 'errors', label: 'Error Rate', value: `${errorRate}%`, color: parseFloat(errorRate) > 5 ? 'cost' : 'efficiency', trend: parseFloat(errorRate) > 5 ? 'up' : 'flat' },
    ];
  }

  // Session Volume Line Chart
  const sessionVolumeData = {
    labels: (data.sessionVolume ?? []).map((d) => d.date),
    datasets: [{
      label: 'Sessions',
      data: (data.sessionVolume ?? []).map((d) => d.created),
      borderColor: `rgba(${CHART_RGB.cyan}, 1)`,
      backgroundColor: `rgba(${CHART_RGB.cyan}, 1)`,
      pointRadius: 3,
      pointBackgroundColor: `rgba(${CHART_RGB.cyan}, 1)`,
      borderWidth: 2,
      tension: 0.4,
    }],
  };

  const lineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...darkTooltip,
        callbacks: {
          title: (items) => formatDateShort(items[0]?.label ?? ''),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: tickColor, font: tickFont, maxTicksLimit: 8, callback: function(val, idx) { return idx !== undefined && idx % Math.ceil((data.sessionVolume ?? []).length / 8) === 0 ? formatDateShort(this.getLabelForValue(val as number)) : ''; } },
        border: { color: gridColor },
      },
      y: {
        grid: { color: gridColor, drawTicks: false },
        ticks: { color: tickColor, font: tickFont },
        border: { color: gridColor },
      },
    },
  };

  // Token Usage Pie Chart
  const tokenPieData = {
    labels: (data.tokenUsageByModel ?? []).map((m) => m.model),
    datasets: [{
      data: (data.tokenUsageByModel ?? []).map((m) => m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens),
      backgroundColor: (data.tokenUsageByModel ?? []).map((m) => `rgba(${MODEL_RGB[m.model] ?? MODEL_RGB.other}, 0.7)`),
      hoverBackgroundColor: (data.tokenUsageByModel ?? []).map((m) => `rgba(${MODEL_RGB[m.model] ?? MODEL_RGB.other}, 0.9)`),
      borderWidth: 0,
    }],
  };

  const pieOptions: ChartOptions<'pie'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        ...darkTooltip,
        callbacks: {
          label: (ctx) => `${ctx.label}: ${formatTokenCount(ctx.parsed ?? 0)}`,
        },
      },
    },
  };

  // Cost Trends Bar Chart
  const costTrendsData = {
    labels: (data.costTrends ?? []).map((d) => d.date),
    datasets: [{
      label: 'Daily Cost',
      data: (data.costTrends ?? []).map((d) => d.cost),
      backgroundColor: `rgba(${CHART_RGB.cyan}, 0.7)`,
      borderRadius: 4,
      borderSkipped: false as const,
    }],
  };

  const costBarOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...darkTooltip,
        callbacks: {
          title: (items) => formatDateShort(items[0]?.label ?? ''),
          label: (ctx) => formatCurrency(ctx.parsed.y ?? 0),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: tickColor, font: tickFont, maxTicksLimit: 8, callback: function(val, idx) { return idx !== undefined && idx % Math.ceil((data.costTrends ?? []).length / 8) === 0 ? formatDateShort(this.getLabelForValue(val as number)) : ''; } },
        border: { color: gridColor },
      },
      y: {
        grid: { color: gridColor, drawTicks: false },
        ticks: { color: tickColor, font: tickFont, callback: (val) => `$${(val as number ?? 0).toFixed(2)}` },
        border: { color: gridColor },
      },
    },
  };

  // Duration Trends Line Chart
  const durationData = {
    labels: (data.durationTrends ?? []).map((d) => d.date),
    datasets: [{
      label: 'Avg Duration',
      data: (data.durationTrends ?? []).map((d) => d.avgDurationSec),
      borderColor: `rgba(${CHART_RGB.purple}, 1)`,
      backgroundColor: `rgba(${CHART_RGB.purple}, 1)`,
      pointRadius: 3,
      pointBackgroundColor: `rgba(${CHART_RGB.purple}, 1)`,
      borderWidth: 2,
      tension: 0.4,
    }],
  };

  const durationLineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...darkTooltip,
        callbacks: {
          title: (items) => formatDateShort(items[0]?.label ?? ''),
          label: (ctx) => formatDuration(ctx.parsed.y ?? 0),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: tickColor, font: tickFont, maxTicksLimit: 8, callback: function(val, idx) { return idx !== undefined && idx % Math.ceil((data.durationTrends ?? []).length / 8) === 0 ? formatDateShort(this.getLabelForValue(val as number)) : ''; } },
        border: { color: gridColor },
      },
      y: {
        grid: { color: gridColor, drawTicks: false },
        ticks: { color: tickColor, font: tickFont, callback: (val) => formatDuration(val as number ?? 0) },
        border: { color: gridColor },
      },
    },
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-[var(--color-accent-cyan)]" />
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Analytics</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Session volume, token usage, cost trends, and error rates
          </p>
        </div>
      </div>

      {/* Data consistency check */}
      {(() => {
        const hasSessions = data.errorRates.totalSessions > 0;
        const hasChartData = (data.sessionVolume ?? []).length > 0 || (data.tokenUsageByModel ?? []).length > 0 || (data.durationTrends ?? []).length > 0;
        if (hasSessions && !hasChartData) {
          return (
            <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-lg border border-[var(--color-warning)]/20 bg-[var(--color-warning)]/5 px-4 py-3 text-sm text-[var(--color-warning-glow)]">
              <span aria-hidden="true">⚠</span>
              <span><strong>Data aggregation in progress.</strong> Session count is available but chart data is still being computed. Charts will populate once the metrics cache completes processing.</span>
            </div>
          );
        }
        return null;
      })()}

      <KPIBanner items={buildKPIItems(data, totalCost, totalTokens, avgDuration)} />

      {(data.tokenUsageByModel ?? []).length > 0 && (
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
          <h3 className="mb-3 text-sm font-medium text-[var(--color-text-primary)]">Model Distribution</h3>
          <ModelDistributionBar
            segments={(data.tokenUsageByModel ?? []).map((m) => ({
              model: m.model,
              fraction: m.estimatedCostUsd / (totalCost || 1),
            }))}
            barHeight={10}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label={t("analytics.totalSessions")} value={String(data.errorRates.totalSessions)} />
        <SummaryCard label={t("analytics.totalCost")} value={formatCurrency(totalCost)} />
        <SummaryCard label={t("analytics.totalTokens")} value={data.errorRates.totalSessions > 0 && totalTokens === 0 ? 'Calculating…' : formatTokenCount(totalTokens)} />
        <SummaryCard label={t("analytics.avgDuration")} value={data.errorRates.totalSessions > 0 && avgDuration === 0 ? 'Calculating…' : formatDuration(avgDuration)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title={t("analytics.sessionVolume")}>
          {(data.sessionVolume ?? []).length > 0 ? (
            <div style={{ width: '100%', height: 260 }}><LineChart data={sessionVolumeData} options={lineOptions} /></div>
          ) : <EmptyChart />}
        </ChartCard>

        <ChartCard title={t("analytics.tokenUsage")}>
          {(data.tokenUsageByModel ?? []).length > 0 ? (
            <div className="flex flex-col lg:flex-row items-center gap-4">
              <div className="h-[220px] w-full min-w-0 lg:w-1/2">
                <PieChart data={tokenPieData} options={pieOptions} />
              </div>
              <div className="w-full lg:w-1/2 space-y-2">
                {data.tokenUsageByModel.map((m) => (
                  <div key={m.model} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: MODEL_COLORS[m.model] || MODEL_COLORS.other }} />
                      <span className="font-mono text-[var(--color-text-primary)]">{m.model}</span>
                    </div>
                    <span className="font-mono text-[var(--color-text-muted)]">{formatTokenCount(m.inputTokens + m.outputTokens)} tokens</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <EmptyChart />}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title={t("analytics.costTrends")}>
          {(data.costTrends ?? []).length > 0 ? (
            <div style={{ width: '100%', height: 260 }}><BarChart data={costTrendsData} options={costBarOptions} /></div>
          ) : <EmptyChart />}
        </ChartCard>

        <ChartCard title={t("analytics.topApiKeys")}>
          {(data.topApiKeys ?? []).length > 0 ? (
            <div className="space-y-3">
              {(data.topApiKeys ?? []).map((key) => (
                <div key={key.keyId} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-[var(--color-text-primary)]">{key.keyName}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{key.sessions} session{key.sessions !== 1 ? 's' : ''} &middot; {key.messages} message{key.messages !== 1 ? 's' : ''}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono font-medium text-[var(--color-text-primary)]">{formatCurrency(key.estimatedCostUsd)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyChart />}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title={t("analytics.avgSessionDuration")}>
          {(data.durationTrends ?? []).length > 0 ? (
            <div style={{ width: '100%', height: 260 }}><LineChart data={durationData} options={durationLineOptions} /></div>
          ) : <EmptyChart />}
        </ChartCard>

        <ChartCard title={t("analytics.errorRates")}>
          <div className="space-y-5">
            <RateBar label={t("analytics.sessionFailureRate")} value={data.errorRates.failureRate} detail={`${data.errorRates.failedSessions} failed / ${data.errorRates.totalSessions} total`} color="red" />
            <RateBar label={t("analytics.autoApprovalRate")} value={data.errorRates.approvals > 0 ? data.errorRates.autoApprovals / data.errorRates.approvals : 0} detail={`${data.errorRates.autoApprovals} auto / ${data.errorRates.approvals} total approvals`} color="green" />
            <div className="grid grid-cols-2 gap-4 pt-2">
              <MetricBox label={t("analytics.permissionPrompts")} value={String(data.errorRates.permissionPrompts)} />
              <MetricBox label={t("analytics.manualApprovals")} value={String(data.errorRates.approvals - data.errorRates.autoApprovals)} />
            </div>
          </div>
        </ChartCard>
      </div>

      {rateLimitData && (
        <div className="flex flex-col gap-4">
          <RateLimitChart perKey={rateLimitData.perKey} />
          <RateLimitForecastCard forecast={rateLimitData.forecast} />
        </div>
      )}

      <AgentContributionsPanel />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
      <div className="mb-1 text-xs text-[var(--color-text-muted)]">{label}</div>
      <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">{value}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
      <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">{title}</h3>
      {children}
    </section>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[200px] items-center justify-center text-sm text-[var(--color-text-muted)]">
      No data available yet
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
      <div className="mt-1 text-lg font-bold font-mono text-[var(--color-text-primary)]">{value}</div>
    </div>
  );
}

function RateBar({ label, value, detail, color }: { label: string; value: number; detail: string; color: 'red' | 'green' }) {
  const pct = Math.min(value * 100, 100);
  const barColor = color === 'red' ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-success)]';
  const textColor = color === 'red' ? 'text-[var(--color-danger)]' : 'text-[var(--color-success-glow)]';

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--color-text-primary)]">{label}</span>
        <span className={`font-mono font-medium ${textColor}`}>{pct.toFixed(1)}%</span>
      </div>
      <div className="mt-1 h-2 w-full rounded-full bg-[var(--color-void-lighter)]">
        <div className={`h-2 rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-[var(--color-text-muted)]">{detail}</div>
    </div>
  );
}
