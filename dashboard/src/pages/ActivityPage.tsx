/**
 * pages/ActivityPage.tsx — Live audit stream and operational metrics.
 */

import MetricCards from '../components/overview/MetricCards';
import LiveAuditStream from '../components/LiveAuditStream';
import LiveStatusIndicator from '../components/shared/LiveStatusIndicator';
import { ClaudeSessionsPanel } from '../components/shared/ClaudeSessionsPanel';
import { ErrorBoundary } from '../components/shared/ErrorBoundary';
import { useT } from '../i18n/context';

export default function ActivityPage() {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Live Activity</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)] flex items-center gap-2">
            {t('activity.subtitle')}
            <LiveStatusIndicator />
          </p>
        </div>
      </div>

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
