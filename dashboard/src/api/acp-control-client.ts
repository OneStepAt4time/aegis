/**
 * api/acp-control-client.ts — ACP control action API client.
 *
 * Handles pause, resume, intervention, and cancel actions for sessions.
 * All mutating control actions are idempotent (actionId-based).
 *
 * Planned contract (from ACP-064 / #2607):
 *   POST /v1/sessions/:sessionId/actions
 *   Body: { actionId, type, sessionId, ...typeSpecificFields }
 *
 * TODO: Swap mock implementation for real fetch calls once #2607 lands.
 */

import type { AcpControlActionType } from '../types/acp-control';

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
 *
 * TODO: Replace with real fetch once #2607 lands.
 */
export async function sendControlAction(
  request: ControlActionRequest,
): Promise<ControlActionResponse> {
  // TODO: Real implementation
  // const res = await fetch(`/v1/sessions/${encodeURIComponent(request.sessionId)}/actions`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify(request),
  // });
  // if (!res.ok) throw new Error(`Control action failed: ${res.status}`);
  // return res.json();

  // Mock implementation for scaffold phase
  return {
    actionId: request.actionId,
    sessionId: request.sessionId,
    type: request.type,
    status: 'completed',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get the current intervention record for a session (if any).
 *
 * TODO: Replace with real fetch once #2607 lands.
 */
export async function getIntervention(
  _sessionId: string,
): Promise<InterventionRecord | null> {
  // TODO: Real implementation
  // const res = await fetch(`/v1/sessions/${encodeURIComponent(sessionId)}/intervention`);
  // if (res.status === 404) return null;
  // if (!res.ok) throw new Error(`Failed to get intervention: ${res.status}`);
  // return res.json();

  return null;
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
