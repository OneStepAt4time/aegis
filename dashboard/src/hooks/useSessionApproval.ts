/**
 * hooks/useSessionApproval.ts — React hook for ACP approval state.
 *
 * Tracks pending approval requests and provides approve/reject actions.
 * Handles TTL countdown and expiration.
 *
 * TODO: Wire to real API endpoints once ACP-064 lands.
 * TODO: Subscribe to SSE events for real-time approval.requested/approval.responded.
 */

import { useState, useCallback, useEffect } from 'react';
import type { AcpApprovalRequest } from '../types/acp-approval';
import {  approveTool,
  rejectTool,
  getPendingApproval,
} from '../api/acp-approval-client';

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function clampRemaining(expiresAt: string | undefined): number | null {
  if (!expiresAt) return null;
  return Math.max(0, new Date(expiresAt).getTime() - Date.now());
}

export interface UseSessionApprovalReturn {
  /** Current pending approval, or null. */
  pendingApproval: AcpApprovalRequest | null;
  /** Whether an action is in progress. */
  isLoading: boolean;
  /** Error from the last action, if any. */
  error: string | null;
  /** Remaining TTL in ms, or null if no timeout. */
  remainingMs: number | null;
  /** Formatted TTL string (e.g., "5:30"). */
  countdown: string | null;
  /** Whether the approval has expired. */
  isExpired: boolean;
  /** Approve the pending tool. */
  approve: (reason?: string) => Promise<void>;
  /** Reject the pending tool. */
  reject: (reason?: string) => Promise<void>;
  /** Clear the current error. */
  clearError: () => void;
  /** Refresh approval state from the server. */
  refresh: () => Promise<void>;
}

export function useSessionApproval(sessionId: string | undefined): UseSessionApprovalReturn {
  const [pendingApproval, setPendingApproval] = useState<AcpApprovalRequest | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await getPendingApproval(sessionId);
      setPendingApproval(result);
    } catch {
      setPendingApproval(null);
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // TTL countdown — only trigger re-render when formatted countdown string changes.
  // remainingMs tracks the live value via state, updated alongside countdown.
  const [countdown, setCountdown] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    const initial = clampRemaining(pendingApproval?.expiresAt);
    if (initial === null || initial <= 0) {
      setCountdown(null);
      setRemainingMs(initial);
      setIsExpired(initial !== null && initial <= 0);
      return;
    }

    const update = () => {
      const ms = clampRemaining(pendingApproval?.expiresAt);
      if (ms === null) return;
      const next = formatCountdown(ms);
      setCountdown((prev) => (prev !== next ? next : prev));
      setRemainingMs(ms);
      if (ms <= 0) setIsExpired(true);
    };

    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [pendingApproval?.expiresAt]);

  const approve = useCallback(async (reason?: string) => {
    if (!sessionId || !pendingApproval) return;
    setIsLoading(true);
    setError(null);
    try {
      await approveTool(sessionId, { approvalId: pendingApproval.approvalId, reason });
      setPendingApproval(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to approve tool');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, pendingApproval]);

  const reject = useCallback(async (reason?: string) => {
    if (!sessionId || !pendingApproval) return;
    setIsLoading(true);
    setError(null);
    try {
      await rejectTool(sessionId, { approvalId: pendingApproval.approvalId, reason });
      setPendingApproval(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject tool');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, pendingApproval]);

  return {
    pendingApproval,
    isLoading,
    error,
    remainingMs,
    countdown,
    isExpired,
    approve,
    reject,
    clearError,
    refresh,
  };
}
