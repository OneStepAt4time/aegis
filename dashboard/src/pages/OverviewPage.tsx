/**
 * pages/OverviewPage.tsx — Main overview with metrics, session table, and activity stream.
 */

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Overview</h2>
          <p className="mt-1 text-sm text-gray-500">
            Aegis session monitoring and metrics
          <LiveStatusIndicator />
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded bg-[var(--color-accent-cyan)]]/10 hover:bg-[var(--color-accent-cyan)]]/20 text-[var(--color-accent-cyan)]] border border-[var(--color-accent-cyan)]]/30 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Session
        </button>
      </div>

      <MetricsPanel />

      <MetricCards />

      <div>
        <h3 className="mb-3 text-lg font-semibold text-gray-200">Sessions</h3>
        <SessionTable />
      </div>

      <ActivityStream />

      <CreateSessionModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
