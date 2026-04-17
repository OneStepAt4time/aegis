/**
 * pages/OverviewPage.tsx — Dashboard home with system health, onboarding, and live activity.
 */

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import HomeStatusPanel from '../components/overview/HomeStatusPanel';
import MetricCards from '../components/overview/MetricCards';
import MetricsPanel from '../components/overview/MetricsPanel';
import SessionTable from '../components/overview/SessionTable';
import ActivityStream from '../components/ActivityStream';
import CreateSessionModal from '../components/CreateSessionModal';
import LiveStatusIndicator from '../components/shared/LiveStatusIndicator';

export default function OverviewPage() {
  const [modalOpen, setModalOpen] = useState(false);

  // N key opens new session modal
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Overview</h2>
          <p className="mt-1 text-sm text-gray-500">
            System health, recent events, and a fast path to your first session.{` `}
            <LiveStatusIndicator />
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-500/20"
        >
          <Plus className="h-3.5 w-3.5" />
          New Session
        </button>
      </div>

      <HomeStatusPanel onCreateFirstSession={() => setModalOpen(true)} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <div className="order-2 flex flex-col gap-6 xl:order-1">
          <div>
            <h3 className="mb-3 text-lg font-semibold text-gray-200">Sessions</h3>
            <SessionTable />
          </div>

          <MetricsPanel />

          <MetricCards />
        </div>

        <div className="order-1 xl:order-2">
          <ActivityStream title="Recent events" showFilters={false} maxItems={8} />
        </div>
      </div>

      <CreateSessionModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
