/**
 * pages/SessionDetailPage.tsx — Session detail with live terminal, tabs, and controls.
 */

import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import type { AuditRecord, ParsedEntry } from '../types';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
} from 'lucide-react';
import {
  fetchAuditLogs,
  sendMessage,
  sendCommand,
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
import { useSessionIntervention } from '../hooks/useSessionIntervention';
import { useSessionApproval } from '../hooks/useSessionApproval';
import { SessionHeader } from '../components/session/SessionHeader';
import { CliShortcutsPanel } from '../components/session/CliShortcutsPanel';
import { PauseControlBar } from '../components/session/PauseControlBar';
import { DriverControlBar } from '../components/session/DriverControlBar';
import { useSessionParticipants } from '../hooks/useSessionParticipants';
import { useSessionTimeline } from '../hooks/useSessionTimeline';
const SessionTimelineView = lazy(() => import('../components/session/SessionTimelineView').then(m => ({ default: m.SessionTimelineView })));
const StreamTab = lazy(() => import('../components/session/StreamTab').then(m => ({ default: m.StreamTab })));
const SessionMetricsPanel = lazy(() => import('../components/session/SessionMetricsPanel').then(m => ({ default: m.SessionMetricsPanel })));
import { LatencyPanel } from '../components/metrics/LatencyPanel';
const AuditTrailPanel = lazy(() => import('../components/session/AuditTrailPanel').then(m => ({ default: m.AuditTrailPanel })));
import { ApprovalBanner } from '../components/session/ApprovalBanner';
import { AcpApprovalModal } from '../components/session/AcpApprovalModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PendingQuestionCard } from '../components/session/PendingQuestionCard';
const PRStatusPanel = lazy(() => import('../components/session/PRStatusPanel').then(m => ({ default: m.PRStatusPanel })));
const DiffViewer = lazy(() => import('../components/session/DiffViewer').then(m => ({ default: m.DiffViewer })));
import { PermissionPromptSheet } from '../components/session/PermissionPromptSheet';
import SaveTemplateModal from '../components/SaveTemplateModal';
import { sanitizeErrorMessage } from '../utils/sanitizeErrorMessage';
import { getSessionMessages } from '../api/client';
import { useT } from '../i18n/context';

function TabLoadingFallback() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--color-accent)]" />
    </div>
  );
}

interface ScreenshotState {
  image: string;
  mimeType?: string;
  capturedAt: number;
}

type TabId = 'stream' | 'metrics' | 'audit' | 'timeline' | 'pr' | 'diff';

const COMMON_SLASH_COMMANDS = ['/clear', '/compact', '/cost', '/config'] as const;

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const t = useT();
  const [activeTab, setActiveTab] = useState<TabId>('stream');
  const [saveTemplateModalOpen, setSaveTemplateModalOpen] = useState(false);
  const {
    session, health, notFound, loading,
    latency, latencyLoading,
  } = useSessionPolling(id ?? '');

  const TABS: { id: TabId; label: string }[] = [
    { id: 'stream', label: t('sessionDetail.stream') },
    { id: 'metrics', label: t('sessionDetail.metrics') },
    { id: 'audit', label: t('sessionDetail.audit') },
    { id: 'timeline', label: t('sessionDetail.timeline') },
    { id: 'pr', label: t('sessionDetail.pr') },
    { id: 'diff', label: t('sessionDetail.diff') },
  ];

  const {
    intervention,
    isLoading: interventionLoading,
    error: interventionError,
    pause,
    intervene,
    completeIntervention,
    resume,
    clearError,
  } = useSessionIntervention(id ?? '');

  const {
    pendingApproval,
    isLoading: approvalLoading,
    error: approvalError,
    countdown: approvalCountdown,
    isExpired: approvalExpired,
    approve: approveAcp,
    reject: rejectAcp,
    clearError: clearApprovalError,
  } = useSessionApproval(id ?? '');

  const {
    participants,
    isDriver,
    isLoading: participantsLoading,
    error: participantsError,
    claim: claimDriverRole,
    release: releaseDriverRole,
    transfer: transferDriverRole,
    clearError: clearParticipantsError,
  } = useSessionParticipants(id ?? '', session?.ownerKeyId ?? undefined);

  const {
    events: timelineEvents,
    isLoading: timelineLoading,
    error: timelineError,
    clearError: clearTimelineError,
  } = useSessionTimeline(id ?? '');

  const [msgInput, setMsgInput] = useState('');
  const [sending, setSending] = useState(false);
  const sendHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [selectedSlashCommand, setSelectedSlashCommand] = useState<string>(COMMON_SLASH_COMMANDS[0]);
  const [slashSending, setSlashSending] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [killConfirmOpen, setKillConfirmOpen] = useState(false);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const [screenshotUnsupported, setScreenshotUnsupported] = useState(false);
  const [screenshot, setScreenshot] = useState<ScreenshotState | null>(null);
  const [fullBleed, setFullBleed] = useState(false);
  const fullBleedRef = useRef(false);
  fullBleedRef.current = fullBleed;
  const [mobileFooterHeight, setMobileFooterHeight] = useState(0);
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [prEntries, setPrEntries] = useState<ParsedEntry[]>([]);
  const [prLoading, setPrLoading] = useState(false);
  const desktopMsgInputRef = useRef<HTMLInputElement>(null);
  const mobileMsgInputRef = useRef<HTMLInputElement>(null);
  const mobileFooterRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const handleSendRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const handleInterruptRef = useRef<() => void>(() => {});
  const addToast = useToastStore((t_store) => t_store.addToast);

  function getVisibleMessageInput(): HTMLInputElement | null {
    const candidates = [desktopMsgInputRef.current, mobileMsgInputRef.current].filter(
      (input): input is HTMLInputElement => input !== null,
    );
    return candidates.find((input) => input.offsetParent !== null) ?? candidates[0] ?? null;
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (document.activeElement === getVisibleMessageInput()) {
          e.preventDefault();
          void handleSendRef.current();
        }
        return;
      }

      if (e.key === 'f' && !isTyping) {
        e.preventDefault();
        setFullBleed((v) => !v);
        return;
      }

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
        setAuditError(sanitizeErrorMessage(err, 'Failed to load audit trail'));
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeTab, id]);

  useEffect(() => {
    if (activeTab !== 'pr' || !id) return;

    let cancelled = false;
    setPrLoading(true);

    getSessionMessages(id)
      .then((data) => {
        if (cancelled) return;
        setPrEntries(data.messages);
      })
      .catch(() => {
        if (!cancelled) setPrEntries([]);
      })
      .finally(() => {
        if (!cancelled) setPrLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeTab, id]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6 animate-pulse">
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
      <div className="min-h-screen bg-[var(--color-void)] flex flex-col items-center justify-center text-[var(--color-text-muted)] overscroll-contain">
        <div className="text-6xl mb-4">404</div>
        <div className="text-lg mb-6 text-[var(--color-text-primary)]">{t('sessionDetail.notFound')}</div>
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
          content: t('sessionDetail.pendingQuestionContent'),
          options: null,
          since: s.lastActivity,
        }
      : undefined
  );

  function handleApprove() {
    approve(s.id).catch((e: unknown) =>
      addToast('error', t('sessionDetail.approveFailed'), e instanceof Error ? e.message : undefined),
    );
  }
  function handleReject() {
    reject(s.id).catch((e: unknown) =>
      addToast('error', t('sessionDetail.rejectFailed'), e instanceof Error ? e.message : undefined),
    );
  }
  function handleInterrupt() {
    interrupt(s.id).catch((e: unknown) =>
      addToast('error', t('sessionDetail.interruptFailed'), e instanceof Error ? e.message : undefined),
    );
  }
  async function handleFork() {
    try {
      const forked = await forkSession(s.id, { name: undefined });
      addToast('success', t('sessionDetail.forkedToast'), t('sessionDetail.forkedToastDescription', { id: forked.id.slice(0, 8) }));
      navigate(`/sessions/${forked.id}`);
    } catch (e: unknown) {
      addToast('error', t('sessionDetail.forkFailed'), e instanceof Error ? e.message : undefined);
    }
  }
  function handleEscape() {
    escape(s.id).catch((e: unknown) =>
      addToast('error', t('sessionDetail.escapeFailed'), e instanceof Error ? e.message : undefined),
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
      addToast('error', t('sessionDetail.failedKill'), e instanceof Error ? e.message : undefined);
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
      addToast('success', t('sessionDetail.screenshotCaptured'));
    } catch (e: unknown) {
      const maybeStatus = typeof e === 'object' && e !== null && 'statusCode' in e
        ? (e as { statusCode?: number }).statusCode
        : undefined;

      if (maybeStatus === 501) {
        setScreenshotUnsupported(true);
        addToast('warning', t('sessionDetail.screenshotUnavailable'), t('sessionDetail.screenshotUnavailableDescription'));
      } else {
        addToast('error', t('sessionDetail.screenshotFailed'), e instanceof Error ? e.message : undefined);
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
      const hist = sendHistoryRef.current;
      if (hist[hist.length - 1] !== text) hist.push(text);
      if (hist.length > 50) hist.shift();
      historyIndexRef.current = -1;
    } catch (e: unknown) {
      addToast('error', t('sessionDetail.sendFailed'), e instanceof Error ? e.message : undefined);
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
      addToast('error', t('sessionDetail.sendSlashFailed'), e instanceof Error ? e.message : undefined);
    } finally {
      setSlashSending(false);
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

  handleSendRef.current = handleSend;
  handleInterruptRef.current = handleInterrupt;

  function renderCommandTools(layout: 'desktop' | 'mobile') {
    const isMobile = layout === 'mobile';
    const idSuffix = isMobile ? 'mobile' : 'desktop';
    const containerClass = isMobile
      ? 'grid gap-2'
      : 'flex flex-wrap items-center gap-2';
    const selectClass = isMobile
      ? 'min-h-[44px] w-full rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] focus:border-[var(--color-accent-cyan)] focus:outline-none disabled:opacity-50'
      : 'min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] focus:border-[var(--color-accent-cyan)] focus:outline-none disabled:opacity-50';
    const buttonClass = isMobile
      ? 'min-h-[44px] w-full rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-lighter)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-30'
      : 'min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-lighter)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-30';
    const accentButtonClass = isMobile
      ? 'min-h-[44px] w-full rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-info-bg-dark)] px-3 py-2 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-info-bg)] disabled:cursor-not-allowed disabled:opacity-30'
      : 'min-h-[44px] rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-info-bg-dark)] px-3 py-2 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-info-bg)] disabled:cursor-not-allowed disabled:opacity-30';

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
          title={t('sessionDetail.sessionInsertSlashCommandInput')}
        >
          {t('sessionDetail.insertSlash')}
        </button>

        <button
          type="button"
          onClick={handleSendSlashCommand}
          disabled={slashSending || !h.alive}
          className={accentButtonClass}
          title={t('sessionDetail.sessionSendSlashCommand')}
        >
          {slashSending ? t('sessionDetail.sendingSlash') : t('sessionDetail.runSlash')}
        </button>

        {!screenshotUnsupported && (
          <button
            type="button"
            onClick={handleCaptureScreenshot}
            disabled={capturingScreenshot || !h.alive}
            className={buttonClass}
            title={t('sessionDetail.sessionCaptureScreenshot')}
          >
            {capturingScreenshot ? t('sessionDetail.capturing') : t('sessionDetail.screenshot')}
          </button>
        )}

        {!isMobile && (
          <>
            <button
              type="button"
              onClick={handleInterrupt}
              aria-label={t('sessionDetail.interrupt')}
              className={buttonClass}
              title={t('sessionDetail.sessionInterruptCtrlC')}
            >
              {t('sessionDetail.interrupt')}
            </button>
            <button
              type="button"
              onClick={handleEscape}
              aria-label={t('sessionDetail.escape')}
              className={buttonClass}
              title={t('sessionDetail.sessionSendEscape')}
            >
              {t('sessionDetail.escape')}
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

          <PauseControlBar
            sessionStatus={s.status}
            interventionStatus={intervention?.status ?? null}
            isLoading={interventionLoading}
            error={interventionError}
            onClearError={clearError}
            onPause={(reason) => pause({ reason })}
            onIntervene={intervene}
            onCompleteIntervention={(guidance) => completeIntervention({ guidance })}
            onResume={() => resume()}
          />

          <DriverControlBar
            participants={participants}
            currentUserId={session?.ownerKeyId ?? undefined}
            isDriver={isDriver}
            isLoading={participantsLoading}
            error={participantsError}
            onClearError={clearParticipantsError}
            onClaim={() => claimDriverRole()}
            onRelease={() => releaseDriverRole()}
            onTransfer={(targetSubscriberId, reason) => transferDriverRole({ targetSubscriberId, reason })}
            userRole="observer"
          />

          <div className="relative flex gap-2 py-1 overflow-x-auto scrollbar-none" role="tablist" aria-label="Session detail tabs">
            {TABS.map((tab) => (
              <button type="button"
                key={tab.id}
                id={`tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                className={`relative z-10 min-h-[36px] rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
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

            {pendingApproval && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 sm:p-4"
              >
                <AcpApprovalModal
                  approval={pendingApproval}
                  countdown={approvalCountdown}
                  isExpired={approvalExpired}
                  isLoading={approvalLoading}
                  error={approvalError}
                  onClearError={clearApprovalError}
                  onApprove={approveAcp}
                  onReject={rejectAcp}
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
                  <Suspense fallback={<TabLoadingFallback />}>
                    <StreamTab sessionId={s.id} isDriver={isDriver} />
                  </Suspense>
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
                  <Suspense fallback={<TabLoadingFallback />}>
                    <SessionMetricsPanel sessionId={s.id} />
                  </Suspense>
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
                  <Suspense fallback={<TabLoadingFallback />}>
                    <AuditTrailPanel records={auditRecords} loading={auditLoading} error={auditError} />
                  </Suspense>
                </motion.div>
              )}

              {activeTab === 'timeline' && (
                <motion.div
                  key="panel-timeline"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  id="panel-timeline"
                  role="tabpanel"
                  aria-labelledby="tab-timeline"
                  tabIndex={0}
                  className={fullBleed ? 'h-full min-h-[200px]' : 'h-[calc(100vh-300px)] min-h-[200px] sm:h-[calc(100vh-420px)] sm:min-h-[300px]'}
                >
                  <Suspense fallback={<TabLoadingFallback />}>
                    <SessionTimelineView
                    events={timelineEvents}
                    isLoading={timelineLoading}
                  />
                  </Suspense>
                  {timelineError && (
                    <div className="absolute bottom-2 left-2 right-2 rounded-md bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
                      {timelineError}
                      <button
                        type="button"
                        onClick={clearTimelineError}
                        className="ml-2 underline"
                      >
                        {t('sessionDetail.dismiss')}
                      </button>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'pr' && (
                <motion.div
                  key="panel-pr"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  id="panel-pr"
                  role="tabpanel"
                  aria-labelledby="tab-pr"
                  tabIndex={0}
                  className="p-4"
                >
                  <Suspense fallback={<TabLoadingFallback />}>
                    <PRStatusPanel
                    entries={prEntries}
                    isLoading={prLoading}
                  />
                  </Suspense>
                </motion.div>
              )}

              {activeTab === 'diff' && (
                <motion.div
                  key="panel-diff"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  id="panel-diff"
                  role="tabpanel"
                  aria-labelledby="tab-diff"
                  tabIndex={0}
                  className="p-4"
                >
                  <Suspense fallback={<TabLoadingFallback />}>
                    <DiffViewer
                    entries={prEntries}
                    isLoading={prLoading}
                  />
                  </Suspense>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <CliShortcutsPanel sessionId={s.id} createdAt={s.createdAt} />

          {/* Desktop session composer */}
          <div className="hidden rounded-b-lg border border-t-0 border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-3 sm:block animate-bento-reveal">
            {pendingQuestion && (
              <PendingQuestionCard
                pendingQuestion={pendingQuestion}
                onSelectOption={handleSelectQuestionOption}
              />
            )}

            <div className={`flex items-center gap-3 ${pendingQuestion ? 'mt-4' : ''}`}>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title={t('sessionDetail.sessionInsertSlashCommand')}
                  onClick={() => { setMsgInput((v) => v || '/'); getVisibleMessageInput()?.focus(); }}
                  disabled={!h.alive}
                  className="inline-flex h-8 w-8 items-center justify-center rounded text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-void-lighter)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
                  aria-label={t('sessionDetail.sessionSlashCommand')}
                >
                  <span className="text-sm font-mono font-bold">/</span>
                </button>
                {!screenshotUnsupported && (
                  <button
                    type="button"
                    title={t('sessionDetail.sessionCaptureScreenshot')}
                    onClick={handleCaptureScreenshot}
                    disabled={capturingScreenshot || !h.alive}
                    className="inline-flex h-8 w-8 items-center justify-center rounded text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-void-lighter)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
                    aria-label={t('sessionDetail.sessionCaptureScreenshot')}
                  >
                    <span className="text-xs">⬛</span>
                  </button>
                )}
                <button
                  type="button"
                  title={t('sessionDetail.sessionSendEscape')}
                  onClick={handleEscape}
                  disabled={!h.alive}
                  className="inline-flex h-8 items-center justify-center rounded px-1.5 text-[10px] font-mono text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-void-lighter)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
                  aria-label={t('sessionDetail.sessionSendEscape')}
                >
                  Esc
                </button>
                <button
                  type="button"
                  title={t('sessionDetail.sessionInterruptCtrlC')}
                  onClick={handleInterrupt}
                  disabled={!h.alive}
                  className="inline-flex h-8 items-center justify-center rounded px-1.5 text-[10px] font-mono text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-void-lighter)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
                  aria-label={t('sessionDetail.sessionInterruptCtrlC')}
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
                placeholder={t('sessionDetail.sendPlaceholder')}
                disabled={sending || !h.alive}
                className="flex-1 min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-cta-bg)] focus:outline-none disabled:opacity-50"
              />

              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !msgInput.trim() || !h.alive}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-[var(--color-cta-bg)]/50 bg-[var(--color-cta-bg)]/15 p-2.5 text-[var(--color-cta-bg)] transition-all hover:bg-[var(--color-cta-bg)]/30 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={t('sessionDetail.sessionSendMessageCmd')}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>

            {s.createdAt && (Date.now() - s.createdAt < 60_000) && !msgInput && (
              <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">
                <kbd className="rounded border border-[var(--color-void-lighter)] px-1 font-mono text-[10px]">⌘↵</kbd>{' '}
                {t('sessionDetail.toSend')} · {t('sessionDetail.tryLabel')}{' '}
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
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  {t('sessionDetail.latestScreenshot')}
                </h3>
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  {new Date(screenshot.capturedAt).toLocaleTimeString()}
                </span>
              </div>
              <img
                src={screenshot.image}
                alt="Session screenshot preview"
                className="max-h-[420px] w-full rounded border border-[var(--color-void-lighter)] bg-black object-contain"
              />
              <div className="mt-2 text-[11px] text-[var(--color-text-muted)]">
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-2xl border border-[var(--color-void-lighter)] bg-[var(--color-void)] p-2">
              <button
                type="button"
                onClick={handleInterrupt}
                className="min-h-[48px] rounded-xl border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-3 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                {t('sessionDetail.interrupt')}
              </button>
              <button
                type="button"
                onClick={handleEscape}
                className="min-h-[48px] rounded-xl border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-3 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                {t('sessionDetail.escape')}
              </button>
              <button
                type="button"
                onClick={handleKillRequest}
                className="min-h-[48px] rounded-xl border border-[var(--color-error)]/30 bg-[var(--color-error-bg)]/20 px-3 py-3 text-sm font-medium text-[var(--color-error)] transition-colors hover:bg-[var(--color-error-bg)]/35"
              >
                {t('sessionDetail.killLabel')}
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
                placeholder={t('sessionDetail.sendPlaceholder')}
                disabled={sending || !h.alive}
                className="flex-1 min-h-[48px] rounded-xl border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-3 font-mono text-sm text-[var(--color-text-primary)] placeholder-gray-600 focus:border-[var(--color-accent-cyan)] focus:outline-none disabled:opacity-50"
              />

              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !msgInput.trim() || !h.alive}
                className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 p-3 text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={t('sessionDetail.sessionSendMessage')}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileToolsOpen((current) => !current)}
                className="min-h-[44px] rounded-full border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                {mobileToolsOpen ? t('sessionDetail.hideTools') : t('sessionDetail.moreTools')}
              </button>
              <span className="text-xs text-[var(--color-text-muted)]">
                {needsApproval
                  ? t('sessionDetail.approvalPinned')
                  : t('sessionDetail.quickActionsPinned')}
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
        title={t('sessionDetail.killSessionTitle')}
        message={t('sessionDetail.killSessionMessage')}
        confirmLabel={t('sessionDetail.killLabel')}
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
