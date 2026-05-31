/**
 * api/claude.ts — Claude Code sessions proxy.
 */

export interface ClaudeAgentSession {
  pid: number;
  cwd: string;
  kind: 'background';
  startedAt: number;
  sessionId: string;
  name: string;
  status: 'idle' | 'working';
}

export async function getClaudeSessions(signal?: AbortSignal): Promise<ClaudeAgentSession[]> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  // The backend endpoint is not available yet. Keep the UI quiet instead of
  // polling a known-missing route and filling the console with 404s.
  return [];
}
