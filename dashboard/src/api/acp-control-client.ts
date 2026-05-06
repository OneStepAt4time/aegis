/**
 * api/acp-control-client.ts — ACP control action API client.
 *
 * High-level wrapper that delegates to the real ACP sub-clients:
 *   - acp-pause-client.ts (pause, resume, intervention)
 *   - acp-driver-client.ts (driver claim/release/transfer)
 *
 * All mutating control actions use actionId-based idempotency.
 */

import type { AcpControlActionType } from '../types/acp-control';
import {
  pauseSession as pauseSessionApi,
  resumeSession as resumeSessionApi,
  cancelSession as cancelSessionApi,
  startIntervention as startInterventionApi,
  completeIntervention as completeInterventionApi,
  getSessionIntervention as getSessionInterventionApi,
} from './acp-pause-client.js';

/** Control action request payload. */
export interface ControlActionRequest {
  actionId: string;
  sessionId: string;
  type: AcpControlActionType;
  /** Audit reason (for pause). */
  reason?: string;
  /** Guidance for agent (for intervention completion). */
  guidance?: string;
}

/** Control action response. */
export interface ControlActionResponse {
  actionId: string;
  sessionId: string;
  type: AcpControlActionType;
  status: 'queued' | 'completed' | 'failed';
  error?: string;
  timestamp: string;
}

/** Intervention record from the backend. */
export interface InterventionRecord {
  id: string;
  sessionId: string;
  reason?: string;
  guidance?: string;
  actor: string;
  startedAt: string;
  completedAt?: string;
  status: 'active' | 'completed';
}

/** Generate a unique action ID for idempotency. */
export function generateActionId(): string {
  return `ctrl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Send a control action to a session.
 * Delegates to the real ACP pause/intervention endpoints.
 */
export async function sendControlAction(
  request: ControlActionRequest,
  signal?: AbortSignal,
): Promise<ControlActionResponse> {
  try {
    let result;

    switch (request.type) {
      case 'pause':
        result = await pauseSessionApi(request.sessionId, {
          reason: request.reason ?? '',
          idempotencyKey: request.actionId,
        }, signal);
        break;

      case 'resume':
        result = await resumeSessionApi(request.sessionId, {
          resumedBy: request.actionId,
        }, signal);
        break;

      case 'intervene':
        if (request.guidance) {
          result = await completeInterventionApi(request.sessionId, {
            completedBy: request.actionId,
            guidance: request.guidance,
          }, signal);
        } else {
          result = await startInterventionApi(request.sessionId, {
            interventionBy: request.actionId,
          }, signal);
        }
        break;

      case 'cancel':
        result = await cancelSessionApi(request.sessionId, {
          force: false,
        }, signal);
        break;

      default:
        throw new Error(`Unknown control action type: ${request.type}`);
    }

    return {
      actionId: request.actionId,
      sessionId: request.sessionId,
      type: request.type,
      status: 'completed',
      timestamp: result.session.updatedAt,
    };
  } catch (error) {
    if (error instanceof Error) {
      // Map known error codes from the backend
      if (error.message.includes('409')) {
        return {
          actionId: request.actionId,
          sessionId: request.sessionId,
          type: request.type,
          status: 'failed',
          error: error.message,
          timestamp: new Date().toISOString(),
        };
      }
      throw error;
    }
    throw new Error(String(error));
  }
}

/**
 * Get the current intervention record for a session (if any).
 */
export async function getIntervention(
  sessionId: string,
  signal?: AbortSignal,
): Promise<InterventionRecord | null> {
  const record = await getSessionInterventionApi(sessionId, signal);
  if (!record) return null;

  return {
    id: record.pauseId,
    sessionId: record.sessionId,
    reason: record.reason,
    guidance: record.guidance,
    actor: record.requestedBy,
    startedAt: record.requestedAt,
    completedAt: record.interventionCompletedAt,
    status: record.status === 'paused' ? 'active' : 'completed',
  };
}

/** Pause a session with a reason. */
export async function pauseSession(
  sessionId: string,
  reason: string,
): Promise<ControlActionResponse> {
  return sendControlAction({
    actionId: generateActionId(),
    sessionId,
    type: 'pause',
    reason,
  });
}

/** Resume a paused session. */
export async function resumeSession(
  sessionId: string,
): Promise<ControlActionResponse> {
  return sendControlAction({
    actionId: generateActionId(),
    sessionId,
    type: 'resume',
  });
}

/** Start an intervention on a session. */
export async function startIntervention(
  sessionId: string,
): Promise<ControlActionResponse> {
  return sendControlAction({
    actionId: generateActionId(),
    sessionId,
    type: 'intervene',
  });
}

/** Complete an intervention with optional guidance. */
export async function completeIntervention(
  sessionId: string,
  guidance?: string,
): Promise<ControlActionResponse> {
  return sendControlAction({
    actionId: generateActionId(),
    sessionId,
    type: 'intervene',
    guidance,
  });
}

/** Cancel a session. */
export async function cancelSession(
  sessionId: string,
): Promise<ControlActionResponse> {
  return sendControlAction({
    actionId: generateActionId(),
    sessionId,
    type: 'cancel',
  });
}
