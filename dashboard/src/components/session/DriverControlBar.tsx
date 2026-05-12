/**
 * components/session/DriverControlBar.tsx — Driver/observer control bar.
 *
 * Shows current driver, observers, and actions:
 * - No driver: "Claim Driver" button
 * - Current user is driver: "Release Driver" + "Transfer" buttons
 * - Another user is driver: "Request Transfer" button (operator/admin)
 * - Observer list with role badges
 *
 * TODO: Wire to real hook once ACP-028 + ACP-064 land.
 */

import { useState } from 'react';
import {
  Gamepad2,
  Eye,
  ArrowRightLeft,
  Loader2,
  User,
  Users,
} from 'lucide-react';
import type { AcpSessionParticipants } from '../../types/acp-driver-observer';
import { ROLE_COLORS } from '../../types/acp-driver-observer';
import { useT } from '../../i18n/context';

export interface DriverControlBarProps {
  participants: AcpSessionParticipants | null;
  currentUserId?: string;
  isDriver: boolean;
  isLoading?: boolean;
  error?: string | null;
  onClearError?: () => void;
  onClaim?: () => Promise<void>;
  onRelease?: () => Promise<void>;
  onTransfer?: (targetSubscriberId: string, reason?: string) => Promise<void>;
  /** Current user's role for capability checks. */
  userRole?: 'driver' | 'observer' | 'operator' | 'admin';
}

export function DriverControlBar({
  participants,
  currentUserId,
  isDriver,
  isLoading = false,
  error = null,
  onClearError,
  onClaim,
  onRelease,
  onTransfer,
  userRole = 'observer',
}: DriverControlBarProps) {
    const t = useT();

  const [showTransferForm, setShowTransferForm] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [transferReason, setTransferReason] = useState('');

  const canAct = !isLoading;
  const canOperate = userRole === 'operator' || userRole === 'admin';
  const hasDriver = participants?.driver !== null && participants?.driver !== undefined;

  const handleTransfer = async () => {
    if (!transferTarget.trim() || !onTransfer) return;
    await onTransfer(transferTarget.trim(), transferReason.trim() || undefined);
    setTransferTarget('');
    setTransferReason('');
    setShowTransferForm(false);
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3"
      role="toolbar"
      aria-label={t("aria.sessionDriverControls")}
    >
      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded bg-red-500/10 px-3 py-2 text-sm text-red-400" role="alert">
          <span className="flex-1">{error}</span>
          {onClearError && (
            <button
              onClick={onClearError}
              className="text-red-400 hover:text-red-300"
              aria-label={t("aria.dismissError")}
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Current driver indicator */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gamepad2 className="h-4 w-4 text-blue-400" />
          {hasDriver ? (
            <span className="text-sm text-[var(--color-text-primary)]">
              Driver: <span className="font-medium">{participants!.driver!.subscriberId}</span>
              {isDriver && (
                <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${ROLE_COLORS.driver.bg} ${ROLE_COLORS.driver.text}`}>
                  You
                </span>
              )}
            </span>
          ) : (
            <span className="text-sm text-[var(--color-text-muted)] opacity-60">No driver claimed</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {participants && (
            <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] opacity-60">
              <Users className="h-3 w-3" />
              {participants.activeCount} connected
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {!hasDriver && (
          <button
            onClick={() => onClaim?.()}
            disabled={!canAct}
            className="flex items-center gap-2 rounded-md bg-blue-500/20 px-3 py-2 text-sm font-medium text-blue-400 transition-colors hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={t("aria.claimDriver")}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gamepad2 className="h-4 w-4" />}
            Claim Driver
          </button>
        )}

        {isDriver && (
          <>
            <button
              onClick={() => onRelease?.()}
              disabled={!canAct}
              className="flex items-center gap-2 rounded-md border border-[var(--color-border-strong)] px-3 py-2 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-50"
              aria-label={t("aria.releaseDriver")}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Release (become observer)
            </button>
            <button
              onClick={() => setShowTransferForm(true)}
              disabled={!canAct}
              className="flex items-center gap-2 rounded-md bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
              aria-label={t("aria.transferDriver")}
            >
              <ArrowRightLeft className="h-4 w-4" />
              Transfer
            </button>
          </>
        )}

        {hasDriver && !isDriver && canOperate && (
          <button
            onClick={() => setShowTransferForm(true)}
            disabled={!canAct}
            className="flex items-center gap-2 rounded-md bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
            aria-label={t("aria.requestTransfer")}
          >
            <ArrowRightLeft className="h-4 w-4" />
            Request Transfer
          </button>
        )}
      </div>

      {/* Transfer form */}
      {showTransferForm && (
        <div className="flex flex-col gap-2 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-void)] p-3">
          <label htmlFor="transfer-target" className="text-xs text-[var(--color-text-muted)]">
            Transfer driver to (subscriber ID)
          </label>
          <input
            id="transfer-target"
            type="text"
            value={transferTarget}
            onChange={(e) => setTransferTarget(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleTransfer()}
            placeholder="Enter subscriber ID"
            className="w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-warning)]/50 focus:outline-none"
            autoFocus
          />
          <label htmlFor="transfer-reason" className="text-xs text-[var(--color-text-muted)]">
            Reason (optional)
          </label>
          <input
            id="transfer-reason"
            type="text"
            value={transferReason}
            onChange={(e) => setTransferReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleTransfer()}
            placeholder="e.g., switching to mobile"
            className="w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-warning)]/50 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleTransfer}
              disabled={!transferTarget.trim() || isLoading}
              className="flex items-center gap-1 rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
              aria-label={t("aria.confirmTransfer")}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
              Transfer
            </button>
            <button
              onClick={() => { setShowTransferForm(false); setTransferTarget(''); setTransferReason(''); }}
              className="rounded-md border border-[var(--color-border-strong)] px-3 py-2 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
              aria-label={t("aria.cancelTransfer")}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Observers list */}
      {participants && participants.observers.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)] opacity-60">
            Observers ({participants.observers.length})
          </span>
          <div className="flex flex-wrap gap-1" role="list" aria-label={t("aria.sessionObservers")}>
            {participants.observers.map((obs) => (
              <span
                key={obs.subscriberId}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${ROLE_COLORS.observer.bg} ${ROLE_COLORS.observer.text}`}
                role="listitem"
                title={obs.metadata ? JSON.stringify(obs.metadata) : obs.subscriberId}
              >
                <User className="h-3 w-3" />
                {obs.subscriberId === currentUserId ? 'You' : obs.subscriberId}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
