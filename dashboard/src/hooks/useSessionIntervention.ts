/**
 * hooks/useSessionIntervention.ts — React hook for session pause/resume/intervention state.
 *
 * Tracks the active intervention for a session and provides actions
 * to pause, intervene, complete, and resume.
 *
 * TODO: Wire up to real API endpoints once ACP-064 lands.
 * TODO: Subscribe to SSE events for real-time intervention status updates.
 */

import { useState, useCallback, useEffect } from 'react';
import type {
  AcpPauseInterventionRecord,
  AcpPauseSessionRequest,
  AcpCompleteInterventionRequest,
  AcpResumeSessionRequest,
} from '../types/acp-pause';
import {
  pauseSession,
  startIntervention,
  completeIntervention,
  resumeSession,
  getSessionIntervention,
} from '../api/acp-pause-client';

export interface UseSessionInterventionReturn {
  /** The active intervention record, or null if none. */
  intervention: AcpPauseInterventionRecord | null;
  /** Whether an action is in progress. */
  isLoading: boolean;
  /** Error from the last action, if any. */
  error: string | null;
  /** Pause the session. */
  pause: (request: AcpPauseSessionRequest) => Promise<void>;
  /** Start an intervention on the paused session. */
  intervene: () => Promise<void>;
  /** Complete the intervention with optional guidance. */
  completeIntervention: (request: AcpCompleteInterventionRequest) => Promise<void>;
  /** Resume the session after intervention. */
  resume: (request?: AcpResumeSessionRequest) => Promise<void>;
  /** Clear the current error. */
  clearError: () => void;
  /** Refresh the intervention state from the server. */
  refresh: () => Promise<void>;
}

export function useSessionIntervention(sessionId: string | undefined): UseSessionInterventionReturn {
  const [intervention, setIntervention] = useState<AcpPauseInterventionRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await getSessionIntervention(sessionId);
      setIntervention(result);
    } catch {
      // 404 or network error — no active intervention
      setIntervention(null);
    }
  }, [sessionId]);

  // Fetch intervention state on mount and when sessionId changes
  useEffect(() => {
    refresh();
  }, [refresh]);

  const pause = useCallback(async (request: AcpPauseSessionRequest) => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await pauseSession(sessionId, request);
      setIntervention(result.pause);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to pause session');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  const intervene = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await startIntervention(sessionId);
      setIntervention(result.pause);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start intervention');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  const completeInterventionAction = useCallback(async (request: AcpCompleteInterventionRequest) => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await completeIntervention(sessionId, request);
      setIntervention(result.pause);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to complete intervention');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  const resume = useCallback(async (request?: AcpResumeSessionRequest) => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await resumeSession(sessionId, request);
      setIntervention(result.pause);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resume session');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  return {
    intervention,
    isLoading,
    error,
    pause,
    intervene,
    completeIntervention: completeInterventionAction,
    resume,
    clearError,
    refresh,
  };
}
