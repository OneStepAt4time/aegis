/**
 * components/session/SendContinueButton.tsx — Issue #4802 AC3b: manual recovery button.
 *
 * Renders a "Send continue" button that calls POST /v1/sessions/:id/resume
 * (via useSessionIntervention's `resume` action) when auto-recovery has
 * given up.
 *
 * Visibility (per close-path canonical issuecomment-4767577518):
 * - Visible ONLY when stall payload is present AND `recoveryAttemptCount >= recoveryMaxAttempts`
 *   (i.e., auto-recovery has hit the cap and given up).
 * - Hidden when stall payload is missing (Path 2 default — pre-F-9 typed payload not yet wired).
 * - Hidden when `recoveryDisabled === true` (operator paused auto-recovery; the AC3b button
 *   is redundant in that case since auto-recovery is already paused).
 *
 * Renderer-only gating, no renderer-side computation that bypasses server config.
 */

import { useStore } from '../../store/useStore';
import { useSessionIntervention } from '../../hooks/useSessionIntervention';
import { isRecoveryExhausted, isRecoveryDisabled } from '../../utils/stallClassLabels';

export interface SendContinueButtonProps {
  sessionId: string;
  className?: string;
}

/**
 * "Send continue" button. Renders null when AC3b gating conditions are not met.
 */
export function SendContinueButton({ sessionId, className }: SendContinueButtonProps) {
  const stallPayload = useStore((s: { stallMap: Record<string, import('../../api/schemas').StallEventPayload> }) => s.stallMap[sessionId]);
  const { resume, isLoading, error, clearError } = useSessionIntervention(sessionId);

  // AC3b gating: only visible when (1) typed payload present, (2) recovery exhausted,
  // (3) kill-switch NOT engaged.
  if (!stallPayload) return null;
  if (!isRecoveryExhausted(stallPayload)) return null;
  if (isRecoveryDisabled(stallPayload)) return null;

  const handleClick = () => {
    clearError();
    void resume();
  };

  return (
    <div className={['flex items-center gap-2', className ?? ''].filter(Boolean).join(' ')}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        aria-label="Send continue (manual recovery after auto-recovery gave up)"
        className={[
          'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium',
          'border-amber-500/40 bg-amber-500/10 text-amber-200',
          'hover:bg-amber-500/20 focus:outline-none focus:ring-2 focus:ring-amber-400/40',
          'disabled:cursor-not-allowed disabled:opacity-60',
        ].join(' ')}
      >
        {isLoading ? 'Sending…' : 'Send continue'}
      </button>
      {error && (
        <span className="text-xs text-[var(--color-danger)]" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export default SendContinueButton;
