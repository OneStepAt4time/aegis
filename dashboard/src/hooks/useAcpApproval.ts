/**
 * hooks/useAcpApproval.ts — React hook for ACP approval flow.
 *
 * Manages pending approval state, countdown timer, and approve/reject actions.
 * Subscribes to SSE for approval_request events.
 *
 * @see AcpApprovalModal.tsx — the UI component that consumes this hook
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  approveTool,
  rejectTool,
  getPendingApproval,
} from '../api/acp-approval-client.js';
import type { AcpApprovalRequest } from '../types/acp-approval';

export interface UseAcpApprovalOptions {
  sessionId: string;
  /** Auto-fetch pending approval on mount (default: true). */
  autoFetch?: boolean;
  /** Auto-connect SSE for approval_request events (default: true). */
  autoConnect?: boolean;
}

export interface UseAcpApprovalReturn {
  /** Current pending approval, if any. */
  approval: AcpApprovalRequest | null;
  /** Human-readable countdown string (e.g., "02:30"). Null if no expiry. */
  countdown: string | null;
  /** Whether the approval has expired. */
  isExpired: boolean;
  /** Whether an approve/reject request is in flight. */
  isLoading: boolean;
  /** Error message from the last action. */
  error: string | null;
  /** Approve the pending tool with optional reason. */
  approve: (reason?: string) => Promise<void>;
  /** Reject the pending tool with optional reason. */
  reject: (reason?: string) => Promise<void>;
  /** Clear the current error. */
  clearError: () => void;
}

/** Format milliseconds to MM:SS countdown. */
function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function useAcpApproval({
  sessionId,
  autoFetch = true,
  autoConnect = true,
}: UseAcpApprovalOptions): UseAcpApprovalReturn {
  const [approval, setApproval] = useState<AcpApprovalRequest | null>(null);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch pending approval on mount
  useEffect(() => {
    if (!autoFetch) return;

    let cancelled = false;
    getPendingApproval(sessionId)
      .then((pending) => {
        if (!cancelled) setApproval(pending);
      })
      .catch(() => {
        // Ignore fetch errors on mount — SSE will deliver updates
      });

    return () => { cancelled = true; };
  }, [sessionId, autoFetch]);

  // SSE subscription for approval_request events
  useEffect(() => {
    if (!autoConnect) return;

    const baseUrl = import.meta.env.VITE_AEGIS_URL ?? '';
    const url = `${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/sse`;
    const es = new EventSource(url);
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'approval_request' && event.approval) {
          setApproval(event.approval as AcpApprovalRequest);
          setIsExpired(false);
          setError(null);
        } else if (event.type === 'approval_resolved') {
          setApproval(null);
          setCountdown(null);
          setIsExpired(false);
        }
      } catch {
        // Ignore malformed events
      }
    };

    es.onerror = () => {
      // SSE auto-reconnects
    };

    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [sessionId, autoConnect]);

  // Countdown timer when approval has expiresAt
  useEffect(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }

    if (!approval?.expiresAt) {
      setCountdown(null);
      return () => {};
    }

    const updateCountdown = () => {
      const expires = new Date(approval.expiresAt!).getTime();
      const remaining = expires - Date.now();

      if (remaining <= 0) {
        setCountdown('00:00');
        setIsExpired(true);
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
      } else {
        setCountdown(formatCountdown(remaining));
      }
    };

    updateCountdown();
    countdownRef.current = setInterval(updateCountdown, 1000);

    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [approval]);

  const handleApprove = useCallback(async (reason?: string) => {
    if (!approval) return;
    setIsLoading(true);
    setError(null);

    try {
      await approveTool(sessionId, {
        approvalId: approval.approvalId,
        reason,
      });
      setApproval(null);
      setCountdown(null);
      setIsExpired(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [approval, sessionId]);

  const handleReject = useCallback(async (reason?: string) => {
    if (!approval) return;
    setIsLoading(true);
    setError(null);

    try {
      await rejectTool(sessionId, {
        approvalId: approval.approvalId,
        reason,
      });
      setApproval(null);
      setCountdown(null);
      setIsExpired(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [approval, sessionId]);

  const handleClearError = useCallback(() => setError(null), []);

  return {
    approval,
    countdown,
    isExpired,
    isLoading,
    error,
    approve: handleApprove,
    reject: handleReject,
    clearError: handleClearError,
  };
}
