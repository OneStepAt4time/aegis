/**
 * components/session/AcpApprovalModal.tsx — ACP-native approval modal.
 *
 * Displays a pending tool approval request with:
 * - Tool name and risk level badge
 * - Tool description and input preview
 * - TTL countdown timer
 * - Approve / Reject buttons with optional reason
 * - Expired state handling
 */

import { useState } from 'react';
import {
  ShieldCheck,
  ShieldX,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Wrench,
} from 'lucide-react';
import type { AcpApprovalRequest } from '../../types/acp-approval';
import { RISK_LEVEL_CONFIG } from '../../types/acp-approval';
import { useT } from '../../i18n/context';

export interface AcpApprovalModalProps {
  approval: AcpApprovalRequest;
  countdown?: string | null;
  isExpired?: boolean;
  isLoading?: boolean;
  error?: string | null;
  onClearError?: () => void;
  onApprove?: (reason?: string) => Promise<void>;
  onReject?: (reason?: string) => Promise<void>;
}

function ToolInputPreview({ input }: { input?: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);

  if (!input || Object.keys(input).length === 0) return null;

  const preview = JSON.stringify(input, null, 2);
  const isLong = preview.length > 200;
  const displayText = isLong && !expanded ? preview.slice(0, 200) + '…' : preview;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] opacity-60 transition-opacity hover:opacity-100"
        aria-expanded={expanded}
        aria-controls="tool-input-preview"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? 'Hide' : 'Show'} tool input
      </button>
      <pre
        id="tool-input-preview"
        className={`mt-1 overflow-auto rounded-md border border-[var(--color-border-strong)] bg-[var(--color-void)] p-3 font-mono text-xs text-[var(--color-text-muted)] ${isLong && !expanded ? 'max-h-24' : 'max-h-48'}`}
      >
        {displayText}
      </pre>
    </div>
  );
}

export function AcpApprovalModal({
  approval,
  countdown,
  isExpired = false,
  isLoading = false,
  error = null,
  onClearError,
  onApprove,
  onReject,
}: AcpApprovalModalProps) {
    const t = useT();

  const [rejectReason, setRejectReason] = useState('');
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [approveReason, setApproveReason] = useState('');
  const [showApproveReason, setShowApproveReason] = useState(false);

  const { tool } = approval;
  const riskConfig = tool.riskLevel ? RISK_LEVEL_CONFIG[tool.riskLevel] : null;

  const handleApprove = async () => {
    if (!onApprove) return;
    await onApprove(approveReason.trim() || undefined);
    setApproveReason('');
    setShowApproveReason(false);
  };

  const handleReject = async () => {
    if (!onReject) return;
    await onReject(rejectReason.trim() || undefined);
    setRejectReason('');
    setShowRejectReason(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("aria.toolApprovalRequired")}
      className="flex flex-col gap-3 rounded-xl border border-[var(--color-warning)]/35 bg-[var(--color-surface)] p-4 shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Wrench className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-warning)]" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--color-warning)]">
              Tool Approval Required
            </div>
            <h2 className="mt-0.5 text-base font-semibold text-[var(--color-text-primary)]">
              {tool.toolName}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {riskConfig && (
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${riskConfig.bg} ${riskConfig.text} ${riskConfig.border}`}>
              {riskConfig.label}
            </span>
          )}
          {countdown !== null && countdown !== undefined && (
            <div className={`rounded-full border px-2.5 py-0.5 text-right ${isExpired ? 'border-red-500/30 bg-red-500/10' : 'border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10'}`}>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-warning)]">
                TTL
              </div>
              <div className={`font-mono text-xs ${isExpired ? 'text-red-400' : 'text-[var(--color-text-primary)]'}`}>
                {isExpired ? 'Expired' : countdown}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 text-sm text-[var(--color-text-primary)]">
        {tool.description}
      </p>

      {/* Tool input preview */}
      <ToolInputPreview input={tool.input} />

      {/* Expired warning */}
      {isExpired && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>This approval request has expired.</span>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400" role="alert">
          <span className="flex-1">{error}</span>
          {onClearError && (
            <button onClick={onClearError} className="text-red-400 hover:text-red-300" aria-label={t("aria.dismissError")}>
              ✕
            </button>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2">
        {!isExpired ? (
          <>
            {/* Approve/Reject buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleApprove}
                disabled={isLoading}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--color-success)]/30 bg-[var(--color-success-bg)] px-4 py-3 text-sm font-semibold text-[var(--color-success)] transition-colors hover:bg-[var(--color-success-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={t("aria.approveTool")}
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Approve
              </button>
              <button
                type="button"
                onClick={() => setShowRejectReason(true)}
                disabled={isLoading}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--color-error)]/30 bg-[var(--color-error-bg)] px-4 py-3 text-sm font-semibold text-[var(--color-error)] transition-colors hover:bg-[var(--color-error-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={t("aria.rejectTool")}
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldX className="h-4 w-4" />}
                Reject
              </button>
            </div>

            {/* Approve reason (optional expand) */}
            {!showRejectReason && (
              <button
                type="button"
                onClick={() => setShowApproveReason((prev) => !prev)}
                className="self-start text-xs text-[var(--color-text-muted)] opacity-60 transition-opacity hover:opacity-100"
              >
                {showApproveReason ? '▼ Hide' : '▶ Add approval reason (optional)'}
              </button>
            )}
            {showApproveReason && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label htmlFor="approve-reason" className="mb-1 block text-xs text-[var(--color-text-muted)] opacity-60">
                    Approval reason (for audit log)
                  </label>
                  <input
                    id="approve-reason"
                    type="text"
                    value={approveReason}
                    onChange={(e) => setApproveReason(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleApprove()}
                    placeholder="e.g., reviewed the command"
                    className="w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-void)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-success)]/50 focus:outline-none"
                    autoFocus
                  />
                </div>
              </div>
            )}

            {/* Reject reason form */}
            {showRejectReason && (
              <div className="flex flex-col gap-2">
                <label htmlFor="reject-reason" className="text-xs text-[var(--color-text-muted)] opacity-60">
                  Rejection reason (optional, for audit log)
                </label>
                <input
                  id="reject-reason"
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleReject()}
                  placeholder="e.g., unsafe command"
                  className="w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-void)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-danger)]/50 focus:outline-none"
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleReject}
                    disabled={isLoading}
                    className="flex items-center gap-1 rounded-md bg-red-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-400 disabled:opacity-50"
                    aria-label={t("aria.confirmRejection")}
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldX className="h-4 w-4" />}
                    Confirm Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowRejectReason(false); setRejectReason(''); }}
                    className="rounded-md border border-[var(--color-border-strong)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => onReject?.()}
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-error)]/30 bg-[var(--color-error-bg)] px-4 py-3 text-sm font-semibold text-[var(--color-error)] transition-colors hover:bg-[var(--color-error-bg-hover)] disabled:opacity-50"
            aria-label={t("aria.dismissExpired")}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldX className="h-4 w-4" />}
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
