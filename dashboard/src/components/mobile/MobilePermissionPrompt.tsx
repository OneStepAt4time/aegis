/**
 * components/mobile/MobilePermissionPrompt.tsx
 * Mobile-optimized permission prompt with swipe gestures, haptics, and long-press.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PendingPermissionInfo } from '../../types';
import { useSwipeGesture } from '../../hooks/useSwipeGesture';
import { useHaptics } from '../../hooks/useHaptics';

const FALLBACK_PERMISSION_TIMEOUT_MS = 10 * 60 * 1000;
const LONG_PRESS_DURATION = 500;

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

interface MobilePermissionPromptProps {
  prompt: string;
  pendingPermission?: PendingPermissionInfo;
  permissionPromptAt?: number;
  onApprove: () => void;
  onReject: () => void;
  onViewDetails?: () => void;
  onJumpToTranscript?: () => void;
}

export function MobilePermissionPrompt({
  prompt,
  pendingPermission,
  permissionPromptAt,
  onApprove,
  onReject,
  onViewDetails,
  onJumpToTranscript,
}: MobilePermissionPromptProps) {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [rippleOrigin, setRippleOrigin] = useState<{ x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const haptics = useHaptics();

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

  const handleSwipe = (direction: 'left' | 'right', touchPoint: { x: number; y: number }) => {
    if (direction === 'right') {
      setRippleOrigin(touchPoint);
      haptics.approve();
      setTimeout(() => {
        onApprove();
        setRippleOrigin(null);
      }, 300);
    } else if (direction === 'left') {
      haptics.reject();
      onReject();
    }
  };

  useSwipeGesture({
    onSwipe: (direction, touchPoint) => {
      if (direction === 'left' || direction === 'right') {
        handleSwipe(direction, touchPoint);
      }
    },
    threshold: 80,
    enabled: !showContextMenu,
  });

  const handleTouchStart = (e: React.TouchEvent) => {
    e.touches[0]; // Capture first touch
    longPressTimerRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate([10]);
      setShowContextMenu(true);
    }, LONG_PRESS_DURATION);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Permission prompt"
      className="relative overflow-hidden rounded-t-2xl border border-[var(--color-warning)]/35 bg-[var(--color-surface)] p-4 shadow-2xl"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* Swipe hint indicators */}
      <div className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 opacity-30 pointer-events-none">
        <span className="text-[var(--color-danger)] text-xl">←</span>
        <span className="text-[10px] text-[var(--color-danger)]">reject</span>
      </div>
      <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 opacity-30 pointer-events-none">
        <span className="text-[10px] text-[var(--color-success)]">approve</span>
        <span className="text-[var(--color-success)] text-xl">→</span>
      </div>

      {/* Ripple effect on approve */}
      <AnimatePresence>
        {rippleOrigin && (
          <motion.div
            initial={{ scale: 0, opacity: 0.6 }}
            animate={{ scale: 20, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="absolute rounded-full bg-[var(--color-success)]"
            style={{
              left: rippleOrigin.x,
              top: rippleOrigin.y,
              width: 20,
              height: 20,
              transform: 'translate(-50%, -50%)',
            }}
          />
        )}
      </AnimatePresence>

      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[var(--color-void-lighter)]" />

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-warning)]">
            Permission required
          </div>
          <h2 className="mt-1 text-base font-semibold text-[var(--color-text-primary)]">
            Swipe to respond
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

      <div className="mt-3 text-center text-xs text-[var(--color-text-secondary)]">
        Swipe right to approve • Swipe left to reject • Long-press for options
      </div>

      {/* Context menu on long-press */}
      <AnimatePresence>
        {showContextMenu && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[var(--color-void)] p-4"
          >
            {onViewDetails && (
              <button
                type="button"
                onClick={() => {
                  setShowContextMenu(false);
                  onViewDetails();
                }}
                className="w-full min-h-[48px] rounded-xl border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
              >
                View Details
              </button>
            )}
            {onJumpToTranscript && (
              <button
                type="button"
                onClick={() => {
                  setShowContextMenu(false);
                  onJumpToTranscript();
                }}
                className="w-full min-h-[48px] rounded-xl border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
              >
                Jump to Transcript
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowContextMenu(false)}
              className="w-full min-h-[48px] rounded-xl border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-4 py-3 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            >
              Cancel
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
