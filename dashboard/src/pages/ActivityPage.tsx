/**
 * pages/ActivityPage.tsx — Live audit stream and operational metrics.
 */

import MetricCards from '../components/overview/MetricCards';
import LiveAuditStream from '../components/LiveAuditStream';
import LiveStatusIndicator from '../components/shared/LiveStatusIndicator';
import { useT } from '../i18n/context';

export default function ActivityPage() {
  const t = useT();
  return (
    <div className="flex flex-col gap-6" aria-label={t('activity.title')}>
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Live Activity</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400 flex items-center gap-2">
            {t('activity.subtitle')}
            <LiveStatusIndicator />
          </p>
        </div>
      </div>

      {/* 3:1 split-pane — Operational Metrics + Live Audit Stream */}
      <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,3fr)_280px]">
        {/* ─── Left: Operational Metrics (75%) ─── */}
        <div className="min-w-0 flex flex-col gap-6 xl:pr-6">
          <MetricCards />
        </div>

        {/* ─── Right: Live Audit Stream (25%) ─── */}
        {/* Glassmorphic side rail — no box, pinned to page height */}
        <div className="hidden xl:flex xl:flex-col xl:relative">
          {/* The glass rail — subtle, runs full height */}
          <div
            className="sticky top-0 flex flex-col h-[calc(100vh-140px)] pl-6 border-l border-gray-200 dark:border-white/[0.06]"
            style={{ background: 'transparent' }}
          >
            <LiveAuditStream maxItems={30} />
          </div>
        </div>
      </div>
    </div>
  );
}
