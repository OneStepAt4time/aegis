import { useState } from 'react';

const AUTO_APPROVE_MODES = new Set(['bypassPermissions', 'dontAsk', 'acceptEdits', 'plan', 'auto']);

interface ApprovalBannerProps {
  prompt: string;
  permissionMode?: string;
  onApprove?: () => void;
  onReject?: () => void;
}

export function ApprovalBanner({ prompt, permissionMode, onApprove, onReject }: ApprovalBannerProps) {
  const [expanded, setExpanded] = useState(false);
  if (permissionMode && permissionMode !== 'default' && AUTO_APPROVE_MODES.has(permissionMode)) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-success-bg)]/50 border border-[var(--color-success)]/30 rounded-lg text-sm">
        <span className="text-[var(--color-success)] font-semibold text-xs uppercase tracking-wider">
          AUTO-APPROVED ({permissionMode})
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 bg-[var(--color-warning-dark)]/60 border border-[var(--color-warning)]/40 rounded-lg">
      <div className="flex items-center gap-3 sm:gap-2 min-w-0">
        <span className="text-[var(--color-warning)] text-lg shrink-0">âš </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-[var(--color-warning)] font-semibold uppercase tracking-wider mb-0.5">
            Permission Required
          </div>
          <div
            className={`text-sm text-[var(--color-text-primary)] font-mono cursor-pointer ${expanded ? '' : 'truncate'}`}
            onClick={() => setExpanded(!expanded)}
            title={expanded ? undefined : 'Click to expand'}
          >
            {prompt}
            {!expanded && prompt.length > 60 && <span className="text-[#888] ml-1">...</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onApprove}
          className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[var(--color-success-bg)] hover:bg-[var(--color-success-bg-hover)] text-[var(--color-success)] border border-[var(--color-success)]/30 transition-colors"
        >
          Approve
        </button>
        <button
          onClick={onReject}
          className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[var(--color-error-bg)] hover:bg-[var(--color-error-bg-hover)] text-[var(--color-error)] border border-[var(--color-error)]/30 transition-colors"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

