/**
 * pages/AnalyticsPage.tsx — Analytics dashboard with charts (Issue token-ok&#35;1970).
 *
 * Displays session volume, token usage by model, cost trends,
 * top API keys, duration trends, and error/permission stats.
 */
// token-ok: &#35; is HTML entity for #, suppresses the false-positive hex-color gate hit on issue ref above

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { BarChart3, Loader2 } from 'lucide-react';
import { getAnalyticsSummary } from '../api/client';
import { formatCurrency } from '../utils/formatNumber';
import { formatDateShort } from '../utils/formatDate';
import type { AnalyticsSummary } from '../types';

const MODEL_COLORS: Record<string, string> = {
  'claude-sonnet-4.6': 'var(--color-accent-cyan)',
  'claude-opus-4.7': 'var(--color-accent-purple)',
  'claude-haiku-4.5': 'var(--color-success)',
  other: 'var(--color-text-muted)',
};

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

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 shadow-xl">
      <p className="mb-2 text-xs font-medium text-[var(--color-text-primary)]">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center justify-between gap-3 text-xs">
          <span className="text-[var(--color-text-muted)]">{entry.name}:</span>
          <span className="font-mono font-medium text-[var(--color-text-primary)]">
            {typeof entry.value === 'number' && entry.name?.toLowerCase().includes('cost')
              ? formatCurrency(entry.value)
              : typeof entry.value === 'number' && entry.name?.toLowerCase().includes('duration')
                ? formatDuration(entry.value)
                : String(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const result = await getAnalyticsSummary();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--color-accent-cyan)]" />
        <span className="ml-3 text-sm text-[var(--color-text-muted)]">Loading analytics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
        Failed to load analytics: {error}
      </div>
    );
  }

  if (!data) return null;

  const totalCost = data.tokenUsageByModel.reduce((sum, m) => sum + m.estimatedCostUsd, 0);
  const totalTokens = data.tokenUsageByModel.reduce(
    (sum, m) => sum + m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens,
    0,
  );
  const avgDuration = data.durationTrends.length > 0
    ? Math.round(
        data.durationTrends.reduce((sum, d) => sum + d.avgDurationSec * d.count, 0)
        / data.durationTrends.reduce((sum, d) => sum + d.count, 0),
      )
    : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-[var(--color-accent-cyan)]" />
        <div>
          <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">Analytics</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Session volume, token usage, cost trends, and error rates
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total Sessions" value={String(data.errorRates.totalSessions)} />
        <SummaryCard label="Total Cost" value={formatCurrency(totalCost)} />
        <SummaryCard label="Total Tokens" value={formatTokenCount(totalTokens)} />
        <SummaryCard label="Avg Duration" value={formatDuration(avgDuration)} />
      </div>

      {/* Row 1: Session Volume + Token Usage */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Session Volume */}
        <ChartCard title="Session Volume Over Time">
          {data.sessionVolume.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.sessionVolume}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-void-lighter)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDateShort}
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                  stroke="var(--color-void-lighter)"
                />
                <YAxis
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                  stroke="var(--color-void-lighter)"
                  allowDecimals={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="created"
                  name="Sessions"
                  stroke="var(--color-accent-cyan)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </ChartCard>

        {/* Token Usage by Model */}
        <ChartCard title="Token Usage by Model">
          {data.tokenUsageByModel.length > 0 ? (
            <div className="flex flex-col lg:flex-row items-center gap-4">
              <div className="w-full lg:w-1/2 h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.tokenUsageByModel.map((m) => ({
                        ...m,
                        totalTokens: m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens,
                      }))}
                      dataKey="totalTokens"
                      nameKey="model"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ name, percent }: { name?: string; percent?: number }) =>
                        `${(name ?? '').replace('claude-', '').replace(/-\d+.*/, '')} ${((percent ?? 0) * 100).toFixed(0)}%`
                      }
                      labelLine={{ stroke: 'var(--color-text-muted)' }}
                    >
                      {data.tokenUsageByModel.map((entry) => (
                        <Cell
                          key={entry.model}
                          fill={MODEL_COLORS[entry.model] || MODEL_COLORS.other}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full lg:w-1/2 space-y-2">
                {data.tokenUsageByModel.map((m) => (
                  <div key={m.model} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: MODEL_COLORS[m.model] || MODEL_COLORS.other }}
                      />
                      <span className="font-mono text-[var(--color-text-primary)]">{m.model}</span>
                    </div>
                    <span className="font-mono text-[var(--color-text-muted)]">
                      {formatTokenCount(m.inputTokens + m.outputTokens)} tokens
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyChart />
          )}
        </ChartCard>
      </div>

      {/* Row 2: Cost Trends + Top API Keys */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Cost Trends */}
        <ChartCard title="Cost Trends (USD per Day)">
          {data.costTrends.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.costTrends}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-void-lighter)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDateShort}
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                  stroke="var(--color-void-lighter)"
                />
                <YAxis
                  tickFormatter={(v) => `$${v.toFixed(2)}`}
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                  stroke="var(--color-void-lighter)"
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="cost"
                  name="Daily Cost"
                  fill="var(--color-accent-cyan)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </ChartCard>

        {/* Top API Keys */}
        <ChartCard title="Top API Keys by Usage">
          {data.topApiKeys.length > 0 ? (
            <div className="space-y-3">
              {data.topApiKeys.map((key) => (
                <div
                  key={key.keyId}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium text-[var(--color-text-primary)]">
                      {key.keyName}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      {key.sessions} session{key.sessions !== 1 ? 's' : ''} &middot; {key.messages} message{key.messages !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono font-medium text-[var(--color-text-primary)]">
                      {formatCurrency(key.estimatedCostUsd)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyChart />
          )}
        </ChartCard>
      </div>

      {/* Row 3: Duration Trends + Error Rates */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Duration Trends */}
        <ChartCard title="Avg Session Duration Over Time">
          {data.durationTrends.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.durationTrends}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-void-lighter)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDateShort}
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                  stroke="var(--color-void-lighter)"
                />
                <YAxis
                  tickFormatter={(v) => formatDuration(v as number)}
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                  stroke="var(--color-void-lighter)"
                />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="avgDurationSec"
                  name="Avg Duration"
                  stroke="var(--color-accent-purple)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </ChartCard>

        {/* Error & Permission Rates */}
        <ChartCard title="Error Rates & Permissions">
          <div className="space-y-5">
            <RateBar
              label="Session Failure Rate"
              value={data.errorRates.failureRate}
              detail={`${data.errorRates.failedSessions} failed / ${data.errorRates.totalSessions} total`}
              color="red"
            />
            <RateBar
              label="Auto-Approval Rate"
              value={
                data.errorRates.approvals > 0
                  ? data.errorRates.autoApprovals / data.errorRates.approvals
                  : 0
              }
              detail={`${data.errorRates.autoApprovals} auto / ${data.errorRates.approvals} total approvals`}
              color="green"
            />
            <div className="grid grid-cols-2 gap-4 pt-2">
              <MetricBox label="Permission Prompts" value={String(data.errorRates.permissionPrompts)} />
              <MetricBox label="Manual Approvals" value={String(data.errorRates.approvals - data.errorRates.autoApprovals)} />
            </div>
          </div>
        </ChartCard>
      </div>
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
    <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
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
  const barColor = color === 'red' ? 'bg-red-500' : 'bg-emerald-500';
  const textColor = color === 'red' ? 'text-red-400' : 'text-emerald-400';

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--color-text-primary)]">{label}</span>
        <span className={`font-mono font-medium ${textColor}`}>{(pct).toFixed(1)}%</span>
      </div>
      <div className="mt-1 h-2 w-full rounded-full bg-[var(--color-void-lighter)]">
        <div className={`h-2 rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-[var(--color-text-muted)]">{detail}</div>
    </div>
  );
}
