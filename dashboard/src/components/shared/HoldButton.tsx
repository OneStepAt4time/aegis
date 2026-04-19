/**
 * components/shared/HoldButton.tsx
 *
 * A button that fires `onConfirm` only after the user holds it for
 * `holdDuration` ms (default: 800 ms). Releasing before the threshold
 * cancels. A radial progress ring shows hold progress.
 *
 * Usage:
 *   <HoldButton onConfirm={handleKill} aria-label="Hold to kill session">
 *     Kill
 *   </HoldButton>
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface HoldButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onMouseDown' | 'onMouseUp' | 'onTouchStart' | 'onTouchEnd'> {
  /** Callback fired after holding for `holdDuration` ms. */
  onConfirm: () => void;
  /** Hold duration in ms. Default: 800 */
  holdDuration?: number;
  children: ReactNode;
  /** Visual variant. Default: 'danger' */
  variant?: 'danger' | 'default';
}

const RING_SIZE = 20;
const STROKE = 2.5;
const RADIUS = (RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function HoldButton({
  onConfirm,
  holdDuration = 800,
  children,
  variant = 'danger',
  className,
  disabled,
  ...rest
}: HoldButtonProps) {
  const [progress, setProgress] = useState(0);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const variantClass =
    variant === 'danger'
      ? 'border-[var(--color-danger)]/30 bg-[var(--color-error-bg)]/20 text-[var(--color-danger)] hover:bg-[var(--color-error-bg)]/40'
      : 'border-[var(--color-void-lighter)] bg-[var(--color-void-lighter)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]';

  const stopHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    startTimeRef.current = null;
    firedRef.current = false;
    setProgress(0);
  }, []);

  const startHold = useCallback(() => {
    if (disabled || firedRef.current) return;
    firedRef.current = false;
    startTimeRef.current = Date.now();

    holdTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - (startTimeRef.current ?? Date.now());
      const pct = Math.min(elapsed / holdDuration, 1);
      setProgress(pct);

      if (pct >= 1 && !firedRef.current) {
        firedRef.current = true;
        if (holdTimerRef.current) clearInterval(holdTimerRef.current);
        holdTimerRef.current = null;
        setProgress(0);
        onConfirm();
      }
    }, 16);
  }, [disabled, holdDuration, onConfirm]);

  // Clean up on unmount
  useEffect(() => () => { stopHold(); }, [stopHold]);

  const strokeDashoffset = CIRCUMFERENCE * (1 - progress);
  const ringColor = variant === 'danger' ? 'var(--color-danger)' : 'var(--color-cta-bg)';
  const isHolding = progress > 0;

  return (
    <button
      type="button"
      className={`relative inline-flex min-h-[44px] select-none items-center justify-center gap-1.5 rounded border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${variantClass} ${className ?? ''}`}
      onMouseDown={startHold}
      onMouseUp={stopHold}
      onMouseLeave={stopHold}
      onTouchStart={startHold}
      onTouchEnd={stopHold}
      disabled={disabled}
      {...rest}
    >
      {isHolding && (
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          className="absolute inset-0 m-auto"
          aria-hidden="true"
          style={{ opacity: 0.85 }}
        >
          {/* Track */}
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            opacity={0.2}
          />
          {/* Progress arc */}
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={ringColor}
            strokeWidth={STROKE}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          />
        </svg>
      )}
      <span className={isHolding ? 'opacity-40' : ''}>{children}</span>
    </button>
  );
}

export default HoldButton;
