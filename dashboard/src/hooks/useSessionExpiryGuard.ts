/**
 * hooks/useSessionExpiryGuard.ts — Detects session cookie expiry and shows re-auth modal.
 *
 * Polls the auth state periodically. When the user was authenticated but
 * the session cookie expires (1h TTL from backend), shows a re-auth prompt
 * instead of silently redirecting to login.
 *
 * This hook does NOT handle OIDC sessions (those use their own refresh flow).
 */

import { useEffect, useCallback, useRef, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';

const CHECK_INTERVAL_MS = 5 * 60_000; // Check every 5 minutes

export interface SessionExpiryState {
  /** True when the session has expired and user needs to re-authenticate. */
  isExpired: boolean;
  /** Reset the expired state (called after successful re-auth). */
  reset: () => void;
}

export function useSessionExpiryGuard(): SessionExpiryState {
  const [isExpired, setIsExpired] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Subscribe to auth state — reset expiry when user successfully re-authenticates
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (isExpired && isAuthenticated) {
      setIsExpired(false);
    }
  }, [isExpired, isAuthenticated]);

  const check = useCallback(async () => {
    const state = useAuthStore.getState();
    // Only guard cookie-based sessions (no in-memory token)
    if (!state.isAuthenticated || state.token) return;
    // OIDC has its own refresh flow
    if (state.authMode === 'oidc') return;

    try {
      // Revalidate checks if the session cookie is still valid
      const valid = await state.revalidate(true);
      if (!valid) {
        setIsExpired(true);
      }
    } catch {
      // Network error — don't show expiry, might be transient
    }
  }, []);

  useEffect(() => {
    // Initial check after a short delay (don't race with init)
    const initialTimeout = setTimeout(check, 10_000);

    intervalRef.current = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [check]);

  const reset = useCallback(() => {
    setIsExpired(false);
  }, []);

  return { isExpired, reset };
}
