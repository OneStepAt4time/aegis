/**
 * pages/OverviewPage.tsx — Dashboard home with system health, onboarding, and live activity.
 */

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import HomeStatusPanel from '../components/overview/HomeStatusPanel';
import MetricCards from '../components/overview/MetricCards';
import MetricsPanel from '../components/overview/MetricsPanel';
import SessionTable from '../components/overview/SessionTable';
import LiveAuditStream from '../components/LiveAuditStream';
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

  // Wire up the CTA button in the empty state
  useEffect(() => {
    const handler = () => setModalOpen(true);
    window.addEventListener('aegis:create-session', handler);
    return () => window.removeEventListener('aegis:create-session', handler);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Overview</h2>
          <p className="mt-1 text-sm text-slate-400 flex items-center gap-2">
            System health, live audit stream, and fast session controls.
            <LiveStatusIndicator />
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-300 transition-all hover:bg-cyan-500/20 hover:border-cyan-500/50 hover:shadow-[0_0_12px_rgba(6,182,212,0.2)]"
        >
          <Plus className="h-3.5 w-3.5" />
          New Session
        </button>
      </div>

      <HomeStatusPanel onCreateFirstSession={() => setModalOpen(true)} />

      {/* 3:1 split-pane — Command Deck + Live Audit Stream */}
      <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,3fr)_280px]">
        {/* ─── Left: Command Deck (75%) ─── */}
        <div className="min-w-0 flex flex-col gap-6 xl:pr-6">
          <div>
            <h3 className="mb-3 text-base font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
              Sessions
            </h3>
            <SessionTable />
          </div>

          <MetricsPanel />
          <MetricCards />
        </div>

        {/* ─── Right: Live Audit Stream (25%) ─── */}
        {/* Glassmorphic side rail — no box, pinned to page height */}
        <div className="hidden xl:flex xl:flex-col xl:relative">
          {/* The glass rail — subtle, runs full height */}
          <div
            className="sticky top-0 flex flex-col h-[calc(100vh-140px)] pl-6 border-l border-white/[0.06]"
            style={{
              background: 'linear-gradient(to bottom, rgba(2,6,23,0.0) 0%, rgba(2,6,23,0.02) 100%)',
            }}
          >
            <LiveAuditStream maxItems={30} />
          </div>
        </div>
      </div>

      <CreateSessionModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
