/**
 * pages/SessionDetailPage.tsx — Session detail with live terminal, tabs, and controls.
 * Refactored: hooks and sub-components extracted to src/pages/session-detail/.
 */

import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { ErrorBoundary } from '../components/shared/ErrorBoundary';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  quickApprove,
  quickReject,
  interrupt,
  escape,
  killSession,
  forkSession,
} from '../api/client';
import { useToastStore } from '../store/useToastStore';
import { useStore } from '../store/useStore';
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
import { StaleDataBanner } from '../components/shared/StaleDataBanner';
import { AcpApprovalModal } from '../components/session/AcpApprovalModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
const PRStatusPanel = lazy(() => import('../components/session/PRStatusPanel').then(m => ({ default: m.PRStatusPanel })));
const DiffViewer = lazy(() => import('../components/session/DiffViewer').then(m => ({ default: m.DiffViewer })));
import SaveTemplateModal from '../components/SaveTemplateModal';
import { useT } from '../i18n/context';

// Extracted modules
import type { TabId } from './session-detail/types';
import { SessionMetadataPanel } from '../components/session/SessionMetadataPanel';
import { TabBar } from './session-detail/TabBar';
import { useAuditData } from './session-detail/useAuditData';
import { useMessageInput } from './session-detail/useMessageInput';
import { useScreenshot } from './session-detail/useScreenshot';
import { MessageFooter } from './session-detail/MessageFooter';

function TabLoadingFallback() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--color-cta-bg)]" />
    </div>
  );
}

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const t = useT();
  const addToast = useToastStore((t_store) => t_store.addToast);
  const sseError = useStore((s) => s.sseError);

  const [activeTab, setActiveTab] = useState<TabId>('stream');
  const [saveTemplateModalOpen, setSaveTemplateModalOpen] = useState(false);
  const [killConfirmOpen, setKillConfirmOpen] = useState(false);
  const [fullBleed, setFullBleed] = useState(false);
  const fullBleedRef = useRef(false);
  fullBleedRef.current = fullBleed;
  const [mobileFooterHeight, setMobileFooterHeight] = useState(0);
  const mobileFooterRef = useRef<HTMLDivElement>(null);

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
    { id: 'metadata', label: t('sessionDetail.metadata') },
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

  // Extracted hooks
  const { auditRecords, auditLoading, auditError, prEntries, prLoading } = useAuditData(activeTab, id);
  const {
    msgInput, setMsgInput, sending, handleSend, handleKeyDown,
    getVisibleMessageInput, desktopMsgInputRef, mobileMsgInputRef,
  } = useMessageInput(id ?? '');
  const { screenshot, capturingScreenshot, screenshotUnsupported, handleCaptureScreenshot } = useScreenshot(id ?? '');

  // Refs for keyboard shortcuts
  const handleSendRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const handleInterruptRef = useRef<() => void>(() => {});

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

  // Keyboard shortcuts
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
  }, [getVisibleMessageInput]);

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

  // Action handlers
  function handleApprove() {
    quickApprove(s.id).catch((e: unknown) =>
      addToast('error', t('sessionDetail.approveFailed'), e instanceof Error ? e.message : undefined),
    );
  }
  function handleReject() {
    quickReject(s.id).catch((e: unknown) =>
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

  handleSendRef.current = handleSend;
  handleInterruptRef.current = handleInterrupt;

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

          {sseError && <StaleDataBanner error={sseError} />}

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

          <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

          <div
            className="card-glass overflow-hidden animate-bento-reveal relative"
            data-fullbleed={fullBleed ? 'true' : undefined}
            style={fullBleed ? { height: 'calc(100vh - 120px)', minHeight: 300 } : { minHeight: 300 }}
          >
            {needsApproval && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="block p-3 pb-0 sm:p-4"
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
              <ErrorBoundary>
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
              </ErrorBoundary>
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
                  <ErrorBoundary><Suspense fallback={<TabLoadingFallback />}>
                    <StreamTab sessionId={s.id} isDriver={isDriver} />
                  </Suspense></ErrorBoundary>
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
                  <ErrorBoundary><Suspense fallback={<TabLoadingFallback />}>
                    <SessionMetricsPanel sessionId={s.id} />
                  </Suspense></ErrorBoundary>
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
                  <ErrorBoundary><Suspense fallback={<TabLoadingFallback />}>
                    <AuditTrailPanel records={auditRecords} loading={auditLoading} error={auditError} />
                  </Suspense></ErrorBoundary>
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
                  <ErrorBoundary><Suspense fallback={<TabLoadingFallback />}>
                    <SessionTimelineView
                    events={timelineEvents}
                    isLoading={timelineLoading}
                  />
                  </Suspense></ErrorBoundary>
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
                  <ErrorBoundary><Suspense fallback={<TabLoadingFallback />}>
                    <PRStatusPanel
                    entries={prEntries}
                    isLoading={prLoading}
                  />
                  </Suspense></ErrorBoundary>
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
                  <ErrorBoundary><Suspense fallback={<TabLoadingFallback />}>
                    <DiffViewer
                    entries={prEntries}
                    isLoading={prLoading}
                  />
                  </Suspense></ErrorBoundary>
                </motion.div>
              )}
              {activeTab === 'metadata' && (
                <motion.div
                  key="panel-metadata"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  id="panel-metadata"
                  role="tabpanel"
                  aria-labelledby="tab-metadata"
                  tabIndex={0}
                >
                  <ErrorBoundary>
                    <SessionMetadataPanel sessionId={id!} />
                  </ErrorBoundary>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <CliShortcutsPanel sessionId={s.id} createdAt={s.createdAt} />

          <MessageFooter
            session={s}
            health={h}
            msgInput={msgInput}
            setMsgInput={setMsgInput}
            sending={sending}
            handleSend={handleSend}
            handleKeyDown={handleKeyDown}
            getVisibleMessageInput={getVisibleMessageInput}
            desktopMsgInputRef={desktopMsgInputRef}
            mobileMsgInputRef={mobileMsgInputRef}
            pendingQuestion={pendingQuestion}
            screenshot={screenshot}
            capturingScreenshot={capturingScreenshot}
            screenshotUnsupported={screenshotUnsupported}
            handleCaptureScreenshot={handleCaptureScreenshot}
            handleInterrupt={handleInterrupt}
            handleEscape={handleEscape}
            handleKillRequest={handleKillRequest}
            killConfirmOpen={killConfirmOpen}
            mobileFooterRef={mobileFooterRef}
          />
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
