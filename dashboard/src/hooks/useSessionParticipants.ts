/**
 * hooks/useSessionParticipants.ts — React hook for driver/observer state management.
 *
 * Tracks who is driving/observing a session and provides actions
 * to claim, release, and transfer the driver role.
 *
 * TODO: Wire up to real API endpoints once ACP-028 + ACP-064 land.
 * TODO: Subscribe to SSE events for real-time participant updates.
 */

import { useState, useCallback, useEffect } from 'react';
import type {
  AcpSessionParticipants,
  AcpClaimDriverRequest,
  AcpTransferDriverRequest,
} from '../types/acp-driver-observer';
import {
  claimDriver,
  releaseDriver,
  transferDriver,
  getSessionParticipants,
} from '../api/acp-driver-client';

export interface UseSessionParticipantsReturn {
  /** Current session participants. */
  participants: AcpSessionParticipants | null;
  /** Whether the current user is the driver. */
  isDriver: boolean;
  /** Whether an action is in progress. */
  isLoading: boolean;
  /** Error from the last action, if any. */
  error: string | null;
  /** Claim the driver role. */
  claim: (request?: AcpClaimDriverRequest) => Promise<void>;
  /** Release the driver role. */
  release: () => Promise<void>;
  /** Transfer the driver role to another subscriber. */
  transfer: (request: AcpTransferDriverRequest) => Promise<void>;
  /** Clear the current error. */
  clearError: () => void;
  /** Refresh participant state from the server. */
  refresh: () => Promise<void>;
}

export function useSessionParticipants(
  sessionId: string | undefined,
  currentUserId?: string,
): UseSessionParticipantsReturn {
  const [participants, setParticipants] = useState<AcpSessionParticipants | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await getSessionParticipants(sessionId);
      setParticipants(result);
    } catch {
      // Network error or 404
      setParticipants(null);
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isDriver = participants?.driver?.subscriberId === currentUserId;

  const claim = useCallback(async (request?: AcpClaimDriverRequest) => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      await claimDriver(sessionId, request);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to claim driver');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, refresh]);

  const release = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      await releaseDriver(sessionId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to release driver');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, refresh]);

  const transfer = useCallback(async (request: AcpTransferDriverRequest) => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      await transferDriver(sessionId, request);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to transfer driver');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, refresh]);

  return {
    participants,
    isDriver,
    isLoading,
    error,
    claim,
    release,
    transfer,
    clearError,
    refresh,
  };
}
