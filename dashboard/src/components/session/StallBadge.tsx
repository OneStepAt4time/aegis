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

export interface StallBadgeProps {
  payload: Partial<StallEventPayload>;
  className?: string;
}

const STALL_COLOR_CLASSES: Record<'amber' | 'red', string> = {
  amber: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  red: 'border-red-500/40 bg-red-500/10 text-red-200',
};

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
 * Renders nothing useful (returns null) when no payload is provided — caller
 * should guard with a presence check on the upstream event.
 */
export function StallBadge({ payload, className }: StallBadgeProps) {
  const label = formatStallClassLabel(payload.errorClass);
  const subLabel = formatStallSubLabel(payload);
  const exhausted = isRecoveryExhausted(payload);
  const disabled = isRecoveryDisabled(payload);
  const tooltip = formatStallTooltip(payload);

  // Color: amber for transient_5xx (retry-eligible), red for others (more severe).
  const colorKey: 'amber' | 'red' =
    payload.errorClass === 'transient_5xx' ? 'amber' : 'red';
  const colorClasses = STALL_COLOR_CLASSES[colorKey];

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
