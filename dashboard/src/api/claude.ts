/**
 * api/claude.ts — Claude Code sessions proxy.
 */

import { request } from './base';

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
  try {
    return await request<ClaudeAgentSession[]>('/v1/cc-sessions', { signal });
  } catch {
    // Endpoint may not exist yet — return empty array gracefully
    return [];
  }
}
