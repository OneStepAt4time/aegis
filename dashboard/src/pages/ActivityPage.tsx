/**
 * pages/ActivityPage.tsx — Live audit stream, operational metrics, and activity heatmap.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import MetricCards from '../components/overview/MetricCards';
import LiveAuditStream from '../components/LiveAuditStream';
import LiveStatusIndicator from '../components/shared/LiveStatusIndicator';
import { ClaudeSessionsPanel } from '../components/shared/ClaudeSessionsPanel';
import { ErrorBoundary } from '../components/shared/ErrorBoundary';
import { HeatmapGrid, type HeatmapDataPoint } from '../components/analytics/HeatmapGrid';
import { fetchSessionHistory } from '../api/client';
import { useT } from '../i18n/context';

export default function ActivityPage() {
  const t = useT();
  const [heatmapData, setHeatmapData] = useState<HeatmapDataPoint[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(true);
  const [heatmapError, setHeatmapError] = useState<string | null>(null);

  const fetchHeatmapData = useCallback(async () => {
    setHeatmapError(null);
    try {
      // Fetch last 365 days of session history to build the heatmap
      const oneYearAgo = Math.floor((Date.now() - 365 * 24 * 60 * 60 * 1000) / 1000);
      const result = await fetchSessionHistory({
        createdAfter: oneYearAgo,
        limit: 500,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      // Group sessions by date
      const byDate = new Map<string, number>();
      for (const record of result.records) {
        const ts = record.createdAt ?? record.lastSeenAt;
        const dateStr = new Date(ts * 1000).toISOString().split('T')[0];
        if (dateStr) {
          byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + 1);
        }
      }

      const points: HeatmapDataPoint[] = [];
      for (const [date, count] of byDate) {
        points.push({ date, value: count });
      }
      setHeatmapData(points);
    } catch (err) {
      // Heatmap is non-critical but surface the error for transparency
      setHeatmapError(err instanceof Error ? err.message : 'Failed to load heatmap data');
    } finally {
      setHeatmapLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHeatmapData();
  }, [fetchHeatmapData]);

  const totalActiveDays = useMemo(
    () => heatmapData.filter((d) => d.value > 0).length,
    [heatmapData],
  );
  const totalSessions = useMemo(
    () => heatmapData.reduce((sum, d) => sum + d.value, 0),
    [heatmapData],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('activity.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)] flex items-center gap-2">
            {t('activity.subtitle')}
            <LiveStatusIndicator />
          </p>
        </div>
      </div>

      {/* Activity Heatmap */}
      <section aria-label={t('aria.activityHeatmap')}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-[var(--color-text-muted)]">
            {t('activity.sessionActivity')}
          </h2>
          {!heatmapLoading && heatmapData.length > 0 && (
            <span className="text-xs text-[var(--color-text-muted)]">
              {t('activity.sessionsAcross', { sessions: totalSessions, days: totalActiveDays })}
            </span>
          )}
        </div>
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          {heatmapLoading ? (
            <div className="flex h-20 items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
            </div>
          ) : heatmapError ? (
            <div className="flex h-20 flex-col items-center justify-center gap-2">
              <p className="text-sm text-[var(--color-text-muted)]">{heatmapError}</p>
              <button
                type="button"
                onClick={() => { setHeatmapLoading(true); void fetchHeatmapData(); }}
                className="rounded-md border border-[var(--color-void-lighter)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-muted)]"
                aria-label={t('aria.retryLoadingHeatmap')}
              >
                {t('activity.retry')}
              </button>
            </div>
          ) : heatmapData.length > 0 ? (
            <HeatmapGrid
              data={heatmapData}
              color="cyan"
              metricLabel={t('activity.sessionActivity')}
              formatValue={(v) => t(v !== 1 ? 'activity.sessionCount_plural' : 'activity.sessionCount', { count: v })}
            />
          ) : (
            <div className="flex h-20 items-center justify-center text-sm text-[var(--color-text-muted)]">
              {t('activity.noActivity')}
            </div>
          )}
        </div>
      </section>

      {/* 3:1 split-pane — Operational Metrics + Live Audit Stream */}
      <ErrorBoundary>
        <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,3fr)_280px]">
          {/* ─── Left: Operational Metrics (75%) ─── */}
          <div className="min-w-0 flex flex-col gap-6 xl:pr-6">
            <MetricCards />
          </div>

          {/* ─── Right: Side rail (25%) ─── */}
          <div className="hidden xl:flex xl:flex-col xl:relative">
            <div
              className="sticky top-0 flex flex-col h-[calc(100vh-140px)] gap-4 pl-6 border-l border-[var(--color-void-lighter)]"
              style={{ background: 'transparent' }}
            >
              {/* Claude Code Sessions */}
              <ErrorBoundary>
                <ClaudeSessionsPanel />
              </ErrorBoundary>

              {/* Live Audit Stream */}
              <LiveAuditStream maxItems={30} />
            </div>
          </div>
        </div>
      </ErrorBoundary>
    </div>
  );
}
