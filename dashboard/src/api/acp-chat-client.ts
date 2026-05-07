/**
 * api/acp-chat-client.ts — API client for sending prompts to ACP sessions.
 *
 * Wired to POST /v1/sessions/:id/send — the real ACP message delivery endpoint.
 * Follows the same pattern as acp-approval-client.ts.
 *
 * @see acp-approval-client.ts for pattern reference
 * @see src/routes/session-actions.ts for backend handler
 */

import { getAuthHeaders } from './client.js';

const BASE_URL = import.meta.env.VITE_AEGIS_URL ?? '';

const JSON_HEADERS = () => getAuthHeaders({ 'Content-Type': 'application/json' });

/** Response from the send endpoint. */
export interface AcpSendResponse {
  ok: boolean;
  delivered: boolean;
  attempts: number;
  reason?: string;
}

/** Send a prompt/text message to an ACP session.
 *
 * Uses POST /v1/sessions/:id/send which is the standard message delivery
 * endpoint for ACP sessions (both initial and follow-up prompts).
 */
export async function sendPrompt(
  sessionId: string,
  text: string,
  signal?: AbortSignal,
): Promise<AcpSendResponse> {
  const res = await fetch(
    `${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/send`,
    {
      method: 'POST',
      headers: JSON_HEADERS(),
      body: JSON.stringify({ text }),
      credentials: 'include',
      signal,
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to send prompt: ${res.status}${body ? ` — ${body}` : ''}`);
  }

  return res.json();
}
