/**
 * api/acp-approval-client.ts — API client for ACP approval actions.
 *
 * Wired to real endpoints from ACP-064 (control action endpoints).
 *
 * Endpoints:
 *   POST /v1/sessions/:id/approval/approve
 *   POST /v1/sessions/:id/approval/reject
 *   GET  /v1/sessions/:id/approval/pending
 */

import { getAuthHeaders } from './client.js';
import type {
  AcpApprovalRequest,
  AcpApproveRequest,
  AcpRejectRequest,
  AcpApprovalActionResult,
} from '../types/acp-approval';

const BASE_URL = import.meta.env.VITE_AEGIS_URL ?? '';

const JSON_HEADERS = getAuthHeaders({ 'Content-Type': 'application/json' });

/** Approve a pending tool approval. */
export async function approveTool(
  sessionId: string,
  request: AcpApproveRequest,
  signal?: AbortSignal,
): Promise<AcpApprovalActionResult> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/approval/approve`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(request),
    credentials: 'include',
    signal,
  });
  if (!res.ok) throw new Error(`Failed to approve tool: ${res.status}`);
  return res.json();
}

/** Reject a pending tool approval. */
export async function rejectTool(
  sessionId: string,
  request: AcpRejectRequest,
  signal?: AbortSignal,
): Promise<AcpApprovalActionResult> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/approval/reject`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(request),
    credentials: 'include',
    signal,
  });
  if (!res.ok) throw new Error(`Failed to reject tool: ${res.status}`);
  return res.json();
}

/** Get the current pending approval for a session, if any. */
export async function getPendingApproval(
  sessionId: string,
  signal?: AbortSignal,
): Promise<AcpApprovalRequest | null> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/approval/pending`, {
    headers: getAuthHeaders(),
    credentials: 'include',
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to get pending approval: ${res.status}`);
  return res.json();
}
