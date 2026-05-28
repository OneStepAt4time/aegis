/**
 * session-detail/MessageFooter.tsx — Desktop + mobile message input area with slash commands.
 */

import { useState } from 'react';
import { Send } from 'lucide-react';
import { sendCommand } from '../../api/client';
import { useToastStore } from '../../store/useToastStore';
import { useT } from '../../i18n/context';
import { PendingQuestionCard } from '../../components/session/PendingQuestionCard';
import { PermissionPromptSheet } from '../../components/session/PermissionPromptSheet';
import type { ScreenshotState } from './types';
import { COMMON_SLASH_COMMANDS } from './types';
import type { SessionInfo, SessionHealth } from '../../types';

interface PendingQuestion {
  toolUseId: string;
  content: string;
  options: string[] | null;
  since: number;
}

interface MessageFooterProps {
  session: SessionInfo;
  health: SessionHealth;
  msgInput: string;
  setMsgInput: React.Dispatch<React.SetStateAction<string>>;
  sending: boolean;
  handleSend: () => Promise<void>;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  getVisibleMessageInput: () => HTMLInputElement | null;
  desktopMsgInputRef: React.RefObject<HTMLInputElement | null>;
  mobileMsgInputRef: React.RefObject<HTMLInputElement | null>;
  pendingQuestion?: PendingQuestion | null;
  screenshot: ScreenshotState | null;
  capturingScreenshot: boolean;
  screenshotUnsupported: boolean;
  handleCaptureScreenshot: () => Promise<void>;
  handleInterrupt: () => void;
  handleEscape: () => void;
  handleKillRequest: () => void;
  killConfirmOpen: boolean;
  mobileFooterRef: React.RefObject<HTMLDivElement | null>;
}

export function MessageFooter({
  session,
  health,
  msgInput,
  setMsgInput,
  sending,
  handleSend,
  handleKeyDown,
  getVisibleMessageInput,
  desktopMsgInputRef,
  mobileMsgInputRef,
  pendingQuestion,
  screenshot,
  capturingScreenshot,
  screenshotUnsupported,
  handleCaptureScreenshot,
  handleInterrupt,
  handleEscape,
  handleKillRequest,
  mobileFooterRef,
}: MessageFooterProps) {
  const t = useT();
  const addToast = useToastStore((t_store) => t_store.addToast);
  const s = session;
  const h = health;
  const needsApproval = h.status === 'permission_prompt' || h.status === 'bash_approval';

  const [selectedSlashCommand, setSelectedSlashCommand] = useState<string>(COMMON_SLASH_COMMANDS[0]);
  const [slashSending, setSlashSending] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  function handleSelectQuestionOption(option: string) {
    setMsgInput(option);
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

  function handleInsertSlashCommand() {
    setMsgInput(selectedSlashCommand);
    getVisibleMessageInput()?.focus();
  }

  function renderCommandTools(layout: 'desktop' | 'mobile') {
    const isMobile = layout === 'mobile';
    const idSuffix = isMobile ? 'mobile' : 'desktop';
    const containerClass = isMobile
      ? 'grid gap-2'
      : 'flex flex-wrap items-center gap-2';
    const selectClass = isMobile
      ? 'min-h-[44px] w-full rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] focus:border-[var(--color-accent-cyan)] focus-visible:outline-none disabled:opacity-50'
      : 'min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] focus:border-[var(--color-accent-cyan)] focus-visible:outline-none disabled:opacity-50';
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
    <>
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
            className="flex-1 min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-cta-bg)] focus-visible:outline-none disabled:opacity-50"
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
          <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
            <kbd className="rounded border border-[var(--color-void-lighter)] px-1 font-mono text-[10px]">⌘↵</kbd>{' '}
            {t('sessionDetail.toSend')} · {t('sessionDetail.tryLabel')}{' '}
            <button
              type="button"
              className="min-h-[28px] inline-flex items-center rounded px-1.5 py-0.5 text-[var(--color-accent-cyan)] hover:underline hover:bg-[var(--color-void-lighter)]/30"
              onClick={() => { setMsgInput('/help'); getVisibleMessageInput()?.focus(); }}
            >
              /help
            </button>{' '}·{' '}
            <button
              type="button"
              className="min-h-[28px] inline-flex items-center rounded px-1.5 py-0.5 text-[var(--color-accent-cyan)] hover:underline hover:bg-[var(--color-void-lighter)]/30"
              onClick={() => { setMsgInput('/status'); getVisibleMessageInput()?.focus(); }}
            >
              /status
            </button>{' '}·{' '}
            <button
              type="button"
              className="min-h-[28px] inline-flex items-center rounded px-1.5 py-0.5 text-[var(--color-accent-cyan)] hover:underline hover:bg-[var(--color-void-lighter)]/30"
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
            <span className="text-xs text-[var(--color-text-muted)]">
              {new Date(screenshot.capturedAt).toLocaleTimeString()}
            </span>
          </div>
          <img
            src={screenshot.image}
            alt="Session screenshot preview"
            className="max-h-[420px] w-full rounded border border-[var(--color-void-lighter)] bg-black object-contain"
          />
          <div className="mt-2 text-xs text-[var(--color-text-muted)]">
            {screenshot.mimeType ?? 'image/png'}
          </div>
        </div>
      )}

      {/* Mobile footer */}
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
              pendingPermission={s.pendingPermission}
              permissionPromptAt={s.permissionPromptAt ?? undefined}
              onApprove={() => {}} // handled by parent
              onReject={() => {}}  // handled by parent
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
                className="flex-1 min-h-[48px] rounded-xl border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-3 font-mono text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-placeholder)] focus:border-[var(--color-accent-cyan)] focus-visible:outline-none disabled:opacity-50"
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
    </>
  );
}
