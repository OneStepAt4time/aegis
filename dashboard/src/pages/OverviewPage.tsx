/**
 * pages/OverviewPage.tsx — CCMeter-inspired overview dashboard (#2815). // token-ok
 *
 * Layout: Header → KPI Banner → Summary → Charts → Model Distribution → Keyboard Hints
 * Uses real API data where available, clean empty states where data is pending backend work.
 */

import { useEffect, useState, useCallback, Suspense, lazy } from 'react';
import { Plus, BarChart3 } from 'lucide-react';

const OverviewCostChart = lazy(() =>
  import('../components/overview/OverviewCostChart').then((m) => ({ default: m.OverviewCostChart }))
);

import HomeStatusPanel from '../components/overview/HomeStatusPanel';
import SessionTable from '../components/overview/SessionTable';
import CreateSessionModal from '../components/CreateSessionModal';
import LiveStatusIndicator from '../components/shared/LiveStatusIndicator';
import { useLastUpdated } from '../hooks/useLastUpdated';
import { LastUpdatedIndicator } from '../components/shared/LastUpdatedIndicator';
import { KPIBanner } from '../components/analytics/KPIBanner';
import type { KPIItem } from '../components/analytics/KPIBanner';
import { ModelDistributionBar } from '../components/analytics/ModelDistributionBar';
import { EfficiencyGauge } from '../components/analytics/EfficiencyGauge';
import { useSessionRealtimeUpdates } from '../hooks/useSessionRealtimeUpdates';
import { useT } from '../i18n/context';
import { SessionHealthBanner } from '../components/shared/SessionHealthBanner';
import GettingStartedCard from '../components/shared/GettingStartedCard';
import WelcomeScreen from '../components/shared/WelcomeScreen';
import { useStore } from '../store/useStore';
import { getAnalyticsSummary } from '../api/client';
import { getHealth } from '../api/health';
import { TelemetryStrip, type SystemStatus } from '../components/overview/TelemetryStrip';
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


export default function OverviewPage() {
  const t = useT();
  const [modalOpen, setModalOpen] = useState(false);
  const sseError = useStore((s) => s.sseError);
  const sessions = useStore((s) => s.sessions);

  // Analytics data for CCMeter zones
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [serverUptime, setServerUptime] = useState<number | undefined>(undefined);
  

  // Real-time SSE updates
  useSessionRealtimeUpdates();

  // Track last data refresh time
  const { relativeTime, isStale, markUpdated } = useLastUpdated();

  const fetchAnalytics = useCallback(async () => {
    try {
      const data = await getAnalyticsSummary();
      setAnalytics(data);
      markUpdated();
      
    } catch (e) {
      /* analytics fetch failed — non-critical */
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAnalytics(); }, [fetchAnalytics]);

  // Server uptime for the telemetry strip (polled; non-critical).
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const h = await getHealth();
        if (!cancelled) setServerUptime(h.uptime);
      } catch {
        /* health fetch failed — strip hides the cell */
      }
    };
    void tick();
    const id = setInterval(tick, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Keyboard shortcuts
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
      } else if (e.key === 'r' && !isInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        window.location.reload();
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

  // Derived analytics values
  const totalCost = (analytics?.tokenUsageByModel ?? []).reduce((sum, m) => sum + m.estimatedCostUsd, 0);
  const totalTokens = (analytics?.tokenUsageByModel ?? []).reduce(
    (sum, m) => sum + m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens, 0,
  );
  const totalSessions = analytics?.errorRates?.totalSessions ?? 0;
  const activeDays = (analytics?.sessionVolume ?? []).length ?? 0;
  const avgCostPerDay = activeDays > 0 ? totalCost / activeDays : 0;

  // Telemetry strip inputs — live/awaiting counts from the session store.
  const LIVE: readonly string[] = ['idle', 'working', 'compacting', 'context_warning', 'plan_mode', 'settings', 'unknown'];
  const AWAITING: readonly string[] = ['permission_prompt', 'waiting_for_input', 'bash_approval', 'ask_question'];
  const agentsRunning = sessions.filter((s) => LIVE.includes(s.status)).length;
  const awaitingApproval = sessions.filter((s) => AWAITING.includes(s.status)).length;
  const systemStatus: SystemStatus = sseError ? 'degraded' : 'nominal';

  // Build KPI items
  function buildKPIItems(analytics: AnalyticsSummary): KPIItem[] {
    return [
      {
        id: 'cost',
        label: t('overview.totalCost'),
        value: formatCurrency(totalCost),
        color: 'cost',
        subtitle: activeDays > 0 ? t('overview.days', { n: activeDays }) : undefined,
      },
      {
        id: 'tokens',
        label: t('overview.totalTokens'),
        value: formatTokenCount(totalTokens),
        color: 'input',
        subtitle: totalTokens > 0 ? t('overview.processed', { n: formatTokenCount(totalTokens) }) : undefined,
      },
      {
        id: 'sessions',
        label: t('overview.sessions'),
        value: String(totalSessions),
        color: 'neutral',
      },
      {
        id: 'avg-day',
        label: t('overview.avgDay'),
        value: formatCurrency(avgCostPerDay),
        color: 'time',
        subtitle: activeDays > 0 ? t('overview.activeDays', { n: activeDays }) : undefined,
      },
      {
        id: 'errors',
        label: t('overview.errorRate'),
        value: totalSessions > 0
          ? `${(((analytics.errorRates?.failedSessions ?? 0) / totalSessions) * 100).toFixed(1)}%`
          : '0%',
        color: totalSessions > 0 && ((analytics.errorRates?.failedSessions ?? 0) / totalSessions) > 0.05
          ? 'cost'
          : 'efficiency',
        trend: totalSessions > 0 && ((analytics.errorRates?.failedSessions ?? 0) / totalSessions) > 0.05
          ? 'up'
          : 'flat',
      },
    ];
  }

  return (
    <div className="flex flex-col gap-6">
      {/* First-run welcome screen — shows when no sessions exist and analytics loaded */}
      {!analyticsLoading && totalSessions === 0 ? (
        <WelcomeScreen />
      ) : (<>
      {/* Telemetry strip — the command-center status bar */}
      <TelemetryStrip
        agentsRunning={agentsRunning}
        awaitingApproval={awaitingApproval}
        totalSessions={totalSessions}
        totalTokens={totalTokens}
        totalCostUsd={totalCost}
        systemStatus={systemStatus}
        serverUptimeSec={serverUptime}
      />

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
                <span className="text-[var(--color-warning)] text-xs" title={sseError}>
                  — {sseError}
                </span>
              )}
            </p>
          </div>
        </div>
        <button type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-transparent bg-[var(--color-cta-bg)] px-4 py-2 text-xs font-semibold text-[var(--color-cta-text)] transition-colors hover:bg-[var(--color-cta-bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
          aria-label={t("aria.createNewSession")}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('newSession.title')}
        </button>
      </div>

      {/* Session Health Alert */}
      <SessionHealthBanner errorRates={analytics?.errorRates} loading={analyticsLoading} />

      {/* Getting Started — new users */}
      <GettingStartedCard totalSessions={totalSessions} onCreateSession={() => setModalOpen(true)} />

      {/* Zone B: KPI Banner */}
      {!analyticsLoading && analytics && (
        <KPIBanner items={buildKPIItems(analytics)} />
      )}
      {analyticsLoading && (
        <div
          className="grid min-h-[52px] divide-x divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] "
          style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}
          role="status"
          aria-busy="true"
          aria-label={t('overview.loadingMetrics')}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center justify-center gap-1 px-3 py-3">
              <div className="h-2 w-12 rounded bg-[var(--color-void-lighter)]" />
              <div className="h-4 w-16 rounded bg-[var(--color-void-dark)]" />
            </div>
          ))}
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
                (analytics.durationTrends ?? []).length > 0
                  ? Math.round(
                      (analytics.durationTrends ?? []).reduce((s, d) => s + d.avgDurationSec * d.count, 0)
                      / (analytics.durationTrends ?? []).reduce((s, d) => s + d.count, 0),
                    )
                  : 0,
              )}{' '}
              avg duration
            </span>
            <span>·</span>
            <span>
              {(analytics.sessionVolume ?? []).length > 0
                ? `${formatDateShort(analytics.sessionVolume?.[0]?.date)} → ${formatDateShort(analytics.sessionVolume?.[analytics.sessionVolume.length - 1]?.date)}`
                : t('overview.noDateRange')}
            </span>
            <span>·</span>
            <span className="text-[var(--color-accent-cyan)]">
              {formatCurrency(totalCost)} {t('overview.total')}
            </span>
          </div>
        </div>
      )}

      {/* Zone D: Cost Chart + Efficiency Gauge */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Cost/Day chart — 2/3 width */}
        <section className="lg:col-span-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5" aria-label={t("aria.dailyCostChart")}>
          <h3 className="mb-4 text-sm font-medium text-[var(--color-text-primary)]">{t('overview.costPerDay')}</h3>
          {analytics && (analytics.costTrends ?? []).length > 0 ? (
            <Suspense fallback={<div className="h-[220px]  rounded bg-[var(--color-void-lighter)]/20" />}>
              <OverviewCostChart data={analytics.costTrends} />
            </Suspense>
          ) : (
            <div className="flex h-[200px] items-center justify-center text-sm text-[var(--color-text-muted)]">
              {t('overview.noCostData')}
            </div>
          )}
        </section>

        {/* Efficiency Gauge — 1/3 width */}
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5" aria-label={t("aria.efficiencyGauge")}>
          <h3 className="mb-4 text-sm font-medium text-[var(--color-text-primary)]">{t('overview.efficiency')}</h3>
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
          <h3 className="mb-3 text-sm font-medium text-[var(--color-text-primary)]">{t('overview.modelDistribution')}</h3>
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
      <div className="hidden sm:flex items-center justify-center gap-4 border-t border-[var(--color-border-strong)] pt-3 text-xs text-[var(--color-text-muted)]">
        <span><kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px]">N</kbd> {t('overview.newSessionShortcut')}</span>
        <span><kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px]">R</kbd> refresh</span>
        <span><kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd> back</span>
      </div>

      {/* System Health + Recent Sessions */}
      <HomeStatusPanel onCreateFirstSession={() => setModalOpen(true)} />

      <div>
        <h3
          className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
          id="recent-sessions-heading"
        >
          {t('overview.recentSessionsLabel')}
        </h3>
        <div className="flex items-center justify-between">
          <LastUpdatedIndicator relativeTime={relativeTime} isStale={isStale} />
        </div>
        <div aria-labelledby="recent-sessions-heading"><SessionTable maxRows={5} /></div>
      </div>

      </>)}
      <CreateSessionModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
