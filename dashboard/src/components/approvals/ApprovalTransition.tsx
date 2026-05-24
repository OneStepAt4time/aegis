/**
 * components/approvals/ApprovalTransition.tsx — Flash animation on approval state change.
 *
 * Shows a brief green (approved) or red (rejected) flash overlay when
 * a session transitions from awaiting_approval.
 */

import { useEffect, useState } from 'react';

interface ApprovalTransitionProps {
  /** Previous status to detect transition */
  previousStatus: string;
  /** Current status */
  currentStatus: string;
  /** Duration of the flash in ms (default 1200) */
  durationMs?: number;
}

export function ApprovalTransition({
  previousStatus,
  currentStatus,
  durationMs = 1200,
}: ApprovalTransitionProps) {
  const [flash, setFlash] = useState<'approved' | 'rejected' | null>(null);

  useEffect(() => {
    if (previousStatus === 'awaiting_approval') {
      if (currentStatus === 'idle' || currentStatus === 'working') {
        setFlash('approved');
      } else if (currentStatus === 'killed' || currentStatus === 'crashed') {
        setFlash('rejected');
      }
    }
  }, [previousStatus, currentStatus]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), durationMs);
    return () => clearTimeout(timer);
  }, [flash, durationMs]);

  if (!flash) return null;

  const bgColor = flash === 'approved'
    ? 'bg-[var(--color-success)]/20'
    : 'bg-[var(--color-danger)]/20';
  const borderColor = flash === 'approved'
    ? 'border-[var(--color-success)]/40'
    : 'border-[var(--color-danger)]/40';

  return (
    <div
      className={`pointer-events-none absolute inset-0 animate-[fadeOut_1.2s_ease-out_forwards] rounded-lg border ${borderColor} ${bgColor}`}
      aria-hidden="true"
    />
  );
}
