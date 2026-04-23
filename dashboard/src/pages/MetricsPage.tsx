/**
 * pages/MetricsPage.tsx — Metrics aggregation dashboard.
 *
 * Issue #2087: displays team-level usage metrics from GET /v1/metrics.
 * Time-series chart and by-key breakdown require GET /v1/metrics/aggregate
 * (backend, separate issue). This page shows summary cards + current metrics
 * with a DateRangePicker wired up for when the aggregate endpoint is ready.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle, Clock, RefreshCw, TrendingUp, XCircle, Zap } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import DateRangePicker, { type DateRange } from '../components/DateRangePicker';
import type { GlobalMetrics } from '../types';

function StatCard({
  label,
  value,
  subValue,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  subValue?: string;
  icon: React.ElementType;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            {label}
          </p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--color-text-primary)]">
            {value}
          </p>
          {subValue && (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{subValue}</p>
          )}
        </div>
        <div
          className={`rounded-lg p-2.5 ${accent ?? 'bg-[var(--color-accent-cyan)]/10'}`}
        >
          <Icon className={`h-5 w-5 ${accent ? '' : 'text-[var(--color-accent-cyan)]'}`}
            style={accent ? { color: accent } : undefined} />
        </div>
      </div>
    </div>
  );
}

function percentOf(part: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function getDefaultRange(): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default function MetricsPage() {
  const token = useAuthStore((s) => s.token);
  const [metrics, setMetrics] = useState<GlobalMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultRange);
  const abortRef = useRef<AbortController | null>(null);

  const fetchMetrics = useCallback(async (signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/v1/metrics', {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data: GlobalMetrics = await res.json();
      setMetrics(data);
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return;
      setError((err as Error).message ?? 'Failed to load metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    abortRef.current = new AbortController();
    void fetchMetrics(abortRef.current.signal);
    return () => abortRef.current?.abort();
  }, [fetchMetrics]);

  function handleRangeChange(range: DateRange) {
    setDateRange(range);
    // When the aggregate endpoint is ready, fetch with ?from=&to= here.
    // For now, the current metrics endpoint returns live data regardless of range.
  }

  const sessionsTotal = metrics?.sessions.total_created ?? 0;
  const sessionsCompleted = metrics?.sessions.completed ?? 0;
  const sessionsFailed = metrics?.sessions.failed ?? 0;
  const completionRate = percentOf(sessionsCompleted, sessionsTotal);

  const promptsTotal = (metrics?.prompt_delivery.sent ?? 0);
  const promptsDelivered = (metrics?.prompt_delivery.delivered ?? 0);
  const promptSuccessRate = metrics?.prompt_delivery.success_rate;

  const avgDuration = metrics?.sessions.avg_duration_sec ?? 0;
  const avgDurationMin = avgDuration > 0 ? (avgDuration / 60).toFixed(1) : '—';

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">Metrics</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Team-level usage and performance overview.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker value={dateRange} onChange={handleRangeChange} />
          <button
            type="button"
            onClick={() => { void fetchMetrics(undefined, true); }}
            disabled={refreshing}
            aria-label="Refresh metrics"
            className="flex min-h-[36px] items-center justify-center gap-2 rounded border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-[var(--color-accent-cyan)]/40 hover:text-[var(--color-accent-cyan)] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-8 text-center">
          <p className="font-medium text-rose-400">Failed to load metrics</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{error}</p>
          <button
            onClick={() => { void fetchMetrics(); }}
            className="mt-4 rounded border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-medium text-rose-400 transition-colors hover:bg-rose-500/20"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <div className="h-4 w-20 animate-pulse rounded bg-[var(--color-border)]" />
              <div className="mt-2 h-8 w-16 animate-pulse rounded bg-[var(--color-border)]" />
            </div>
          ))}
        </div>
      ) : metrics ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Sessions Created"
              value={sessionsTotal.toLocaleString()}
              subValue={`${metrics.sessions.currently_active} active now`}
              icon={Activity}
            />
            <StatCard
              label="Avg Duration"
              value={avgDurationMin}
              subValue="minutes per session"
              icon={Clock}
            />
            <StatCard
              label="Completion Rate"
              value={completionRate}
              subValue={`${sessionsCompleted} done · ${sessionsFailed} failed`}
              icon={CheckCircle}
              accent="var(--color-accent-emerald)"
            />
            <StatCard
              label="Prompt Delivery"
              value={promptSuccessRate != null ? `${Math.round(promptSuccessRate * 100)}%` : '—'}
              subValue={`${promptsDelivered} / ${promptsTotal} delivered`}
              icon={TrendingUp}
              accent="var(--color-accent-amber)"
            />
          </div>

          {/* Secondary stats */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard
              label="Auto-approvals"
              value={metrics.auto_approvals.toLocaleString()}
              icon={Zap}
              accent="var(--color-accent-violet)"
            />
            <StatCard
              label="Webhooks Sent"
              value={metrics.webhooks_sent.toLocaleString()}
              subValue={metrics.webhooks_failed > 0 ? `${metrics.webhooks_failed} failed` : undefined}
              icon={Zap}
              accent={metrics.webhooks_failed > 0 ? 'var(--color-accent-amber)' : undefined}
            />
            <StatCard
              label="Screenshots"
              value={metrics.screenshots_taken.toLocaleString()}
              icon={Activity}
            />
          </div>

          {/* Pipeline & batch stats */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Pipelines Created"
              value={metrics.pipelines_created.toLocaleString()}
              icon={TrendingUp}
            />
            <StatCard
              label="Batches Created"
              value={metrics.batches_created.toLocaleString()}
              icon={TrendingUp}
            />
            <StatCard
              label="Prompts Failed"
              value={metrics.prompt_delivery.failed.toLocaleString()}
              icon={metrics.prompt_delivery.failed > 0 ? XCircle : CheckCircle}
              accent={metrics.prompt_delivery.failed > 0 ? 'var(--color-accent-rose)' : 'var(--color-accent-emerald)'}
            />
            <StatCard
              label="Up time"
              value={`${Math.round(metrics.uptime / 60)}m`}
              subValue="server uptime"
              icon={Clock}
            />
          </div>

          {/* Coming soon sections */}
          <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
            <div className="mb-6 flex items-center justify-center gap-3">
              <TrendingUp className="h-5 w-5 text-[var(--color-text-muted)]" />
              <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Time-series &amp; By-key Breakdown
              </h3>
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">
              Sessions over time, token cost by API key, and anomaly detection require{' '}
              <code className="rounded bg-[var(--color-void)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-accent-cyan)]">
                GET /v1/metrics/aggregate
              </code>{' '}
              (backend — coordinating with Hephaestus).
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
