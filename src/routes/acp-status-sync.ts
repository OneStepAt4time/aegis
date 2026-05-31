import type { SessionManager, UIState } from '../session.js';

const terminalStates = new Set<UIState>(['killed', 'completed', 'crashed']);
const acpToUIState: Record<string, UIState> = {
  initializing: 'pending',
  idle: 'idle',
  running: 'working',
  paused: 'idle',
  intervening: 'working',
  closing: 'idle',
  closed: 'idle',
  failed: 'error',
};

export function mapAcpStatusToUI(acpStatus: string): UIState | undefined {
  return acpToUIState[acpStatus];
}

export async function syncAcpSessionStatus(
  sessions: SessionManager,
  sessionId: string,
  acpStatus: string,
  latestActivityText?: string,
): Promise<void> {
  const session = sessions.getSession(sessionId);
  const mappedStatus = mapAcpStatusToUI(acpStatus);
  if (!session || !mappedStatus || terminalStates.has(session.status)) return;
  session.status = mappedStatus;
  session.lastActivity = Date.now();
  if (latestActivityText) session.latestActivityText = latestActivityText;
  await sessions.save();
}
