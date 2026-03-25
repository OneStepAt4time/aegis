interface ApprovalBannerProps {
  sessionId: string;
  prompt: string;
  autoApprove?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}

export function ApprovalBanner({ prompt, autoApprove, onApprove, onReject }: ApprovalBannerProps) {
  if (autoApprove) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-[#003322]/50 border border-[#00ff88]/30 rounded-lg text-sm">
        <span className="text-[#00ff88] font-semibold text-xs uppercase tracking-wider">
          ⚡ AUTO-APPROVED
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 bg-[#1a1a00]/60 border border-[#ffaa00]/40 rounded-lg">
      <div className="flex items-center gap-3 sm:gap-2 min-w-0">
        <span className="text-[#ffaa00] text-lg shrink-0">⚠</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-[#ffaa00] font-semibold uppercase tracking-wider mb-0.5">
            Permission Required
          </div>
          <div className="text-sm text-[#e0e0e0] truncate font-mono">
            {prompt}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onApprove}
          className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#003322] hover:bg-[#004433] text-[#00ff88] border border-[#00ff88]/30 transition-colors"
        >
          Approve
        </button>
        <button
          onClick={onReject}
          className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#331111] hover:bg-[#442222] text-[#ff3366] border border-[#ff3366]/30 transition-colors"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
