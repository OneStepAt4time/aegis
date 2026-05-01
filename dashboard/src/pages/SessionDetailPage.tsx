import { useState, useRef, useEffect } from 'react';
import type { AuditRecord } from '../types';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
} from 'lucide-react';
import {
  fetchAuditLogs,
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
import { StreamTab } from '../components/session/StreamTab';
import { SessionMetricsPanel } from '../components/session/SessionMetricsPanel';
import { LatencyPanel } from '../components/metrics/LatencyPanel';
import { AuditTrailPanel } from '../components/session/AuditTrailPanel';
import { TranscriptViewer } from '../components/session/TranscriptViewer';
import { ApprovalBanner } from '../components/session/ApprovalBanner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PendingQuestionCard } from '../components/session/PendingQuestionCard';
import { PermissionPromptSheet } from '../components/session/PermissionPromptSheet';
import SaveTemplateModal from '../components/SaveTemplateModal';

interface ScreenshotState {
  image: string;
  mimeType?: string;
  capturedAt: number;
}

type TabId = 'stream' | 'metrics' | 'audit' | 'transcript';

const TABS: { id: TabId; label: string }[] = [
  { id: 'stream', label: 'Stream' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'audit', label: 'Audit' },
  { id: 'transcript', label: 'Transcript' },
];

const COMMON_SLASH_COMMANDS = ['/clear', '/compact', '/cost', '/config'] as const;

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('stream');
  const [saveTemplateModalOpen, setSaveTemplateModalOpen] = useState(false);
  const {
    session, health, notFound, loading,
    latency, latencyLoading,
  } = useSessionPolling(id ?? '');

  const [msgInput, setMsgInput] = useState('');
  const [sending, setSending] = useState(false);
  // Issue 06.3: ↑/↓ cycles through recently sent messages. History is
  // per-session-page-mount (not persisted) — chat history and redrive
  // both make a persistent log undesirable.
  const sendHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [selectedSlashCommand, setSelectedSlashCommand] = useState<string>(COMMON_SLASH_COMMANDS[0]);
  const [slashSending, setSlashSending] = useState(false);
  const [bashInput, setBashInput] = useState('');
  const [bashConfirming, setBashConfirming] = useState(false);
  const [bashSending, setBashSending] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [killConfirmOpen, setKillConfirmOpen] = useState(false);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const [screenshotUnsupported, setScreenshotUnsupported] = useState(false);
  const [screenshot, setScreenshot] = useState<ScreenshotState | null>(null);
  // Full-bleed terminal mode
  const [fullBleed, setFullBleed] = useState(false);
  const fullBleedRef = useRef(false);
  fullBleedRef.current = fullBleed;
  const [mobileFooterHeight, setMobileFooterHeight] = useState(0);
  // Audit trail state
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const desktopMsgInputRef = useRef<HTMLInputElement>(null);
  const mobileMsgInputRef = useRef<HTMLInputElement>(null);
  const mobileFooterRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const handleSendRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const handleInterruptRef = useRef<() => void>(() => {});
  const addToast = useToastStore((t) => t.addToast);

  function getVisibleMessageInput(): HTMLInputElement | null {
    const candidates = [desktopMsgInputRef.current, mobileMsgInputRef.current].filter(
      (input): input is HTMLInputElement => input !== null,
    );
    return candidates.find((input) => input.offsetParent !== null) ?? candidates[0] ?? null;
  }

  // Register global shortcuts unconditionally so hook order never changes
  // across loading/notFound/session renders.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable;

      // Ctrl/Cmd+Enter: submit message (only when message input is focused)
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (document.activeElement === getVisibleMessageInput()) {
          e.preventDefault();
          void handleSendRef.current();
        }
        return;
      }

      // F key: toggle full-bleed terminal mode (only when not typing)
      if (e.key === 'f' && !isTyping) {
        e.preventDefault();
        setFullBleed((v) => !v);
        return;
      }

      // Escape: exit full-bleed first; then interrupt
      if (e.key === 'Escape' && !isTyping) {
        if (fullBleedRef.current) {
          e.preventDefault();
          setFullBleed(false);
          return;
        }
        e.preventDefault();
        handleInterruptRef.current();
        return;
      }

      // / key: focus message input (skip if user is already typing)
      if (e.key === '/' && !isTyping) {
        e.preventDefault();
        getVisibleMessageInput()?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;

    const node = mobileFooterRef.current;
    if (!node) return undefined;

    const updateHeight = () => {
      setMobileFooterHeight(node.getBoundingClientRect().height);
    };

    updateHeight();

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  // Fetch audit trail when audit tab is active
  useEffect(() => {
    if (activeTab !== 'audit' || !id) return;

    let cancelled = false;
    setAuditLoading(true);
    setAuditError(null);

    fetchAuditLogs({ sessionId: id, limit: 100, reverse: true })
      .then((data) => {
        if (cancelled) return;
        setAuditRecords(data.records);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setAuditError(err.message ?? 'Failed to load audit trail');
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeTab, id]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6 animate-pulse">
        {/* Header skeleton */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-void-lighter)] rounded-lg p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-5 w-48 rounded bg-[var(--color-void-lighter)]" />
            <div className="h-5 w-20 rounded-full bg-[var(--color-void-lighter)]" />
          </div>
          <div className="flex gap-2">
            <div className="h-4 w-32 rounded bg-[var(--color-void-lighter)]" />
            <div className="h-4 w-24 rounded bg-[var(--color-void-lighter)]" />
          </div>
        </div>
        {/* Tabs skeleton */}
        <div className="flex gap-2 border-b border-[var(--color-void-lighter)] pb-2">
          <div className="h-8 w-20 rounded bg-[var(--color-void-lighter)]" />
          <div className="h-8 w-20 rounded bg-[var(--color-void-lighter)]" />
          <div className="h-8 w-20 rounded bg-[var(--color-void-lighter)]" />
        </div>
        <div className="h-64 card-glass animate-bento-reveal" />
      </div>
    );
  }

  if (notFound || !session || !health) {
    return (
      <div className="min-h-screen bg-[var(--color-void)] flex flex-col items-center justify-center text-[#555] overscroll-contain">
        <div className="text-6xl mb-4">404</div>
        <div className="text-lg mb-6 text-[var(--color-text-primary)]">Session not found</div>
      </div>
    );
  }

  const s = session;
  const h = health;
  const needsApproval = h.status === 'permission_prompt' || h.status === 'bash_approval';
  const pendingPermission = s.pendingPermission;
  const pendingQuestion = s.pendingQuestion ?? (
    h.status === 'ask_question'
      ? {
          toolUseId: 'pending-question',
          content: 'Claude is waiting for your answer. Reply below to continue.',
          options: null,
          since: s.lastActivity,
        }
      : undefined
  );

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
      navigate(`/sessions/${forked.id}`);
    } catch (e: unknown) {
      addToast('error', 'Fork failed', e instanceof Error ? e.message : undefined);
    }
  }
  function handleEscape() {
    escape(s.id).catch((e: unknown) =>
      addToast('error', 'Escape failed', e instanceof Error ? e.message : undefined),
    );
  }
  function handleKillRequest() {
    setKillConfirmOpen(true);
  }
  async function handleKill() {
    setKillConfirmOpen(false);
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
      // Record for ↑-history recall (issue 06.3). De-dup against the tail
      // so spamming the same message doesn't flood the history.
      const hist = sendHistoryRef.current;
      if (hist[hist.length - 1] !== text) hist.push(text);
      // Keep the last 50 only — cheap guard against memory growth on very
      // long sessions.
      if (hist.length > 50) hist.shift();
      historyIndexRef.current = -1;
    } catch (e: unknown) {
      addToast('error', 'Failed to send message', e instanceof Error ? e.message : undefined);
    } finally {
      setSending(false);
      sendingRef.current = false;
      getVisibleMessageInput()?.focus();
    }
  }

  function handleInsertSlashCommand() {
    setMsgInput(selectedSlashCommand);
    getVisibleMessageInput()?.focus();
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

  function handleSelectQuestionOption(option: string) {
    setMsgInput(option);
    getVisibleMessageInput()?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    // Issue 06.3: ↑/↓ to cycle through send history when the input is
    // empty or already showing a history entry. If the user has typed
    // something original, leave the arrow keys alone (caret movement).
    const hist = sendHistoryRef.current;
    if (hist.length === 0) return;
    const usingHistory =
      msgInput === '' || historyIndexRef.current !== -1;
    if (!usingHistory) return;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const nextIdx = historyIndexRef.current === -1
        ? hist.length - 1
        : Math.max(0, historyIndexRef.current - 1);
      historyIndexRef.current = nextIdx;
      setMsgInput(hist[nextIdx] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndexRef.current === -1) return;
      const nextIdx = historyIndexRef.current + 1;
      if (nextIdx >= hist.length) {
        historyIndexRef.current = -1;
        setMsgInput('');
      } else {
        historyIndexRef.current = nextIdx;
        setMsgInput(hist[nextIdx] ?? '');
      }
    }
  }

  // Global keyboard shortcuts (uses refs to avoid re-registering on every state change)
  handleSendRef.current = handleSend;
  handleInterruptRef.current = handleInterrupt;

  function renderCommandTools(layout: 'desktop' | 'mobile') {
    const isMobile = layout === 'mobile';
    const idSuffix = isMobile ? 'mobile' : 'desktop';
    const containerClass = isMobile
      ? 'grid gap-2'
      : 'flex flex-wrap items-center gap-2';
    const selectClass = isMobile
      ? 'min-h-[44px] w-full rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs font-medium text-gray-200 focus:border-[var(--color-accent-cyan)] focus:outline-none disabled:opacity-50'
      : 'min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs font-medium text-gray-200 focus:border-[var(--color-accent-cyan)] focus:outline-none disabled:opacity-50';
    const buttonClass = isMobile
      ? 'min-h-[44px] w-full rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-lighter)] px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-30'
      : 'min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-lighter)] px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-30';
    const accentButtonClass = isMobile
      ? 'min-h-[44px] w-full rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-info-bg-dark)] px-3 py-2 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-info-bg)] disabled:cursor-not-allowed disabled:opacity-30'
      : 'min-h-[44px] rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-info-bg-dark)] px-3 py-2 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-info-bg)] disabled:cursor-not-allowed disabled:opacity-30';
    const bashInputClass = isMobile
      ? 'min-h-[44px] w-full rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:border-[var(--color-warning-amber)] focus:outline-none font-mono disabled:opacity-50'
      : 'min-h-[44px] min-w-[220px] flex-1 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:border-[var(--color-warning-amber)] focus:outline-none font-mono disabled:opacity-50';

    return (
      <div className={containerClass}>
        <label className="sr-only" htmlFor={`slash-command-select-${idSuffix}`}>
          Common slash command
        </label>
        <select
          id={`slash-command-select-${idSuffix}`}
          value={selectedSlashCommand}
          onChange={(e) => setSelectedSlashCommand(e.target.value)}
          disabled={slashSending || !h.alive}
          className={selectClass}
        >
          {COMMON_SLASH_COMMANDS.map((command) => (
            <option key={command} value={command}>
              {command}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={handleInsertSlashCommand}
          disabled={slashSending || !h.alive}
          className={buttonClass}
          title="Insert selected slash command into the message input"
        >
          Insert Slash
        </button>

        <button
          type="button"
          onClick={handleSendSlashCommand}
          disabled={slashSending || !h.alive}
          className={accentButtonClass}
          title="Send selected slash command immediately"
        >
          {slashSending ? 'Sending Slash…' : 'Run Slash'}
        </button>

        <label className="sr-only" htmlFor={`bash-command-input-${idSuffix}`}>
          Bash command
        </label>
        <input
          id={`bash-command-input-${idSuffix}`}
          type="text"
          value={bashInput}
          onChange={(e) => handleBashInputChange(e.target.value)}
          placeholder="Bash command (requires confirmation)…"
          disabled={bashSending || !h.alive}
          className={bashInputClass}
        />

        {!bashConfirming ? (
          <button
            type="button"
            onClick={handleReviewBashCommand}
            disabled={bashSending || !bashInput.trim() || !h.alive}
            className={buttonClass.replace(
              'border-[var(--color-void-lighter)] bg-[var(--color-void-lighter)] text-gray-300',
              'border-[var(--color-warning-amber)]/30 bg-[var(--color-amber-darkest)] text-[var(--color-warning-amber)]',
            )}
            title="Review bash command before sending"
          >
            Review Bash
          </button>
        ) : (
          <>
            <span className="text-[11px] italic text-[var(--color-warning-amber)]">
              Confirm bash command execution.
            </span>
            <button
              type="button"
              onClick={handleConfirmBashCommand}
              disabled={bashSending || !bashInput.trim() || !h.alive}
              className={buttonClass.replace(
                'border-[var(--color-void-lighter)] bg-[var(--color-void-lighter)] text-gray-300',
                'border-[var(--color-warning-amber)]/30 bg-[var(--color-amber-dark)] text-[var(--color-warning-amber)]',
              )}
              title="Send bash command"
            >
              {bashSending ? 'Sending Bash…' : 'Confirm Bash'}
            </button>
            <button
              type="button"
              onClick={() => setBashConfirming(false)}
              disabled={bashSending}
              className={buttonClass}
            >
              Cancel Bash
            </button>
          </>
        )}

        {!screenshotUnsupported && (
          <button
            type="button"
            onClick={handleCaptureScreenshot}
            disabled={capturingScreenshot || !h.alive}
            className={buttonClass}
            title="Capture screenshot"
          >
            {capturingScreenshot ? 'Capturing…' : 'Screenshot'}
          </button>
        )}

        {!isMobile && (
          <>
            <button
              type="button"
              onClick={handleInterrupt}
              aria-label="Interrupt session with Ctrl+C"
              className={buttonClass}
              title="Interrupt (Ctrl+C)"
            >
              Interrupt
            </button>
            <button
              type="button"
              onClick={handleEscape}
              aria-label="Send Escape to session"
              className={buttonClass}
              title="Send Escape"
            >
              Escape
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent">
      {needsApproval && (
        <div className="fixed inset-0 z-30 bg-black/40 sm:hidden" aria-hidden="true" />
      )}

      <div
        className="mx-auto max-w-6xl px-3 py-3 sm:px-4 sm:py-4"
        style={mobileFooterHeight > 0 ? { paddingBottom: mobileFooterHeight + 16 } : undefined}
      >
        <div className="space-y-3 sm:space-y-4">
          <SessionHeader
            session={s}
            health={h}
            onApprove={handleApprove}
            onReject={handleReject}
            onInterrupt={handleInterrupt}
            onFork={handleFork}
            onKill={() => { void handleKill(); }}
            onSaveTemplate={() => setSaveTemplateModalOpen(true)}
          />

          <div className="relative flex gap-2 py-1" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                className={`relative z-10 min-h-[44px] rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'text-[var(--color-void)] dark:text-[var(--color-text-primary)]'
                    : 'border border-[var(--color-void-lighter)] bg-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    className="absolute inset-0 bg-[var(--color-cta-bg)] rounded-full shadow-sm"
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    style={{ zIndex: -1 }}
                  />
                )}
                {tab.label}
              </button>
            ))}
          </div>

          <div
            className="card-glass overflow-hidden animate-bento-reveal relative"
            data-fullbleed={fullBleed ? 'true' : undefined}
            style={fullBleed ? { height: 'calc(100vh - 120px)', minHeight: 300 } : { minHeight: 300 }}
          >
            {needsApproval && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }} 
                animate={{ opacity: 1, y: 0 }} 
                className="hidden p-3 pb-0 sm:block sm:p-4"
              >
                <ApprovalBanner
                  prompt={pendingPermission?.prompt ?? h.details}
                  permissionMode={s.permissionMode}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              </motion.div>
            )}

            <AnimatePresence mode="wait">
              {activeTab === 'stream' && (
                <motion.div
                  key="panel-stream"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  id="panel-stream"
                  role="tabpanel"
                  aria-labelledby="tab-stream"
                  tabIndex={0}
                  className={fullBleed ? 'h-full min-h-[200px]' : 'h-[calc(100vh-300px)] min-h-[200px] sm:h-[calc(100vh-420px)] sm:min-h-[300px]'}
                >
                  <StreamTab sessionId={s.id} status={h.status} />
                </motion.div>
              )}

              {activeTab === 'metrics' && (
                <motion.div
                  key="panel-metrics"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  id="panel-metrics"
                  role="tabpanel"
                  aria-labelledby="tab-metrics"
                  tabIndex={0}
                  className="overflow-auto p-3 sm:p-4"
                >
                  <SessionMetricsPanel sessionId={s.id} />
                  <div className="mt-4">
                    <LatencyPanel latency={latency} loading={latencyLoading} />
                  </div>
                </motion.div>
              )}

              {activeTab === 'audit' && (
                <motion.div
                  key="panel-audit"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  id="panel-audit"
                  role="tabpanel"
                  aria-labelledby="tab-audit"
                  tabIndex={0}
                  className="overflow-auto p-3 sm:p-4"
                >
                  <AuditTrailPanel records={auditRecords} loading={auditLoading} error={auditError} />
                </motion.div>
              )}

              {activeTab === 'transcript' && (
                <motion.div
                  key="panel-transcript"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  id="panel-transcript"
                  role="tabpanel"
                  aria-labelledby="tab-transcript"
                  tabIndex={0}
                  className={fullBleed ? 'h-full min-h-[200px]' : 'h-[calc(100vh-300px)] min-h-[200px] sm:h-[calc(100vh-420px)] sm:min-h-[300px]'}
                >
                  <TranscriptViewer sessionId={s.id} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Desktop session composer — docked below the terminal panel */}
          <div className="hidden rounded-b-lg border border-t-0 border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-3 sm:block animate-bento-reveal">
            {pendingQuestion && (
              <PendingQuestionCard
                pendingQuestion={pendingQuestion}
                onSelectOption={handleSelectQuestionOption}
              />
            )}

            <div className={`flex items-center gap-3 ${pendingQuestion ? 'mt-4' : ''}`}>
              {/* Composer toolbar icons */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="Insert slash command"
                  onClick={() => { setMsgInput((v) => v || '/'); getVisibleMessageInput()?.focus(); }}
                  disabled={!h.alive}
                  className="inline-flex h-8 w-8 items-center justify-center rounded text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-void-lighter)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
                  aria-label="Slash command"
                >
                  <span className="text-sm font-mono font-bold">/</span>
                </button>
                <button
                  type="button"
                  title="Bash mode"
                  disabled={!h.alive}
                  className="inline-flex h-8 w-8 items-center justify-center rounded text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-void-lighter)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
                  aria-label="Bash mode"
                >
                  <span className="text-sm font-mono font-bold">$</span>
                </button>
                {!screenshotUnsupported && (
                  <button
                    type="button"
                    title="Capture screenshot"
                    onClick={handleCaptureScreenshot}
                    disabled={capturingScreenshot || !h.alive}
                    className="inline-flex h-8 w-8 items-center justify-center rounded text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-void-lighter)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
                    aria-label="Capture screenshot"
                  >
                    <span className="text-xs">⬛</span>
                  </button>
                )}
                <button
                  type="button"
                  title="Send Escape"
                  onClick={handleEscape}
                  disabled={!h.alive}
                  className="inline-flex h-8 items-center justify-center rounded px-1.5 text-[10px] font-mono text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-void-lighter)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
                  aria-label="Send Escape to session"
                >
                  Esc
                </button>
                <button
                  type="button"
                  title="Interrupt (Ctrl+C)"
                  onClick={handleInterrupt}
                  disabled={!h.alive}
                  className="inline-flex h-8 items-center justify-center rounded px-1.5 text-[10px] font-mono text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-void-lighter)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
                  aria-label="Interrupt session with Ctrl+C"
                >
                  ^C
                </button>
              </div>

              <label htmlFor="session-message-input-desktop" className="sr-only">
                Session message input
              </label>
              <input
                id="session-message-input-desktop"
                ref={desktopMsgInputRef}
                type="text"
                value={msgInput}
                onChange={(e) => setMsgInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Send a message to Claude…"
                disabled={sending || !h.alive}
                className="flex-1 min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-cta-bg)] focus:outline-none disabled:opacity-50"
              />

              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !msgInput.trim() || !h.alive}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-[var(--color-cta-bg)]/50 bg-[var(--color-cta-bg)]/15 p-2.5 text-[var(--color-cta-bg)] transition-all hover:bg-[var(--color-cta-bg)]/30 disabled:cursor-not-allowed disabled:opacity-30"
                title="Send message (⌘↵)"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>

            {/* Coach hint — Issue 003f: shown for first-minute sessions (first-minute coach) */}
            {s.createdAt && (Date.now() - s.createdAt < 60_000) && !msgInput && (
              <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">
                <kbd className="rounded border border-[var(--color-void-lighter)] px-1 font-mono text-[10px]">⌘↵</kbd>{' '}
                to send · Try:{' '}
                <button
                  type="button"
                  className="text-[var(--color-accent-cyan)] hover:underline"
                  onClick={() => { setMsgInput('/help'); getVisibleMessageInput()?.focus(); }}
                >
                  /help
                </button>{' '}·{' '}
                <button
                  type="button"
                  className="text-[var(--color-accent-cyan)] hover:underline"
                  onClick={() => { setMsgInput('/status'); getVisibleMessageInput()?.focus(); }}
                >
                  /status
                </button>{' '}·{' '}
                <button
                  type="button"
                  className="text-[var(--color-accent-cyan)] hover:underline"
                  onClick={() => { setMsgInput('/cost'); getVisibleMessageInput()?.focus(); }}
                >
                  /cost
                </button>
              </p>
            )}

            <div className="mt-2 border-t border-[var(--color-void-lighter)]/50 pt-2">
              {renderCommandTools('desktop')}
            </div>
          </div>

          {screenshot && (
            <div className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)] p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Latest screenshot
                </h3>
                <span className="text-[11px] text-gray-500">
                  {new Date(screenshot.capturedAt).toLocaleTimeString()}
                </span>
              </div>
              <img
                src={screenshot.image}
                alt="Session screenshot preview"
                className="max-h-[420px] w-full rounded border border-[var(--color-void-lighter)] bg-black object-contain"
              />
              <div className="mt-2 text-[11px] text-gray-500">
                {screenshot.mimeType ?? 'image/png'}
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        ref={mobileFooterRef}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-void-lighter)] bg-[var(--color-surface)]/95 pb-[max(0px,env(safe-area-inset-bottom))] backdrop-blur sm:hidden"
      >
        <div className="mx-auto max-w-6xl space-y-3 px-3 py-3">
          {pendingQuestion && (
            <PendingQuestionCard
              pendingQuestion={pendingQuestion}
              onSelectOption={handleSelectQuestionOption}
            />
          )}

          {needsApproval ? (
            <PermissionPromptSheet
              prompt={h.details}
              pendingPermission={pendingPermission}
              permissionPromptAt={s.permissionPromptAt}
              onApprove={handleApprove}
              onReject={handleReject}
              onEscape={handleEscape}
              onKill={handleKillRequest}
            />
          ) : (
            <div className="grid grid-cols-3 gap-2 rounded-2xl border border-[var(--color-void-lighter)] bg-[var(--color-void)] p-2">
              <button
                type="button"
                onClick={handleInterrupt}
                className="min-h-[48px] rounded-xl border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-3 text-sm font-medium text-gray-200 transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                Interrupt
              </button>
              <button
                type="button"
                onClick={handleEscape}
                className="min-h-[48px] rounded-xl border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-3 text-sm font-medium text-gray-200 transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                Escape
              </button>
              <button
                type="button"
                onClick={handleKillRequest}
                className="min-h-[48px] rounded-xl border border-[var(--color-error)]/30 bg-[var(--color-error-bg)]/20 px-3 py-3 text-sm font-medium text-[var(--color-error)] transition-colors hover:bg-[var(--color-error-bg)]/35"
              >
                Kill
              </button>
            </div>
          )}

          <div className="rounded-2xl border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-3 shadow-xl">
            <div className="flex items-center gap-2">
              <label htmlFor="session-message-input-mobile" className="sr-only">
                Mobile session message input
              </label>
              <input
                id="session-message-input-mobile"
                ref={mobileMsgInputRef}
                type="text"
                value={msgInput}
                onChange={(e) => setMsgInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Send a message to Claude…"
                disabled={sending || !h.alive}
                className="flex-1 min-h-[48px] rounded-xl border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-3 font-mono text-sm text-gray-200 placeholder-gray-600 focus:border-[var(--color-accent-cyan)] focus:outline-none disabled:opacity-50"
              />

              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !msgInput.trim() || !h.alive}
                className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 p-3 text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20 disabled:cursor-not-allowed disabled:opacity-30"
                title="Send message"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileToolsOpen((current) => !current)}
                className="min-h-[44px] rounded-full border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                {mobileToolsOpen ? 'Hide tools' : 'More tools'}
              </button>
              <span className="text-xs text-gray-500">
                {needsApproval
                  ? 'Approve, reject, escape, and kill stay pinned above.'
                  : 'Quick actions stay within thumb reach.'}
              </span>
            </div>

            {mobileToolsOpen && (
              <div className="mt-3 border-t border-[var(--color-void-lighter)]/50 pt-3">
                {renderCommandTools('mobile')}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={killConfirmOpen}
        title="Kill session?"
        message="This will stop the Claude Code session and close the terminal."
        confirmLabel="Kill"
        variant="danger"
        onConfirm={() => {
          void handleKill();
        }}
        onCancel={() => setKillConfirmOpen(false)}
      />

      <SaveTemplateModal
        open={saveTemplateModalOpen}
        onClose={() => setSaveTemplateModalOpen(false)}
        sessionId={id ?? ''}
      />
    </div>
  );
}
