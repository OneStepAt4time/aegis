import { useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Camera,
  Send,
  Octagon,
  CornerDownLeft,
} from 'lucide-react';
import {
  sendMessage,
  sendCommand,
  sendBash,
  approve,
  reject,
  interrupt,
  escape,
  killSession,
  getScreenshot,
  forkSession,
} from '../api/client';
import { useToastStore } from '../store/useToastStore';
import { useSessionPolling } from '../hooks/useSessionPolling';
import { SessionHeader } from '../components/session/SessionHeader';
import { TerminalPassthrough } from '../components/session/TerminalPassthrough';
import { SessionMetricsPanel } from '../components/session/SessionMetricsPanel';
import { LatencyPanel } from '../components/metrics/LatencyPanel';
import { ApprovalBanner } from '../components/session/ApprovalBanner';
import SaveTemplateModal from '../components/SaveTemplateModal';

interface ScreenshotState {
  image: string;
  mimeType?: string;
  capturedAt: number;
}

type TabId = 'session' | 'metrics';

const TABS: { id: TabId; label: string }[] = [
  { id: 'session', label: 'Session' },
  { id: 'metrics', label: 'Metrics' },
];

const COMMON_SLASH_COMMANDS = ['/clear', '/compact', '/cost', '/config'] as const;

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('session');
  const [saveTemplateModalOpen, setSaveTemplateModalOpen] = useState(false);
  const {
    session, health, notFound, loading,
    metrics, metricsLoading,
    latency, latencyLoading,
  } = useSessionPolling(id ?? '');

  const [msgInput, setMsgInput] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedSlashCommand, setSelectedSlashCommand] = useState<string>(COMMON_SLASH_COMMANDS[0]);
  const [slashSending, setSlashSending] = useState(false);
  const [bashInput, setBashInput] = useState('');
  const [bashConfirming, setBashConfirming] = useState(false);
  const [bashSending, setBashSending] = useState(false);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const [screenshotUnsupported, setScreenshotUnsupported] = useState(false);
  const [screenshot, setScreenshot] = useState<ScreenshotState | null>(null);
  const msgInputRef = useRef<HTMLInputElement>(null);
  const sendingRef = useRef(false);
  const addToast = useToastStore((t) => t.addToast);

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
  async function handleFork() {
    try {
      const forked = await forkSession(s.id, { name: undefined });
      addToast('success', 'Session forked', `New session ${forked.id.slice(0, 8)} created`);
      navigate(`/session/${forked.id}`);
    } catch (e: unknown) {
      addToast('error', 'Fork failed', e instanceof Error ? e.message : undefined);
    }
  }
  function handleEscape() {
    escape(s.id).catch((e: unknown) =>
      addToast('error', 'Escape failed', e instanceof Error ? e.message : undefined),
    );
  }
  async function handleKill() {
    try {
      await killSession(s.id);
      navigate('/');
    } catch (e: unknown) {
      addToast('error', 'Failed to kill session', e instanceof Error ? e.message : undefined);
    }
  }

  async function handleCaptureScreenshot() {
    if (capturingScreenshot) return;
    setCapturingScreenshot(true);
    try {
      const result = await getScreenshot(s.id);
      setScreenshot({
        image: result.image,
        mimeType: result.mimeType,
        capturedAt: Date.now(),
      });
      addToast('success', 'Screenshot captured');
    } catch (e: unknown) {
      const maybeStatus = typeof e === 'object' && e !== null && 'statusCode' in e
        ? (e as { statusCode?: number }).statusCode
        : undefined;

      if (maybeStatus === 501) {
        setScreenshotUnsupported(true);
        addToast('warning', 'Screenshot unavailable', 'Playwright is not installed on the server.');
      } else {
        addToast('error', 'Screenshot failed', e instanceof Error ? e.message : undefined);
      }
    } finally {
      setCapturingScreenshot(false);
    }
  }

  async function handleSend() {
    const text = msgInput.trim();
    if (!text) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await sendMessage(s.id, text);
      setMsgInput('');
    } catch (e: unknown) {
      addToast('error', 'Failed to send message', e instanceof Error ? e.message : undefined);
    } finally {
      setSending(false);
      sendingRef.current = false;
      msgInputRef.current?.focus();
    }
  }

  function handleInsertSlashCommand() {
    setMsgInput(selectedSlashCommand);
    msgInputRef.current?.focus();
  }

  async function handleSendSlashCommand() {
    if (!selectedSlashCommand || slashSending) return;
    setSlashSending(true);
    try {
      await sendCommand(s.id, selectedSlashCommand);
      setMsgInput('');
    } catch (e: unknown) {
      addToast('error', 'Failed to send slash command', e instanceof Error ? e.message : undefined);
    } finally {
      setSlashSending(false);
    }
  }

  async function handleConfirmBashCommand() {
    const command = bashInput.trim();
    if (!command || bashSending) return;
    setBashSending(true);
    try {
      await sendBash(s.id, command);
      setBashInput('');
      setBashConfirming(false);
    } catch (e: unknown) {
      addToast('error', 'Failed to send bash command', e instanceof Error ? e.message : undefined);
    } finally {
      setBashSending(false);
    }
  }

  function handleReviewBashCommand() {
    if (!bashInput.trim()) return;
    setBashConfirming(true);
  }

  function handleBashInputChange(value: string) {
    setBashInput(value);
    if (bashConfirming) {
      setBashConfirming(false);
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
          onFork={handleFork}
          onKill={handleKill}
          onSaveTemplate={() => setSaveTemplateModalOpen(true)}
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
                prompt={h.details}
                permissionMode={s.permissionMode}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            </div>
          )}

          {activeTab === 'session' && (
            <div id="panel-session" role="tabpanel" aria-labelledby="tab-session" tabIndex={0} className="h-[calc(100vh-380px)] sm:h-[calc(100vh-420px)] min-h-[250px] sm:min-h-[300px]">
              <TerminalPassthrough sessionId={s.id} status={h.status} />
            </div>
          )}

          {activeTab === 'metrics' && (
            <div id="panel-metrics" role="tabpanel" aria-labelledby="tab-metrics" tabIndex={0} className="p-3 sm:p-4">
              <SessionMetricsPanel metrics={metrics} loading={metricsLoading} />
              <div className="mt-4">
                <LatencyPanel latency={latency} loading={latencyLoading} />
              </div>
            </div>
          )}
        </div>

        {/* Message input + action bar */}
        <div className="bg-[#111118] border border-[#1a1a2e] rounded-lg p-3">
          <div className="flex items-center gap-2">
            {/* Message input */}
            <label htmlFor="session-message-input" className="sr-only">
              Session message input
            </label>
            <input
              id="session-message-input"
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
            <label className="sr-only" htmlFor="slash-command-select">Common slash command</label>
            <select
              id="slash-command-select"
              value={selectedSlashCommand}
              onChange={(e) => setSelectedSlashCommand(e.target.value)}
              disabled={slashSending || !h.alive}
              className="min-h-[44px] rounded border border-[#1a1a2e] bg-[#0a0a0f] px-3 py-2 text-xs font-medium text-gray-200 focus:outline-none focus:border-[#00e5ff] disabled:opacity-50"
            >
              {COMMON_SLASH_COMMANDS.map((command) => (
                <option key={command} value={command}>
                  {command}
                </option>
              ))}
            </select>
            <button
              onClick={handleInsertSlashCommand}
              disabled={slashSending || !h.alive}
              className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 border border-[#1a1a2e] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Insert selected slash command into the message input"
            >
              Insert Slash
            </button>
            <button
              onClick={handleSendSlashCommand}
              disabled={slashSending || !h.alive}
              className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#002a33] hover:bg-[#003744] text-[#00e5ff] border border-[#00e5ff]/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Send selected slash command immediately"
            >
              {slashSending ? 'Sending Slash…' : 'Run Slash'}
            </button>
            <label className="sr-only" htmlFor="bash-command-input">Bash command</label>
            <input
              id="bash-command-input"
              type="text"
              value={bashInput}
              onChange={(e) => handleBashInputChange(e.target.value)}
              placeholder="Bash command (requires confirmation)…"
              disabled={bashSending || !h.alive}
              className="min-h-[44px] min-w-[220px] flex-1 rounded border border-[#1a1a2e] bg-[#0a0a0f] px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#ffaa00] font-mono disabled:opacity-50"
            />
            {!bashConfirming ? (
              <button
                onClick={handleReviewBashCommand}
                disabled={bashSending || !bashInput.trim() || !h.alive}
                className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#2b2200] hover:bg-[#3a2e00] text-[#ffaa00] border border-[#ffaa00]/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Review bash command before sending"
              >
                Review Bash
              </button>
            ) : (
              <>
                <span className="text-[11px] text-[#ffaa00] italic">
                  Confirm bash command execution.
                </span>
                <button
                  onClick={handleConfirmBashCommand}
                  disabled={bashSending || !bashInput.trim() || !h.alive}
                  className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#3a2e00] hover:bg-[#4a3900] text-[#ffaa00] border border-[#ffaa00]/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Send bash command"
                >
                  {bashSending ? 'Sending Bash…' : 'Confirm Bash'}
                </button>
                <button
                  onClick={() => setBashConfirming(false)}
                  disabled={bashSending}
                  className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 border border-[#1a1a2e] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Cancel Bash
                </button>
              </>
            )}
            {!screenshotUnsupported && (
              <button
                onClick={handleCaptureScreenshot}
                disabled={capturingScreenshot || !h.alive}
                className="flex items-center gap-1.5 min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 border border-[#1a1a2e] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Capture screenshot"
              >
                <Camera className="h-3.5 w-3.5" />
                {capturingScreenshot ? 'Capturing…' : 'Screenshot'}
              </button>
            )}
            <button
              onClick={handleInterrupt}
              aria-label="Interrupt session with Ctrl+C"
              className="flex items-center gap-1.5 min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 border border-[#1a1a2e] transition-colors"
              title="Interrupt (Ctrl+C)"
            >
              <Octagon className="h-3.5 w-3.5" />
              Interrupt
            </button>
            <button
              onClick={handleEscape}
              aria-label="Send Escape to session"
              className="flex items-center gap-1.5 min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 border border-[#1a1a2e] transition-colors"
              title="Send Escape"
            >
              <CornerDownLeft className="h-3.5 w-3.5" />
              Escape
            </button>
          </div>

          {screenshot && (
            <div className="mt-3 rounded-lg border border-[#1a1a2e] bg-[#0a0a0f] p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Latest screenshot</h3>
                <span className="text-[11px] text-gray-500">{new Date(screenshot.capturedAt).toLocaleTimeString()}</span>
              </div>
              <img
                src={screenshot.image}
                alt="Session screenshot preview"
                className="max-h-[420px] w-full rounded border border-[#1a1a2e] object-contain bg-black"
              />
              <div className="mt-2 text-[11px] text-gray-500">
                {screenshot.mimeType ?? 'image/png'}
              </div>
            </div>
          )}
        </div>
      </div>

      <SaveTemplateModal
        open={saveTemplateModalOpen}
        onClose={() => setSaveTemplateModalOpen(false)}
        sessionId={id ?? ''}
      />
    </div>
  );
}
