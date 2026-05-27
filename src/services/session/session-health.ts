import { readNewEntries } from '../../transcript.js';
import type { SessionInfo, UIState } from '../../session-types.js';

export type SessionHealthInfo = {
  alive: boolean;
  claudeRunning: boolean;
  status: UIState;
  hasTranscript: boolean;
  lastActivity: number;
  lastActivityAgo: number;
  sessionAge: number;
  details: string;
  actionHints?: Record<string, { method: string; url: string; description: string }>;
};

export async function checkWaitingForInput(session: SessionInfo): Promise<boolean> {
  if (!session?.jsonlPath) return false;

  try {
    const { raw } = await readNewEntries(session.jsonlPath, session.byteOffset);
    for (let i = raw.length - 1; i >= 0; i--) {
      const entry = raw[i];
      if (entry.type !== 'assistant' || !entry.message) continue;
      const content = entry.message.content;
      if (typeof content === 'string') return true;
      if (!Array.isArray(content)) return false;
      const hasToolUse = content.some((block: { type: string }) => block.type === 'tool_use');
      return !hasToolUse;
    }
  } catch {
    // Swallow errors — preserve existing behaviour
  }
  return false;
}

export function buildSessionHealth(session: SessionInfo): SessionHealthInfo {
  const status = session.status;
  const lastActivityAgo = Date.now() - session.lastActivity;
  const actionHints = (status === 'permission_prompt' || status === 'bash_approval')
    ? {
        approve: { method: 'POST', url: `/v1/sessions/${session.id}/approve`, description: 'Approve the pending permission' },
        reject: { method: 'POST', url: `/v1/sessions/${session.id}/reject`, description: 'Reject the pending permission' },
      }
    : undefined;

  return {
    alive: true,
    claudeRunning: status === 'working' || status === 'permission_prompt' || status === 'ask_question',
    status,
    hasTranscript: !!session.jsonlPath,
    lastActivity: session.lastActivity,
    lastActivityAgo,
    sessionAge: Date.now() - session.createdAt,
    details: `Session ${session.id}: ${status} (ACP mode)`,
    actionHints,
  };
}
