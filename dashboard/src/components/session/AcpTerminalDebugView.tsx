/**
 * components/session/AcpTerminalDebugView.tsx — ACP terminal debug surface
 * inside the Stream tab.
 *
 * Wraps useTerminalDebug + TerminalDebugTab so the diagnostic terminal
 * lives in the Stream view picker (Terminal / Transcript / Split).
 */

import { useTerminalDebug } from '../../hooks/useTerminalDebug';
import { TerminalDebugTab } from './TerminalDebugTab';

interface AcpTerminalDebugViewProps {
  sessionId: string;
  isDriver?: boolean;
}

export function AcpTerminalDebugView({ sessionId, isDriver }: AcpTerminalDebugViewProps) {
  const {
    terminalState,
    error,
    sendInput,
    resize,
    reconnect,
  } = useTerminalDebug(sessionId);

  return (
    <TerminalDebugTab
      sessionId={sessionId}
      terminalState={terminalState}
      isDriver={isDriver}
      onInput={sendInput}
      onResize={resize}
      onReconnect={reconnect}
      error={error}
    />
  );
}
