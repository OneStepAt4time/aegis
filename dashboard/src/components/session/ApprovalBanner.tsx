import { useState } from 'react';
import { motion } from 'framer-motion';

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
    <motion.div 
      initial={{ opacity: 0, scale: 0.98, background: 'rgba(245, 158, 11, 0.05)' }}
      animate={{ 
        opacity: 1, 
        scale: 1,
        boxShadow: ['0 0 0px rgba(245, 158, 11, 0)', '0 0 15px rgba(245, 158, 11, 0.2)', '0 0 0px rgba(245, 158, 11, 0)'],
        borderColor: ['rgba(245, 158, 11, 0.2)', 'rgba(245, 158, 11, 0.5)', 'rgba(245, 158, 11, 0.2)']
      }}
      transition={{ 
        boxShadow: { repeat: Infinity, duration: 3, ease: 'easeInOut' },
        borderColor: { repeat: Infinity, duration: 3, ease: 'easeInOut' },
        scale: { type: "spring", bounce: 0.4, duration: 0.6 }
      }}
      className="flex flex-col gap-3 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-void-dark)]/90 backdrop-blur-md px-4 py-4 sm:flex-row sm:items-center sm:justify-between shadow-lg relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--color-warning)]/5 to-transparent pointer-events-none" />

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
            <span className="rounded-full border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-2.5 py-0.5 font-mono text-[10px] text-zinc-300">
              TTL {countdownLabel}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
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
          onClick={onApprove}
          className="min-h-[44px] min-w-[90px] rounded-lg border border-[var(--color-success)]/40 bg-[var(--color-success)]/20 px-4 py-2 text-xs font-semibold tracking-wide text-[var(--color-success)] transition-colors hover:bg-[var(--color-success)]/30 hover:border-[var(--color-success)]/60 shadow-[0_0_15px_rgba(34,197,94,0.15)] hover:shadow-[0_0_20px_rgba(34,197,94,0.3)]"
        >
          APPROVE
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          type="button"
          onClick={onReject}
          className="min-h-[44px] min-w-[90px] rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold tracking-wide text-red-400 transition-colors hover:bg-red-500/20 hover:border-red-500/50"
        >
          REJECT
        </motion.button>
      </div>
    </motion.div>
  );
}
