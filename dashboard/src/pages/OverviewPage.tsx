/**
 * pages/OverviewPage.tsx — Main overview with metrics, session table, and activity stream.
 */

import { useState } from 'react';
import { Plus } from 'lucide-react';
import MetricCards from '../components/overview/MetricCards';
import MetricsPanel from '../components/overview/MetricsPanel';
import SessionTable from '../components/overview/SessionTable';
import ActivityStream from '../components/ActivityStream';
import CreateSessionModal from '../components/CreateSessionModal';

export default function OverviewPage() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Overview</h2>
          <p className="mt-1 text-sm text-gray-500">
            Aegis session monitoring and metrics
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded bg-[#00e5ff]/10 hover:bg-[#00e5ff]/20 text-[#00e5ff] border border-[#00e5ff]/30 transition-colors"
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
