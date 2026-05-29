/**
 * pages/SessionsPage.tsx — Combined Sessions page with Active, Board, and All tabs.
 * - Active tab: live polling of running sessions (SessionTable)
 * - Board tab: Kanban board view of sessions by status
 * - All tab: full session history (SessionHistoryPage content)
 * URL state: ?tab=active (default) | ?tab=board | ?tab=all
 */

import { useSearchParams } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import SessionTable from '../components/overview/SessionTable';
const SessionBoard = lazy(() => import('../components/overview/SessionBoard').then(m => ({ default: m.SessionBoard })));
import { SkeletonTable } from '../components/shared/Skeleton';
import { ErrorBoundary } from '../components/shared/ErrorBoundary';
import { useT } from '../i18n/context';

const SessionHistoryPage = lazy(() => import('./SessionHistoryPage'));

type Tab = 'active' | 'board' | 'all';

const TABS: { id: Tab; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'board', label: 'Board' },
  { id: 'all', label: 'All' },
];

export default function SessionsPage() {
  const translate = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = (['active', 'board', 'all'] as Tab[]).includes(searchParams.get('tab') as Tab)
    ? (searchParams.get('tab') as Tab)
    : 'active';

  function setTab(t: Tab) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', t);
      return next;
    });
  }

  const tabClasses = (t: Tab) =>
    `px-4 py-3 min-h-[44px] text-sm font-medium transition-colors border-b-2 -mb-px ${
      tab === t
        ? 'border-[var(--color-accent-cyan)] text-[var(--color-accent-cyan)]'
        : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-void-lighter)]'
    }`;

  return (
    <ErrorBoundary>
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{translate("sessions.title")}</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)] ">
          {translate("sessions.subtitle")}
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-white/5" role="tablist" aria-label={translate("aria.sessionViews")}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`tab-panel-${id}`}
            onClick={() => setTab(id)}
            className={tabClasses(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {tab === 'active' ? (
        <div id="tab-panel-active" role="tabpanel" aria-label={translate("aria.activeSessions")}>
          <SessionTable />
        </div>
      ) : tab === 'board' ? (
        <div id="tab-panel-board" role="tabpanel" aria-label={translate("aria.sessionBoardView")}>
          <Suspense fallback={<SkeletonTable rows={6} />}><SessionBoard /></Suspense>
        </div>
      ) : (
        <div id="tab-panel-all" role="tabpanel" aria-label={translate("aria.allSessions")}>
          <Suspense fallback={<SkeletonTable rows={8} />}>
            <SessionHistoryPage />
          </Suspense>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
