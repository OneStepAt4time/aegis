import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { SessionInfo, SessionHealth } from '../types';
import { getSession, getSessionHealth, approve, reject, interrupt, killSession } from '../api/client';
import { SessionHeader } from '../components/session/SessionHeader';
import { TranscriptViewer } from '../components/session/TranscriptViewer';
import { PanePreview } from '../components/session/PanePreview';
import { SessionMetricsPanel } from '../components/session/SessionMetricsPanel';
import { ApprovalBanner } from '../components/session/ApprovalBanner';

type TabId = 'transcript' | 'terminal' | 'metrics';

const TABS: { id: TabId; label: string }[] = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'metrics', label: 'Metrics' },
];

function useSessionData(sessionId: string) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [health, setHealth] = useState<SessionHealth | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [sessionRes, healthRes] = await Promise.allSettled([
        getSession(sessionId),
        getSessionHealth(sessionId),
      ]);

      if (
        (sessionRes.status === 'rejected' && sessionRes.reason?.message?.includes('404')) ||
        (healthRes.status === 'rejected' && healthRes.reason?.message?.includes('404'))
      ) {
        setNotFound(true);
        return;
      }

      if (sessionRes.status === 'fulfilled') setSession(sessionRes.value);
      if (healthRes.status === 'fulfilled') setHealth(healthRes.value);
    } catch {
      // network error
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);

  return { session, health, notFound, loading };
}

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabId>('transcript');
  const { session, health, notFound, loading } = useSessionData(id ?? '');

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-[#555] text-sm">
        <div className="animate-pulse">Loading session…</div>
      </div>
    );
  }

  if (notFound || !session || !health) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center text-[#555]">
        <div className="text-6xl mb-4">404</div>
        <div className="text-lg mb-6 text-[#e0e0e0]">Session not found</div>
        <Link to="/" className="text-sm text-[#00e5ff] hover:underline">
          ← Back to Overview
        </Link>
      </div>
    );
  }

  // TypeScript narrowing: session and health are non-null after the guard above.
  const s = session;
  const h = health;
  const needsApproval = h.status === 'permission_prompt' || h.status === 'bash_approval';

  function handleApprove() { approve(s.id).catch(() => {}); }
  function handleReject() { reject(s.id).catch(() => {}); }
  function handleInterrupt() { interrupt(s.id).catch(() => {}); }
  function handleKill() { killSession(s.id).catch(() => {}); }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
        {/* Breadcrumb */}
        <nav className="text-xs text-[#555] flex items-center gap-1">
          <Link to="/" className="hover:text-[#00e5ff] transition-colors">
            Overview
          </Link>
          <span className="text-[#333]">/</span>
          <span className="text-[#e0e0e0] truncate max-w-xs">
            {s.windowName || s.id}
          </span>
        </nav>

        {/* Header */}
        <SessionHeader
          session={s}
          health={h}
          onApprove={handleApprove}
          onReject={handleReject}
          onInterrupt={handleInterrupt}
          onKill={handleKill}
        />

        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-[#1a1a2e]">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === tab.id
                  ? 'text-[#00e5ff]'
                  : 'text-[#555] hover:text-[#888]'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#00e5ff]" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="bg-[#0a0a0f] rounded-lg min-h-[400px]">
          {/* Approval banner */}
          {needsApproval && (
            <div className="p-4 pb-0">
              <ApprovalBanner
                sessionId={s.id}
                prompt={h.details}
                autoApprove={s.autoApprove}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            </div>
          )}

          {activeTab === 'transcript' && (
            <div className="h-[calc(100vh-320px)] min-h-[400px]">
              <TranscriptViewer sessionId={s.id} />
            </div>
          )}

          {activeTab === 'terminal' && (
            <div className="p-4">
              <PanePreview sessionId={s.id} status={h.status} />
            </div>
          )}

          {activeTab === 'metrics' && (
            <div className="p-4">
              <SessionMetricsPanel sessionId={s.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
