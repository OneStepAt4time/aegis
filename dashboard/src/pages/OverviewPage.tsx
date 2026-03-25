/**
 * pages/OverviewPage.tsx — Main overview with metrics and session table.
 */

import MetricCards from '../components/overview/MetricCards';
import SessionTable from '../components/overview/SessionTable';

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-100">Overview</h2>
        <p className="mt-1 text-sm text-gray-500">
          Aegis session monitoring and metrics
        </p>
      </div>

      <MetricCards />

      <div>
        <h3 className="mb-3 text-lg font-semibold text-gray-200">Sessions</h3>
        <SessionTable />
      </div>
    </div>
  );
}
