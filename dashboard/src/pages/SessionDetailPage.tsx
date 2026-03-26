import { useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Send,
  Octagon,
  CornerDownLeft,
} from 'lucide-react';
import { sendMessage, approve, reject, interrupt, escape, killSession } from '../api/client';
import { useToastStore } from '../store/useToastStore';
import { useSessionPolling } from '../hooks/useSessionPolling';
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

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('transcript');
  const {
    session, health, notFound, loading,
    paneContent, paneLoading,
    metrics, metricsLoading,
  } = useSessionPolling(id ?? '');

  const [msgInput, setMsgInput] = useState('');
  const [sending, setSending] = useState(false);
  const msgInputRef = useRef<HTMLInputElement>(null);

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

  const s = session;
  const h = health;
  const needsApproval = h.status === 'permission_prompt' || h.status === 'bash_approval';
  const addToast = useToastStore((t) => t.addToast);

  function handleApprove() {
    approve(s.id).catch((e: unknown) =>
      addToast('error', 'Approve failed', e instanceof Error ? e.message : undefined),
    );
  }
  function handleReject() {
    reject(s.id).catch((e: unknown) =>
      addToast('error', 'Reject failed', e instanceof Error ? e.message : undefined),
    );
  }
  function handleInterrupt() {
    interrupt(s.id).catch((e: unknown) =>
      addToast('error', 'Interrupt failed', e instanceof Error ? e.message : undefined),
    );
  }
  function handleEscape() {
    escape(s.id).catch((e: unknown) =>
      addToast('error', 'Escape failed', e instanceof Error ? e.message : undefined),
    );
  }
  async function handleKill() {
    try {
      await killSession(s.id);
      navigate('/dashboard');
    } catch (e: unknown) {
      addToast('error', 'Failed to kill session', e instanceof Error ? e.message : undefined);
    }
  }

  async function handleSend() {
    const text = msgInput.trim();
    if (!text) return;
    setSending(true);
    try {
      await sendMessage(s.id, text);
      setMsgInput('');
    } catch (e: unknown) {
      addToast('error', 'Failed to send message', e instanceof Error ? e.message : undefined);
    } finally {
      setSending(false);
      msgInputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4">
        {/* Breadcrumb */}
        <nav className="text-xs text-[#555] flex items-center gap-1">
          <Link to="/" className="hover:text-[#00e5ff] transition-colors">
            Overview
          </Link>
          <span className="text-[#333]">/</span>
          <span className="text-[#e0e0e0] truncate max-w-[160px] sm:max-w-xs">
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

        {/* Tab bar — full-width stretch on mobile */}
        <div className="flex border-b border-[#1a1a2e]" role="tablist">
          {TABS.map(tab => (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={`flex-1 min-h-[44px] text-sm font-medium transition-colors relative ${
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
        <div className="bg-[#0a0a0f] rounded-lg min-h-[300px] sm:min-h-[400px]">
          {/* Approval banner */}
          {needsApproval && (
            <div className="p-3 sm:p-4 pb-0">
              <ApprovalBanner
                sessionId={s.id}
                prompt={h.details}
                permissionMode={s.permissionMode}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            </div>
          )}

          {activeTab === 'transcript' && (
            <div id="panel-transcript" role="tabpanel" aria-labelledby="tab-transcript" tabIndex={0} className="h-[calc(100vh-380px)] sm:h-[calc(100vh-420px)] min-h-[250px] sm:min-h-[300px]">
              <TranscriptViewer sessionId={s.id} />
            </div>
          )}

          {activeTab === 'terminal' && (
            <div id="panel-terminal" role="tabpanel" aria-labelledby="tab-terminal" tabIndex={0} className="p-3 sm:p-4">
              <PanePreview sessionId={s.id} status={h.status} content={paneContent} loading={paneLoading} />
            </div>
          )}

          {activeTab === 'metrics' && (
            <div id="panel-metrics" role="tabpanel" aria-labelledby="tab-metrics" tabIndex={0} className="p-3 sm:p-4">
              <SessionMetricsPanel metrics={metrics} loading={metricsLoading} />
            </div>
          )}
        </div>

        {/* Message input + action bar */}
        <div className="bg-[#111118] border border-[#1a1a2e] rounded-lg p-3">
          <div className="flex items-center gap-2">
            {/* Message input */}
            <input
              ref={msgInputRef}
              type="text"
              value={msgInput}
              onChange={(e) => setMsgInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Send a message to Claude…"
              disabled={sending || !h.alive}
              className="flex-1 min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#00e5ff] font-mono disabled:opacity-50"
            />

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={sending || !msgInput.trim() || !h.alive}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2.5 rounded bg-[#00e5ff]/10 hover:bg-[#00e5ff]/20 text-[#00e5ff] border border-[#00e5ff]/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>

          {/* Action buttons row — wrap on mobile */}
          <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-[#1a1a2e]/50">
            <button
              onClick={handleInterrupt}
              className="flex items-center gap-1.5 min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 border border-[#1a1a2e] transition-colors"
              title="Interrupt (Ctrl+C)"
            >
              <Octagon className="h-3.5 w-3.5" />
              Interrupt
            </button>
            <button
              onClick={handleEscape}
              className="flex items-center gap-1.5 min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 border border-[#1a1a2e] transition-colors"
              title="Send Escape"
            >
              <CornerDownLeft className="h-3.5 w-3.5" />
              Escape
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
