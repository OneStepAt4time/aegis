import { useState } from 'react';

const AUTO_APPROVE_MODES = new Set([
  'bypassPermissions',
  'dontAsk',
  'acceptEdits',
  'plan',
  'auto',
]);

interface ApprovalBannerProps {
  prompt: string;
  permissionMode?: string;
  countdownLabel?: string | null;
  onApprove?: () => void;
  onReject?: () => void;
}

export function ApprovalBanner({
  prompt,
  permissionMode,
  countdownLabel,
  onApprove,
  onReject,
}: ApprovalBannerProps) {
  const [expanded, setExpanded] = useState(false);

  if (permissionMode && permissionMode !== 'default' && AUTO_APPROVE_MODES.has(permissionMode)) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--color-success)]/30 bg-[var(--color-success-bg)]/50 px-4 py-2 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-success)]">
          Auto-approved ({permissionMode})
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning-dark)]/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-lg text-[var(--color-warning)]">⚠</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-warning)]">
            Permission required
          </span>
          {countdownLabel && (
            <span className="rounded-full border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-primary)]">
              TTL {countdownLabel}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className={`mt-2 w-full cursor-pointer text-left font-mono text-sm text-[var(--color-text-primary)] ${
            expanded ? 'break-words' : 'truncate'
          }`}
          title={expanded ? 'Collapse prompt' : 'Expand prompt'}
        >
          {prompt}
          {!expanded && prompt.length > 60 && <span className="ml-1 text-[#888]">…</span>}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onApprove}
          className="min-h-[44px] rounded border border-[var(--color-success)]/30 bg-[var(--color-success-bg)] px-3 py-2 text-xs font-medium text-[var(--color-success)] transition-colors hover:bg-[var(--color-success-bg-hover)]"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={onReject}
          className="min-h-[44px] rounded border border-[var(--color-error)]/30 bg-[var(--color-error-bg)] px-3 py-2 text-xs font-medium text-[var(--color-error)] transition-colors hover:bg-[var(--color-error-bg-hover)]"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
