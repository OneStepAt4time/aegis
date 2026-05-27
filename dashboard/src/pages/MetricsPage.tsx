/**
 * pages/MetricsPage.tsx — Aggregated metrics dashboard with charts and breakdown.
 * Issue #2087: Metrics aggregation dashboard. // token-ok
 */

import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Clock, DollarSign, CheckCircle, AlertTriangle, Download } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Bar as ChartBar, Line as ChartLine } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip);
import {
  CHART_RGB,
} from '../utils/chartTheme';

import { getMetricsAggregate, type AggregateMetricsResponse } from '../api/client';
import { useStore } from '../store/useStore';
import { useT } from '../i18n/context';
import { formatCurrency } from '../utils/formatNumber';
import { formatDateShort } from '../utils/formatDate';
import { downloadCSV } from '../utils/csv-export';
import { sanitizeErrorMessage } from '../utils/sanitizeErrorMessage';
import { SkeletonStatCard } from '../components/shared/Skeleton';
import { ErrorState } from '../components/ErrorState';
import { getErrorVariant } from '../utils/getErrorVariant';

type RangePreset = '7d' | '30d' | '90d';
type Granularity = 'day' | 'hour' | 'key';

const RANGE_MS: Record<RangePreset, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}


function generateCSV(data: AggregateMetricsResponse): string {
  const headers = ['Timestamp', 'Sessions', 'Messages', 'Tool Calls', 'Token Cost (USD)'];
  const rows = (data.timeSeries ?? []).map((tp) => [
    tp.timestamp,
    String(tp.sessions),
    String(tp.messages),
    String(tp.toolCalls),
    tp.tokenCostUsd.toFixed(2),
  ]);
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export default function MetricsPage() {
  const t = useT();
  const [data, setData] = useState<AggregateMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ raw: unknown; message: string } | null>(null);
  const [range, setRange] = useState<RangePreset>('7d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const sseConnected = useStore((s) => s.sseConnected);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const now = new Date();
      const from = new Date(now.getTime() - RANGE_MS[range]).toISOString();
      const result = await getMetricsAggregate({ from, to: now.toISOString(), groupBy: granularity });
      setData(result);
    } catch (err) {
      setError({ raw: err, message: sanitizeErrorMessage(err, t('metrics.loadError')) });
    } finally {
      setLoading(false);
    }
  }, [range, granularity]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleExport = () => {
    if (!data) return;
    const csv = generateCSV(data);
    const timestamp = new Date().toISOString().replace(/[:]/g, '-');
    downloadCSV(csv, `metrics-export-${timestamp}.csv`);
  };

  const summary = data?.summary;

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-[var(--color-accent-cyan)]" />
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Metrics</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Aggregated usage analytics across sessions
            {sseConnected && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                Live
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Range selector */}
          {(['7d', '30d', '90d'] as RangePreset[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`min-h-[44px] rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                range === r
                  ? 'bg-[var(--color-accent-cyan)] text-[var(--color-void-dark)]'
                  : 'bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : '90 Days'}
            </button>
          ))}

          <span className="mx-2 hidden h-4 w-px bg-[var(--color-border-strong)] sm:block" />

          {/* Granularity selector */}
          {(['day', 'hour', 'key'] as Granularity[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={`min-h-[44px] rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                granularity === g
                  ? 'bg-[var(--color-accent-cyan)] text-[var(--color-void-dark)]'
                  : 'bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={!data}
          className="flex min-h-[44px] items-center gap-1.5 rounded-md bg-[var(--color-surface-strong)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:text-[var(--color-accent-cyan)] disabled:cursor-not-allowed disabled:text-[var(--color-text-muted)]"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </button>
      </div>

      {/* Error state */}
      {error && (
        <ErrorState
          variant={getErrorVariant(error.raw)}
          message={error.message}
          onRetry={() => { void fetchData(); }}
        />
      )}

      {/* Loading state */}
      {loading && !data && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonStatCard key={i} />
          ))}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
          <div className="mb-1 flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
            <BarChart3 className="h-3 w-3" />
            Total Sessions
          </div>
          <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {(summary?.totalSessions ?? 0).toLocaleString()}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
          <div className="mb-1 flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
            <Clock className="h-3 w-3" />
            Avg Duration
          </div>
          <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {summary ? formatDuration(summary.avgDurationSeconds) : '—'}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
          <div className="mb-1 flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
            <DollarSign className="h-3 w-3" />
            Total Cost
          </div>
          <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {summary ? formatCurrency(summary.totalTokenCostUsd) : '—'}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
          <div className="mb-1 flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
            <CheckCircle className="h-3 w-3" />
            Approval Rate
          </div>
          <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {summary?.permissionApprovalRate != null ? `${summary.permissionApprovalRate}%` : '—'}
          </div>
        </div>
      </div>

      {/* Anomaly alerts */}
      {data && data.anomalies?.length > 0 && (
        <section className="rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-4" aria-label={t("aria.anomalousSessions")}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-[var(--color-warning)] mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-[var(--color-warning-glow)]">
                Anomalous Sessions ({(data.anomalies ?? []).length})
              </h4>
              <p className="mt-1 text-xs text-[var(--color-warning)]/80">
                Sessions flagged for token cost exceeding p95 by 3x or more.
              </p>
              <div className="mt-2 space-y-1">
                {(data.anomalies ?? []).map((a) => (
                  <div key={a.sessionId} className="flex items-center gap-2 text-xs">
                    <span className="inline-flex rounded bg-[var(--color-warning)]/20 px-1.5 py-0.5 font-mono text-[var(--color-warning-glow)]">
                      {a.sessionId.slice(0, 12)}
                    </span>
                    <span className="text-[var(--color-warning)]/80">
                      {formatCurrency(a.tokenCostUsd)} — {a.reason}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Time-series chart */}
      {data && granularity !== 'key' && (
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
          <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
            Sessions &amp; Cost Over Time
          </h3>
          <div className="h-64 min-w-0">
            <ChartBar data={{
              labels: data.timeSeries.map((d) => d.timestamp),
              datasets: [{
                label: t("metrics.chartSessions"),
                data: data.timeSeries.map((d) => d.sessions),
                backgroundColor: `rgba(${CHART_RGB.cyan}, 0.7)`,
                borderRadius: 4,
                borderSkipped: false,
              }],
            }} options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15,15,25,0.95)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, cornerRadius: 8, padding: 12, titleFont: { size: 11 }, titleColor: '#9ca3af', bodyFont: { family: 'monospace', size: 13, weight: 'bold' }, bodyColor: '#f3f4f6', displayColors: false, callbacks: { title: (items) => formatDateShort(items[0]?.label ?? '') } } },
              scales: { x: { grid: { display: false }, ticks: { color: '#9ca3af', font: { size: 11 }, maxTicksLimit: 8 }, border: { color: 'rgba(255,255,255,0.06)' } }, y: { grid: { color: 'rgba(255,255,255,0.06)', drawTicks: false }, ticks: { color: '#9ca3af', font: { size: 11 } }, border: { color: 'rgba(255,255,255,0.06)' } } },
            } satisfies ChartOptions<'bar'>} />
          </div>
        </section>
      )}

      {/* Cost trend line chart */}
      {data && granularity !== 'key' && (data.timeSeries ?? []).length > 0 && (
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
          <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
            Token Cost Trend
          </h3>
          <div className="h-48 min-w-0">
            <ChartLine data={{
              labels: data.timeSeries.map((d) => d.timestamp),
              datasets: [{
                label: t("metrics.chartTokenCost"),
                data: data.timeSeries.map((d) => d.tokenCostUsd),
                borderColor: `rgba(${CHART_RGB.purple}, 1)`,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.4,
              }],
            }} options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15,15,25,0.95)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, cornerRadius: 8, padding: 12, titleFont: { size: 11 }, titleColor: '#9ca3af', bodyFont: { family: 'monospace', size: 13, weight: 'bold' }, bodyColor: '#f3f4f6', displayColors: false, callbacks: { title: (items) => formatDateShort(items[0]?.label ?? ''), label: (ctx) => `$${((ctx.parsed.y ?? 0) as number).toFixed(2)}` } } },
              scales: { x: { grid: { display: false }, ticks: { color: '#9ca3af', font: { size: 11 }, maxTicksLimit: 8 }, border: { color: 'rgba(255,255,255,0.06)' } }, y: { grid: { color: 'rgba(255,255,255,0.06)', drawTicks: false }, ticks: { color: '#9ca3af', font: { size: 11 }, callback: (v) => `$${((v as number) ?? 0).toFixed(2)}` }, border: { color: 'rgba(255,255,255,0.06)' } } },
            } satisfies ChartOptions<'line'>} />
          </div>
        </section>
      )}

      {/* By-key breakdown table */}
      {data && (data.byKey ?? []).length > 0 && (
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
          <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
            Breakdown by API Key
          </h3>
          <div className="overflow-x-auto" tabIndex={0} aria-label={t("aria.metricsTable")}>
            <table className="w-full text-sm" aria-label={t("aria.metricsByKey")}>
              <thead>
                <tr className="border-b border-[var(--color-border-strong)]">
                  <th scope="col" className="pb-2 text-left text-xs font-medium text-[var(--color-text-muted)]">Key Name</th>
                  <th scope="col" className="pb-2 text-right text-xs font-medium text-[var(--color-text-muted)]">Sessions</th>
                  <th scope="col" className="pb-2 text-right text-xs font-medium text-[var(--color-text-muted)]">Messages</th>
                  <th scope="col" className="pb-2 text-right text-xs font-medium text-[var(--color-text-muted)]">Tool Calls</th>
                  <th scope="col" className="pb-2 text-right text-xs font-medium text-[var(--color-text-muted)]">Token Cost</th>
                </tr>
              </thead>
              <tbody>
                {(data.byKey ?? []).map((row) => (
                  <tr key={row.keyId} className="border-b border-[var(--color-border-strong)]/50">
                    <td className="py-2 font-mono text-[var(--color-text-primary)]">{row.keyName}</td>
                    <td className="py-2 text-right font-mono text-[var(--color-text-primary)]">{row.sessions.toLocaleString()}</td>
                    <td className="py-2 text-right font-mono text-[var(--color-text-primary)]">{row.messages.toLocaleString()}</td>
                    <td className="py-2 text-right font-mono text-[var(--color-text-primary)]">{row.toolCalls.toLocaleString()}</td>
                    <td className="py-2 text-right font-mono text-[var(--color-text-primary)]">{formatCurrency(row.tokenCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Empty state */}
      {data && data.summary?.totalSessions === 0 && (
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-8 text-center">
          <BarChart3 className="mx-auto h-8 w-8 text-[var(--color-text-muted)]" />
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            No session data found for the selected time range.
          </p>
        </div>
      )}
    </div>
  );
}
