/**
 * components/session/AcpChatPanel.tsx — Wired ACP chat panel.
 *
 * Connects useAcpChat hook to AcpChatView component.
 * Handles the "no backend" case with a clean empty state.
 */

import { useAcpChat } from '../../hooks/useAcpChat';
import { AcpChatView } from './AcpChatView';

interface AcpChatPanelProps {
  sessionId: string;
  isDriver?: boolean;
}

export function AcpChatPanel({ sessionId, isDriver = true }: AcpChatPanelProps) {
  const {
    messages,
    sessionUsage,
    isGenerating,
    error: hookError,
    sendPrompt,
    stop,

  } = useAcpChat({ sessionId });

  // Hook returned an error — backend not available or connection failed
  if (hookError && messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <div className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-6 py-4 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">
            Chat requires an active ACP backend connection.
          </p>
          <p className="mt-2 text-xs text-[var(--color-text-muted)] opacity-60">
            {hookError}
          </p>
        </div>
      </div>
    );
  }

  return (
    <AcpChatView
      sessionId={sessionId}
      messages={messages}
      sessionUsage={sessionUsage}
      isGenerating={isGenerating}
      isDriver={isDriver}
      onSend={isDriver ? sendPrompt : undefined}
      onStop={stop}
    />
  );
}
