import { useEffect, useMemo, useState } from 'react';
import type { PendingPermissionInfo } from '../../types';

const FALLBACK_PERMISSION_TIMEOUT_MS = 10 * 60 * 1000;

function clampRemaining(deadline: number | null): number | null {
  if (deadline === null) return null;
  return Math.max(0, deadline - Date.now());
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface PermissionPromptSheetProps {
  prompt: string;
  pendingPermission?: PendingPermissionInfo;
  permissionPromptAt?: number;
  onApprove: () => void;
  onReject: () => void;
  onEscape: () => void;
  onKill: () => void;
}

export function PermissionPromptSheet({
  prompt,
  pendingPermission,
  permissionPromptAt,
  onApprove,
  onReject,
  onEscape,
  onKill,
}: PermissionPromptSheetProps) {
  const deadline = useMemo(() => {
    if (pendingPermission) return pendingPermission.expiresAt;
    if (permissionPromptAt) return permissionPromptAt + FALLBACK_PERMISSION_TIMEOUT_MS;
    return null;
  }, [pendingPermission, permissionPromptAt]);

  const [remainingMs, setRemainingMs] = useState<number | null>(() => clampRemaining(deadline));

  useEffect(() => {
    setRemainingMs(clampRemaining(deadline));
    if (deadline === null) return undefined;

    const timer = window.setInterval(() => {
      setRemainingMs(clampRemaining(deadline));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [deadline]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Permission prompt"
      className="rounded-t-2xl border border-[var(--color-warning)]/35 bg-[var(--color-surface)] p-4 shadow-2xl"
    >
      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[var(--color-void-lighter)]" />

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-warning)]">
            Permission required
          </div>
          <h2 className="mt-1 text-base font-semibold text-[var(--color-text-primary)]">
            Review before continuing
          </h2>
        </div>

        {remainingMs !== null && (
          <div className="rounded-full border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3 py-1 text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-warning)]">
              TTL
            </div>
            <div className="font-mono text-sm text-[var(--color-text-primary)]">
              {remainingMs > 0 ? formatCountdown(remainingMs) : 'expired'}
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 break-words rounded-xl border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-3 font-mono text-sm text-[var(--color-text-primary)]">
        {pendingPermission?.prompt ?? prompt}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onApprove}
          className="min-h-[48px] rounded-xl border border-[var(--color-success)]/30 bg-[var(--color-success-bg)] px-4 py-3 text-sm font-semibold text-[var(--color-success)] transition-colors hover:bg-[var(--color-success-bg-hover)]"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={onReject}
          className="min-h-[48px] rounded-xl border border-[var(--color-error)]/30 bg-[var(--color-error-bg)] px-4 py-3 text-sm font-semibold text-[var(--color-error)] transition-colors hover:bg-[var(--color-error-bg-hover)]"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={onEscape}
          className="min-h-[48px] rounded-xl border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-4 py-3 text-sm font-medium text-gray-200 transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          Escape
        </button>
        <button
          type="button"
          onClick={onKill}
          className="min-h-[48px] rounded-xl border border-[var(--color-error)]/30 bg-[var(--color-error-bg)]/20 px-4 py-3 text-sm font-medium text-[var(--color-error)] transition-colors hover:bg-[var(--color-error-bg)]/35"
        >
          Kill
        </button>
      </div>
    </div>
  );
}
