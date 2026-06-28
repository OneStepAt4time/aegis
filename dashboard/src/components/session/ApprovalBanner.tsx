import { useState } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../i18n/context';

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
  onApprove?: () => void | Promise<void>;
  onReject?: () => void | Promise<void>;
}

export function ApprovalBanner({
  prompt,
  permissionMode,
  countdownLabel,
  onApprove,
  onReject,
}: ApprovalBannerProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleApprove = async () => {
    if (isLoading || !onApprove) return;
    setIsLoading(true);
    try { await onApprove(); } finally { setIsLoading(false); }
  };

  const handleReject = async () => {
    if (isLoading || !onReject) return;
    setIsLoading(true);
    try { await onReject(); } finally { setIsLoading(false); }
  };

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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] border-l-[3px] border-l-[var(--color-warning)] bg-[var(--color-surface)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between shadow-lg relative overflow-hidden"
    >
      <div className="absolute inset-0 pointer-events-none" />

      <div className="min-w-0 flex-1 relative z-10">
        <div className="flex flex-wrap items-center gap-3">
          <motion.span 
            animate={{ scale: [1, 1.2, 1] }} 
            transition={{ repeat: Infinity, duration: 2 }}
            className="shrink-0 text-xl text-[var(--color-warning)] drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]"
          >
            ⚠
          </motion.span>
          <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-warning)]">
            Permission Required
          </span>
          {countdownLabel && (
            <span className="rounded-full border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-2.5 py-0.5 font-mono text-[10px] text-[var(--color-text-primary)]">
              TTL {countdownLabel}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-label={t('aria.toggleApprovalDetails')}
          className={`mt-3 w-full cursor-pointer text-left font-mono text-sm text-[var(--color-text-primary)] hover:text-white transition-colors ${
            expanded ? 'break-words max-h-48 overflow-y-auto' : 'truncate'
          }`}
          title={expanded ? 'Collapse prompt' : 'Expand prompt'}
        >
          {prompt}
        </button>
      </div>

      <div className="flex items-center gap-2 relative z-10">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          type="button"
          onClick={handleApprove}
          disabled={isLoading}
          className="min-h-[44px] rounded border border-[var(--color-cta-bg)] bg-[var(--color-cta-bg)] px-4 py-2 text-[13px] font-semibold tracking-wide text-[var(--color-cta-text)] transition-colors hover:bg-[var(--color-cta-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? '…' : 'APPROVE'}
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          type="button"
          onClick={handleReject}
          disabled={isLoading}
          className="min-h-[44px] rounded border border-[var(--color-danger)] bg-transparent px-4 py-2 text-[13px] font-semibold tracking-wide text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? '…' : 'REJECT'}
        </motion.button>
      </div>
    </motion.div>
  );
}
