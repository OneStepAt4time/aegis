/**
<<<<<<< HEAD
 * pages/OverviewPage.tsx — Dashboard home with system health, top sessions, and quick actions.
 */

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
=======
 * pages/OverviewPage.tsx — CCMeter-inspired overview dashboard (#2815).
 *
 * Layout: Header → KPI Banner → Summary → Charts → Model Distribution → Keyboard Hints
 * Uses real API data where available, clean empty states where data is pending backend work.
 */

import { useEffect, useState, useCallback } from 'react';
import { Plus, Loader2, BarChart3 } from 'lucide-react';
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
>>>>>>> docs/changelog-may-7
import HomeStatusPanel from '../components/overview/HomeStatusPanel';
import SessionTable from '../components/overview/SessionTable';
import CreateSessionModal from '../components/CreateSessionModal';
import LiveStatusIndicator from '../components/shared/LiveStatusIndicator';
<<<<<<< HEAD
import { useSessionRealtimeUpdates } from '../hooks/useSessionRealtimeUpdates';
import { useT } from '../i18n/context';
import { useStore } from '../store/useStore';
=======
import { KPIBanner } from '../components/analytics/KPIBanner';
import type { KPIItem } from '../components/analytics/KPIBanner';
import { ModelDistributionBar } from '../components/analytics/ModelDistributionBar';
import { EfficiencyGauge } from '../components/analytics/EfficiencyGauge';
import { useSessionRealtimeUpdates } from '../hooks/useSessionRealtimeUpdates';
import { useT } from '../i18n/context';
import { useStore } from '../store/useStore';
import { getAnalyticsSummary } from '../api/client';
import { formatCurrency, formatNumber } from '../utils/formatNumber';
import { formatDateShort } from '../utils/formatDate';
import type { AnalyticsSummary } from '../types';

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

/** Chart tooltip matching the CCMeter terminal aesthetic. */
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
              : String(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
>>>>>>> docs/changelog-may-7

export default function OverviewPage() {
  const t = useT();
  const [modalOpen, setModalOpen] = useState(false);
  const sseError = useStore((s) => s.sseError);

<<<<<<< HEAD
  // #2110: Apply targeted session updates from SSE events in real-time. // token-ok
  useSessionRealtimeUpdates();

  // N key opens new session modal
=======
  // Analytics data for CCMeter zones
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  

  // Real-time SSE updates
  useSessionRealtimeUpdates();

  const fetchAnalytics = useCallback(async () => {
    try {
      const data = await getAnalyticsSummary();
      setAnalytics(data);
      
    } catch (e) {
      /* analytics fetch failed — non-critical */
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAnalytics(); }, [fetchAnalytics]);

  // Keyboard shortcuts
>>>>>>> docs/changelog-may-7
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;
      if (e.key === 'n' && !isInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setModalOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Wire up the CTA button in the empty state
  useEffect(() => {
    const handler = () => setModalOpen(true);
    window.addEventListener('aegis:create-session', handler);
    return () => window.removeEventListener('aegis:create-session', handler);
  }, []);
<<<<<<< HEAD

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("overview.title")}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400 flex items-center gap-2">
            {t("overview.subtitle")}
            <LiveStatusIndicator />
            {sseError && (
              <span className="text-amber-500 text-xs" title={sseError}>
                — {sseError}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-700 dark:text-cyan-300 transition-all hover:bg-cyan-500/20 hover:border-cyan-500/50"
=======

  // Derived analytics values
  const totalCost = analytics?.tokenUsageByModel.reduce((sum, m) => sum + m.estimatedCostUsd, 0) ?? 0;
  const totalTokens = analytics?.tokenUsageByModel.reduce(
    (sum, m) => sum + m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens, 0,
  ) ?? 0;
  const totalSessions = analytics?.errorRates.totalSessions ?? 0;
  const activeDays = analytics?.sessionVolume.length ?? 0;
  const avgCostPerDay = activeDays > 0 ? totalCost / activeDays : 0;

  // Build KPI items
  function buildKPIItems(): KPIItem[] {
    return [
      {
        id: 'cost',
        label: 'Total Cost',
        value: formatCurrency(totalCost),
        color: 'cost',
        subtitle: activeDays > 0 ? `${activeDays} days` : undefined,
      },
      {
        id: 'tokens',
        label: 'Total Tokens',
        value: formatTokenCount(totalTokens),
        color: 'input',
        subtitle: totalTokens > 0 ? `${formatTokenCount(totalTokens)} processed` : undefined,
      },
      {
        id: 'sessions',
        label: 'Sessions',
        value: String(totalSessions),
        color: 'neutral',
      },
      {
        id: 'avg-day',
        label: 'Avg/Day',
        value: formatCurrency(avgCostPerDay),
        color: 'time',
        subtitle: activeDays > 0 ? `${activeDays} active days` : undefined,
      },
      {
        id: 'errors',
        label: 'Error Rate',
        value: totalSessions > 0
          ? `${((analytics!.errorRates.failedSessions / totalSessions) * 100).toFixed(1)}%`
          : '0%',
        color: totalSessions > 0 && (analytics!.errorRates.failedSessions / totalSessions) > 0.05
          ? 'cost'
          : 'efficiency',
        trend: totalSessions > 0 && (analytics!.errorRates.failedSessions / totalSessions) > 0.05
          ? 'up'
          : 'flat',
      },
    ];
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-[var(--color-accent-cyan)]" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('overview.title')}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)] flex items-center gap-2">
              {t('overview.subtitle')}
              <LiveStatusIndicator />
              {sseError && (
                <span className="text-amber-500 text-xs" title={sseError}>
                  — {sseError}
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-4 py-2 text-xs font-semibold text-[var(--color-accent-cyan)] transition-all hover:bg-[var(--color-accent-cyan)]/20 hover:border-[var(--color-accent-cyan)]/50"
          aria-label="Create new session"
>>>>>>> docs/changelog-may-7
        >
          <Plus className="h-3.5 w-3.5" />
          New Session
        </button>
      </div>

<<<<<<< HEAD
      <HomeStatusPanel onCreateFirstSession={() => setModalOpen(true)} />

      {/* Top Sessions */}
      <div>
        <h3 className="mb-3 text-base font-semibold text-gray-500 dark:text-slate-200 uppercase tracking-wider text-[11px]" id="recent-sessions-heading">
          Recent Sessions
        </h3>
        <div aria-labelledby="recent-sessions-heading"><SessionTable maxRows={5} /></div>
      </div>

=======
      {/* Zone A: Heatmap Cards (4-column) — needs daily token breakdown from backend */}
      <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
        <h3 className="mb-3 text-sm font-medium text-[var(--color-text-muted)]">Activity Heatmap</h3>
        <div className="flex h-[60px] items-center justify-center text-xs text-[var(--color-text-muted)]">
          Heatmap requires daily token breakdown — pending backend API
        </div>
      </div>

      {/* Zone B: KPI Banner */}
      {!analyticsLoading && analytics && (
        <KPIBanner items={buildKPIItems()} />
      )}
      {analyticsLoading && (
        <div className="flex items-center justify-center py-4" role="status" aria-busy="true">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent-cyan)]" />
          <span className="ml-2 text-sm text-[var(--color-text-muted)]">Loading metrics…</span>
        </div>
      )}

      {/* Zone C: Summary Panel */}
      {analytics && totalSessions > 0 && (
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-[var(--color-text-muted)]">
            <span className="text-[var(--color-text-primary)]">
              {formatNumber(totalSessions)} sessions
            </span>
            <span>·</span>
            <span>
              {formatDuration(
                analytics.durationTrends.length > 0
                  ? Math.round(
                      analytics.durationTrends.reduce((s, d) => s + d.avgDurationSec * d.count, 0)
                      / analytics.durationTrends.reduce((s, d) => s + d.count, 0),
                    )
                  : 0,
              )}{' '}
              avg duration
            </span>
            <span>·</span>
            <span>
              {analytics.sessionVolume.length > 0
                ? `${formatDateShort(analytics.sessionVolume[0].date)} → ${formatDateShort(analytics.sessionVolume[analytics.sessionVolume.length - 1].date)}`
                : 'No date range'}
            </span>
            <span>·</span>
            <span className="text-[var(--color-accent-cyan)]">
              {formatCurrency(totalCost)} total
            </span>
          </div>
        </div>
      )}

      {/* Zone D: Cost Chart + Efficiency Gauge */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Cost/Day chart — 2/3 width */}
        <section className="lg:col-span-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5" aria-label="Daily cost chart">
          <h3 className="mb-4 text-sm font-medium text-[var(--color-text-primary)]">Cost / Day</h3>
          {analytics && analytics.costTrends.length > 0 ? (
            <ResponsiveContainer width="100%" height={220} minWidth={1} minHeight={1}>
              <BarChart data={analytics.costTrends}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-void-lighter)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDateShort}
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                  stroke="var(--color-void-lighter)"
                />
                <YAxis
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                  stroke="var(--color-void-lighter)"
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="cost" name="Daily Cost" fill="var(--color-accent-cyan)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[200px] items-center justify-center text-sm text-[var(--color-text-muted)]">
              No cost data available yet
            </div>
          )}
        </section>

        {/* Efficiency Gauge — 1/3 width */}
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5" aria-label="Efficiency gauge">
          <h3 className="mb-4 text-sm font-medium text-[var(--color-text-primary)]">Efficiency</h3>
          <EfficiencyGauge
            score={totalTokens > 0 && totalSessions > 0 ? Math.min(100, Math.round((totalTokens / totalSessions) / 100)) : 0}
            unit="tok/session"
            displayValue={totalTokens > 0 && totalSessions > 0 ? formatTokenCount(Math.round(totalTokens / totalSessions)) : '—'}
          />
        </section>
      </div>

      {/* Zone E: Model Distribution Bar */}
      {analytics && analytics.tokenUsageByModel.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
          <h3 className="mb-3 text-sm font-medium text-[var(--color-text-primary)]">Model Distribution</h3>
          <ModelDistributionBar
            segments={analytics.tokenUsageByModel.map((m) => ({
              model: m.model,
              fraction: m.estimatedCostUsd / (totalCost || 1),
            }))}
            barHeight={10}
          />
        </div>
      )}

      {/* Zone F: Keyboard Shortcuts Hint */}
      <div className="flex items-center justify-center gap-4 border-t border-[var(--color-border-strong)] pt-3 text-xs text-[var(--color-text-muted)]">
        <span><kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px]">N</kbd> new session</span>
        <span><kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px]">R</kbd> refresh</span>
        <span><kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd> back</span>
      </div>

      {/* System Health + Recent Sessions */}
      <HomeStatusPanel onCreateFirstSession={() => setModalOpen(true)} />

      <div>
        <h3
          className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
          id="recent-sessions-heading"
        >
          Recent Sessions
        </h3>
        <div aria-labelledby="recent-sessions-heading"><SessionTable maxRows={5} /></div>
      </div>

>>>>>>> docs/changelog-may-7
      <CreateSessionModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
