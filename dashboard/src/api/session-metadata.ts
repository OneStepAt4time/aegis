/**
 * Session metadata API client.
 * Contract: GET/POST/DELETE /v1/sessions/:id/meta
 */

export interface SessionMetadataMap {
  [key: string]: string;
}

export async function fetchSessionMeta(sessionId: string): Promise<SessionMetadataMap> {
  const res = await fetch(`/v1/sessions/${sessionId}/meta`);
  if (!res.ok) throw new Error('Failed to fetch session metadata');
  const data = await res.json();
  return data.metadata ?? {};
}

export async function setSessionMeta(sessionId: string, pairs: SessionMetadataMap): Promise<SessionMetadataMap> {
  const res = await fetch(`/v1/sessions/${sessionId}/meta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pairs),
  });
  if (!res.ok) throw new Error('Failed to set session metadata');
  const data = await res.json();
  return data.metadata ?? {};
}

export async function deleteSessionMetaKey(sessionId: string, key: string): Promise<SessionMetadataMap> {
  const res = await fetch(`/v1/sessions/${sessionId}/meta/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete metadata key');
  const data = await res.json();
  return data.metadata ?? {};
}
