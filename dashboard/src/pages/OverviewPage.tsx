/**
 * pages/OverviewPage.tsx — Dashboard home with system health, top sessions, and quick actions.
 */

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import HomeStatusPanel from '../components/overview/HomeStatusPanel';
import SessionTable from '../components/overview/SessionTable';
import CreateSessionModal from '../components/CreateSessionModal';
import LiveStatusIndicator from '../components/shared/LiveStatusIndicator';
import { useSessionRealtimeUpdates } from '../hooks/useSessionRealtimeUpdates';
import { useStore } from '../store/useStore';

export default function OverviewPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const sseError = useStore((s) => s.sseError);

  // #2110: Apply targeted session updates from SSE events in real-time. // token-ok
  useSessionRealtimeUpdates();

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
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Overview</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400 flex items-center gap-2">
            System health and session controls.
            <LiveStatusIndicator />
            {sseError && (
              <span className="text-amber-500 text-xs" title={sseError}>
                — {sseError}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-700 dark:text-cyan-300 transition-all hover:bg-cyan-500/20 hover:border-cyan-500/50"
        >
          <Plus className="h-3.5 w-3.5" />
          New Session
        </button>
      </div>

      <HomeStatusPanel onCreateFirstSession={() => setModalOpen(true)} />

      {/* Top Sessions */}
      <div>
        <h3 className="mb-3 text-base font-semibold text-gray-500 dark:text-slate-200 uppercase tracking-wider text-[11px]">
          Recent Sessions
        </h3>
        <SessionTable maxRows={5} />
      </div>

      <CreateSessionModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
