/**
 * pages/SessionsPage.tsx — Combined Sessions page with Active and All tabs.
 * - Active tab: live polling of running sessions (SessionTable)
 * - All tab: full session history (SessionHistoryPage content)
 * URL state: ?tab=active (default) | ?tab=all
 */

import { useSearchParams } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import SessionTable from '../components/overview/SessionTable';

const SessionHistoryPage = lazy(() => import('./SessionHistoryPage'));

type Tab = 'active' | 'all';

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-accent-cyan)]" />
    </div>
  );
}

export default function SessionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = (searchParams.get('tab') as Tab) === 'all' ? 'all' : 'active';

  function setTab(t: Tab) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', t);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Sessions</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          Monitor active agents and browse session history.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-white/5" role="tablist" aria-label="Session views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'active'}
          aria-controls="tab-panel-active"
          onClick={() => setTab('active')}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === 'active'
              ? 'border-[var(--color-accent-cyan)] text-[var(--color-accent-cyan)]'
              : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-400'
          }`}
        >
          Active
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'all'}
          aria-controls="tab-panel-all"
          onClick={() => setTab('all')}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === 'all'
              ? 'border-[var(--color-accent-cyan)] text-[var(--color-accent-cyan)]'
              : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-400'
          }`}
        >
          All
        </button>
      </div>

      {/* Tab panels */}
      {tab === 'active' ? (
        <div id="tab-panel-active" role="tabpanel" aria-label="Active sessions">
          <SessionTable />
        </div>
      ) : (
        <div id="tab-panel-all" role="tabpanel" aria-label="All sessions">
          <Suspense fallback={<LoadingFallback />}>
            <SessionHistoryPage />
          </Suspense>
        </div>
      )}
    </div>
  );
}
