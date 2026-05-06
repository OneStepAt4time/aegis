/**
 * api/acp-driver-client.ts — API client for ACP driver/observer controls.
 *
 * Wired to real endpoints from ACP-028 (Redis presence, driver locks)
 * and ACP-064 (control action endpoints).
 *
 * Endpoints:
 *   POST /v1/sessions/:id/driver/claim
 *   POST /v1/sessions/:id/driver/release
 *   POST /v1/sessions/:id/driver/transfer
 *   GET  /v1/sessions/:id/participants
 */

import { getAuthHeaders } from './client.js';
import type {
  AcpClaimDriverRequest,
  AcpReleaseDriverRequest,
  AcpTransferDriverRequest,
  AcpDriverActionResult,
  AcpSessionParticipants,
} from '../types/acp-driver-observer';

const BASE_URL = import.meta.env.VITE_AEGIS_URL ?? '';

const JSON_HEADERS = getAuthHeaders({ 'Content-Type': 'application/json' });

/** Claim the driver role for a session. */
export async function claimDriver(
  sessionId: string,
  request: AcpClaimDriverRequest = {},
  signal?: AbortSignal,
): Promise<AcpDriverActionResult> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/driver/claim`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(request),
    credentials: 'include',
    signal,
  });
  if (!res.ok) throw new Error(`Failed to claim driver: ${res.status}`);
  return res.json();
}

/** Release the driver role. */
export async function releaseDriver(
  sessionId: string,
  request: AcpReleaseDriverRequest = {},
  signal?: AbortSignal,
): Promise<AcpDriverActionResult> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/driver/release`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(request),
    credentials: 'include',
    signal,
  });
  if (!res.ok) throw new Error(`Failed to release driver: ${res.status}`);
  return res.json();
}

/** Transfer the driver role to another subscriber. */
export async function transferDriver(
  sessionId: string,
  request: AcpTransferDriverRequest,
  signal?: AbortSignal,
): Promise<AcpDriverActionResult> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/driver/transfer`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(request),
    credentials: 'include',
    signal,
  });
  if (!res.ok) throw new Error(`Failed to transfer driver: ${res.status}`);
  return res.json();
}

/** Get the active participants (driver + observers) for a session. */
export async function getSessionParticipants(
  sessionId: string,
  signal?: AbortSignal,
): Promise<AcpSessionParticipants> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/participants`, {
    headers: getAuthHeaders(),
    credentials: 'include',
    signal,
  });
  if (!res.ok) throw new Error(`Failed to get participants: ${res.status}`);
  return res.json();
}
