/**
 * components/ConnectionBanner.tsx — Thin top strip shown when SSE/WS disconnects.
 *
 * Shows animated retry countdown and auto-dismisses on reconnect.
 */

import { useEffect, useRef, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useStore } from '../store/useStore';

const COUNTDOWN_SECONDS = 5;

export function ConnectionBanner() {
  const sseConnected = useStore((s) => s.sseConnected);
  const sseError = useStore((s) => s.sseError);

  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [visible, setVisible] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Show banner when disconnected with an error, hide when connected
  useEffect(() => {
    if (!sseConnected && sseError) {
      setVisible(true);
      setCountdown(COUNTDOWN_SECONDS);
    } else if (sseConnected) {
      setVisible(false);
    }
  }, [sseConnected, sseError]);

  // Countdown tick
  useEffect(() => {
    if (!visible) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    setCountdown(COUNTDOWN_SECONDS);
    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // Reset so it loops (actual reconnect is handled by ResilientEventSource)
          return COUNTDOWN_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="fixed top-0 left-0 right-0 z-50 flex h-8 items-center justify-center gap-2 bg-[var(--color-warning)]/15 border-b border-[var(--color-warning)]/30 text-[var(--color-warning)] text-xs font-medium backdrop-blur-sm"
      data-testid="connection-banner"
    >
      <WifiOff className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>Reconnecting in {countdown}s…</span>
    </div>
  );
}

export default ConnectionBanner;
