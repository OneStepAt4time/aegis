/**
 * components/session/StallBadge.tsx — Issue #4802: typed stall pill.
 *
 * Renders a pill from a typed `StallEventPayload` (mirror of server
 * `src/stall-events.ts`). Path 2 defensive: works on free-form emits
 * (legacy `status.stall` event with `detail: string`) by falling back to
 * a generic "Stalled" label.
 *
 * Pill text: ErrorClass label (e.g. "Transient 5xx", "Permission Timeout")
 * Pill sub-label: "X/Y (auto-recovering…)" or "X/Y — intervention required"
 * Kill-switch overlay icon: when `recoveryDisabled === true`
 * Tooltip: composed metadata (errorClass + statusCode + timestamps + sub-label)
 *
 * Color:
 * - `transient_5xx` → amber (retry-eligible, expected behavior)
 * - others → red (more severe, requires attention)
 */

import type { StallEventPayload } from '../../api/schemas';
import {
  formatStallClassLabel,
  formatStallSubLabel,
  isRecoveryExhausted,
  isRecoveryDisabled,
  formatStallTooltip,
} from '../../utils/stallClassLabels';
import { getStatusStyle } from '../../utils/statusStyles';

export interface StallBadgeProps {
  payload: Partial<StallEventPayload>;
  className?: string;
}

/**
 * Compact "kill-switch" indicator icon (operator paused auto-recovery for
 * this session). Rendered as an inline overlay on the stall pill.
 */
function KillSwitchIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'inline-block h-3.5 w-3.5'}
      aria-label="Auto-recovery paused (operator kill-switch)"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
      <circle cx="8" cy="8" r="6" />
    </svg>
  );
}

/**
 * Stall pill with errorClass label + sub-label + kill-switch overlay.
 *
 * Returns null when the payload has no useful stall data to display
 * (no errorClass AND no recoveryDisabled AND no recovery counter). This
 * mirrors the SendContinueButton L36 pattern: always-conditional component
 * integration — never render a "Stalled" pill for healthy sessions.
 *
 * Caller should still guard with a presence check on the upstream event
 * (e.g. `{stallPayload && <StallBadge .../>}` in SessionHeader), but the
 * component itself is defensive against empty payloads.
 */
export function StallBadge({ payload, className }: StallBadgeProps) {
  // No useful stall data: empty payload, no errorClass, no kill-switch,
  // and no recovery counter → do not render a misleading "Stalled" pill.
  const hasErrorClass = payload.errorClass !== undefined && payload.errorClass !== null;
  const hasRecoveryCounter =
    (payload.recoveryAttemptCount ?? 0) > 0 || (payload.recoveryMaxAttempts ?? 0) > 0;
  const hasMeaningfulData =
    hasErrorClass || payload.recoveryDisabled === true || hasRecoveryCounter;
  if (!hasMeaningfulData) return null;

  const label = formatStallClassLabel(payload.errorClass);
  const subLabel = formatStallSubLabel(payload);
  const exhausted = isRecoveryExhausted(payload);
  const disabled = isRecoveryDisabled(payload);
  const tooltip = formatStallTooltip(payload);

  // Color from the centralized §4 status map: transient_5xx is retry-eligible
  // (warning/amber, mapped via `stalled`); other classes are more severe (danger/red).
  const colorClasses =
    payload.errorClass === 'transient_5xx'
      ? getStatusStyle('stalled').className
      : getStatusStyle('error').className;

  // Subtle visual cue when cap is reached: slight ring outline.
  const ringClass = exhausted ? 'ring-1 ring-amber-400/40' : '';

  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5',
        colorClasses,
        ringClass,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={tooltip}
      aria-label={`Session stall: ${label}`}
      data-stall-exhausted={exhausted || undefined}
      data-stall-disabled={disabled || undefined}
    >
      <span className="text-xs font-medium">{label}</span>
      {subLabel && (
        <span className="text-[10px] font-normal opacity-80">{subLabel}</span>
      )}
      {disabled && (
        <KillSwitchIcon className="h-3 w-3 opacity-90" />
      )}
    </span>
  );
}

export default StallBadge;
