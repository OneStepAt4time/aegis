/**
 * components/approvals/ApprovalBanner.tsx — Inline approval banner for pending sessions.
 *
 * Shows approve/reject buttons when a session is in awaiting_approval state.
 * Part of the one-tap Telegram approval feature (phase 2).
 */

import { useState, useCallback } from 'react';
import { CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';
import { quickApprove, quickReject } from '../../api/client';
import { useToastStore } from '../../store/useToastStore';
import { useT } from '../../i18n/context';

interface ApprovalBannerProps {
  sessionId: string;
  sessionName?: string;
}

export function ApprovalBanner({ sessionId, sessionName }: ApprovalBannerProps) {
  const addToast = useToastStore((s) => s.addToast);
  const t = useT();
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [resolved, setResolved] = useState<'approved' | 'rejected' | null>(null);

  const handleApprove = useCallback(async () => {
    setIsApproving(true);
    try {
      await quickApprove(sessionId);
      setResolved('approved');
      addToast('success', 'Session approved', sessionName ?? sessionId);
    } catch (err) {
      addToast('error', 'Approval failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsApproving(false);
    }
  }, [sessionId, sessionName, addToast]);

  const handleReject = useCallback(async () => {
    setIsRejecting(true);
    try {
      await quickReject(sessionId);
      setResolved('rejected');
      addToast('info', 'Session rejected', sessionName ?? sessionId);
    } catch (err) {
      addToast('error', 'Rejection failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsRejecting(false);
    }
  }, [sessionId, sessionName, addToast]);

  if (resolved === 'approved') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-4 py-3 text-sm">
        <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" aria-hidden="true" />
        <span className="text-[var(--color-success)] font-medium">{t('approvalStatus.approved')}</span>
      </div>
    );
  }

  if (resolved === 'rejected') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-error-bg)]/10 px-4 py-3 text-sm">
        <XCircle className="h-4 w-4 text-[var(--color-danger)]" aria-hidden="true" />
        <span className="text-[var(--color-danger)] font-medium">{t('approvalStatus.rejected')}</span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
      aria-label={t('aria.sessionAwaitingApproval')}
    >
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-[var(--color-warning)]" aria-hidden="true" />
        <span className="text-sm font-medium text-[var(--color-text-primary)]">
          Awaiting approval
        </span>
        <span className="text-xs text-[var(--color-text-muted)] hidden sm:inline">
          — this session needs your approval to start
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleApprove}
          disabled={isApproving || isRejecting}
          className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-success)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-success)] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={`Approve session ${sessionName ?? sessionId}`}
        >
          {isApproving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          )}
          Approve
        </button>
        <button
          type="button"
          onClick={handleReject}
          disabled={isApproving || isRejecting}
          className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-error-bg)]/20 px-4 py-2 text-sm font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-error-bg)]/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={`Reject session ${sessionName ?? sessionId}`}
        >
          {isRejecting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <XCircle className="h-4 w-4" aria-hidden="true" />
          )}
          Reject
        </button>
      </div>
    </div>
  );
}
