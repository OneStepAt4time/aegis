/**
 * api/acp-terminal-client.ts — API client for ACP terminal debug operations.
 *
 * Calls POST /v1/sessions/:id/terminal/* endpoints.
 */

import { getAuthHeaders } from './client.js';

const BASE_URL = import.meta.env.VITE_AEGIS_URL ?? '';

const JSON_HEADERS = { ...getAuthHeaders({ 'Content-Type': 'application/json' }) };

export interface AcpTerminalOpenResult {
  sessionId: string;
  acpSessionId: string;
  terminalId: string;
}

export interface AcpTerminalSnapshotEvent {
  type: 'terminal.snapshot';
  sessionId: string;
  acpSessionId: string;
  terminalId: string;
  replayedOutput: string;
  columns: number;
  rows: number;
}

/** Open a terminal for the session. */
export async function openTerminal(sessionId: string): Promise<AcpTerminalOpenResult> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/terminal/open`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Failed to open terminal: ${res.status}`);
  return res.json() as Promise<AcpTerminalOpenResult>;
}

/** Send input to the terminal. */
export async function sendTerminalInput(sessionId: string, terminalId: string, data: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/terminal/input`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ terminalId, data }),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Failed to send input: ${res.status}`);
}

/** Resize the terminal. */
export async function resizeTerminal(sessionId: string, terminalId: string, columns: number, rows: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/terminal/resize`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ terminalId, columns, rows }),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Failed to resize terminal: ${res.status}`);
}

/** Reconnect to the terminal and get a snapshot. */
export async function reconnectTerminal(sessionId: string, terminalId: string): Promise<AcpTerminalSnapshotEvent> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/terminal/reconnect`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ terminalId }),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Failed to reconnect terminal: ${res.status}`);
  return res.json() as Promise<AcpTerminalSnapshotEvent>;
}

/** Close the terminal. */
export async function closeTerminal(sessionId: string, terminalId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/terminal/close`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ terminalId }),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Failed to close terminal: ${res.status}`);
}
