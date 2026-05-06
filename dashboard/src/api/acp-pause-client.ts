/**
 * api/acp-pause-client.ts — API client for ACP pause/resume/intervention.
 *
 * Wired to real endpoints from ACP-064 (#2607):
 *   POST /v1/sessions/:id/pause
 *   POST /v1/sessions/:id/intervention/start
 *   POST /v1/sessions/:id/intervention/complete
 *   POST /v1/sessions/:id/resume
 *   GET  /v1/sessions/:id/intervention
 */

import { getAuthHeaders } from './client.js';
import type {
  AcpPauseInterventionRecord,
  AcpPauseSessionRequest,
  AcpStartInterventionRequest,
  AcpCompleteInterventionRequest,
  AcpResumeSessionRequest,
  AcpPauseInterventionPolicyResult,
} from '../types/acp-pause';

const BASE_URL = import.meta.env.VITE_AEGIS_URL ?? '';

const JSON_HEADERS = getAuthHeaders({ 'Content-Type': 'application/json' });

/** Pause a running session. */
export async function pauseSession(
  sessionId: string,
  request: AcpPauseSessionRequest,
  signal?: AbortSignal,
): Promise<AcpPauseInterventionPolicyResult> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/pause`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(request),
    credentials: 'include',
    signal,
  });
  if (!res.ok) throw new Error(`Failed to pause session: ${res.status}`);
  return res.json();
}

/** Start an intervention on a paused session. */
export async function startIntervention(
  sessionId: string,
  request: AcpStartInterventionRequest = {},
  signal?: AbortSignal,
): Promise<AcpPauseInterventionPolicyResult> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/intervention/start`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(request),
    credentials: 'include',
    signal,
  });
  if (!res.ok) throw new Error(`Failed to start intervention: ${res.status}`);
  return res.json();
}

/** Complete an intervention with optional guidance. */
export async function completeIntervention(
  sessionId: string,
  request: AcpCompleteInterventionRequest,
  signal?: AbortSignal,
): Promise<AcpPauseInterventionPolicyResult> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/intervention/complete`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(request),
    credentials: 'include',
    signal,
  });
  if (!res.ok) throw new Error(`Failed to complete intervention: ${res.status}`);
  return res.json();
}

/** Resume a paused or intervened session. */
export async function resumeSession(
  sessionId: string,
  request: AcpResumeSessionRequest = {},
  signal?: AbortSignal,
): Promise<AcpPauseInterventionPolicyResult> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/resume`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(request),
    credentials: 'include',
    signal,
  });
  if (!res.ok) throw new Error(`Failed to resume session: ${res.status}`);
  return res.json();
}

/** Get the active or latest pause intervention for a session. */
export async function getSessionIntervention(
  sessionId: string,
  signal?: AbortSignal,
): Promise<AcpPauseInterventionRecord | null> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/intervention`, {
    headers: getAuthHeaders(),
    credentials: 'include',
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to get intervention: ${res.status}`);
  return res.json();
}
