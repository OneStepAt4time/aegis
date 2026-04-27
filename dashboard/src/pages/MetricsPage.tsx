/**
 * pages/MetricsPage.tsx — Aggregated metrics dashboard with charts and breakdown.
 * Issue #2087: Metrics aggregation dashboard.
 */

import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Clock, DollarSign, CheckCircle, AlertTriangle, Download } from 'lucide-react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { getMetricsAggregate, type AggregateMetricsResponse } from '../api/client';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/formatNumber';
import { formatDateShort } from '../utils/formatDate';
import { downloadCSV } from '../utils/csv-export';

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

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 shadow-xl">
      <p className="mb-2 text-xs font-medium text-[var(--color-text-primary)]">{label}</p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center justify-between gap-3 text-xs">
          <span className="text-[var(--color-text-muted)]">{entry.name}:</span>
          <span className="font-mono font-medium text-[var(--color-text-primary)]">
            {entry.name.toLowerCase().includes('cost') ? formatCurrency(entry.value) : entry.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function generateCSV(data: AggregateMetricsResponse): string {
  const headers = ['Timestamp', 'Sessions', 'Messages', 'Tool Calls', 'Token Cost (USD)'];
  const rows = data.timeSeries.map((tp) => [
    tp.timestamp,
    String(tp.sessions),
    String(tp.messages),
    String(tp.toolCalls),
    tp.tokenCostUsd.toFixed(2),
  ]);
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export default function MetricsPage() {
  const [data, setData] = useState<AggregateMetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangePreset>('7d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const sseConnected = useStore((s) => s.sseConnected);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const now = new Date();
      const from = new Date(now.getTime() - RANGE_MS[range]).toISOString();
      const result = await getMetricsAggregate({ from, to: now.toISOString(), groupBy: granularity });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
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
    <div className="flex flex-col gap-6" role="main" aria-label="Metrics">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-[var(--color-accent-cyan)]" />
        <div>
          <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">Metrics</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Aggregated usage analytics across sessions
            {sseConnected && (
              <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-[var(--color-success)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                Live
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {/* Range selector */}
          {(['7d', '30d', '90d'] as RangePreset[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                range === r
                  ? 'bg-[var(--color-accent-cyan)] text-[var(--color-void-dark)]'
                  : 'bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : '90 Days'}
            </button>
          ))}

          <span className="mx-2 h-4 w-px bg-[var(--color-border-strong)]" />

          {/* Granularity selector */}
          {(['day', 'hour', 'key'] as Granularity[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
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
          className="flex items-center gap-1.5 rounded-md bg-[var(--color-surface-strong)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300" role="alert">
          {error}
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
            {summary?.totalSessions.toLocaleString() ?? '—'}
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
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4" aria-label="Anomalous sessions">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-500 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-amber-200">
                Anomalous Sessions ({data.anomalies?.length})
              </h4>
              <p className="mt-1 text-xs text-amber-300/80">
                Sessions flagged for token cost exceeding p95 by 3x or more.
              </p>
              <div className="mt-2 space-y-1">
                {data.anomalies.map((a) => (
                  <div key={a.sessionId} className="flex items-center gap-2 text-xs">
                    <span className="inline-flex rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-amber-200">
                      {a.sessionId.slice(0, 12)}
                    </span>
                    <span className="text-amber-300/80">
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
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.timeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-void-lighter)" />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={formatDateShort}
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                  stroke="var(--color-void-lighter)"
                />
                <YAxis
                  yAxisId="sessions"
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                  stroke="var(--color-void-lighter)"
                />
                <YAxis
                  yAxisId="cost"
                  orientation="right"
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                  stroke="var(--color-void-lighter)"
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar
                  yAxisId="sessions"
                  dataKey="sessions"
                  name="Sessions"
                  fill="var(--color-accent-cyan)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Cost trend line chart */}
      {data && granularity !== 'key' && data.timeSeries.length > 0 && (
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
          <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
            Token Cost Trend
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.timeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-void-lighter)" />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={formatDateShort}
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                  stroke="var(--color-void-lighter)"
                />
                <YAxis
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                  stroke="var(--color-void-lighter)"
                />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="tokenCostUsd"
                  name="Token Cost"
                  stroke="var(--color-accent-purple)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* By-key breakdown table */}
      {data && data.byKey.length > 0 && (
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
          <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
            Breakdown by API Key
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Metrics breakdown by API key">
              <thead>
                <tr className="border-b border-[var(--color-border-strong)]">
                  <th className="pb-2 text-left text-xs font-medium text-[var(--color-text-muted)]">Key Name</th>
                  <th className="pb-2 text-right text-xs font-medium text-[var(--color-text-muted)]">Sessions</th>
                  <th className="pb-2 text-right text-xs font-medium text-[var(--color-text-muted)]">Messages</th>
                  <th className="pb-2 text-right text-xs font-medium text-[var(--color-text-muted)]">Tool Calls</th>
                  <th className="pb-2 text-right text-xs font-medium text-[var(--color-text-muted)]">Token Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.byKey.map((row) => (
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
      {data && data.summary.totalSessions === 0 && (
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
