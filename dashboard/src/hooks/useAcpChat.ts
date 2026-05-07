/**
 * hooks/useAcpChat.ts — React hook for ACP chat message management.
 *
 * Manages chat state (messages, usage, generation status) and provides
 * sendPrompt/stop callbacks. Subscribes to SSE for real-time updates.
 *
 * @see AcpChatView.tsx — the UI component that consumes this hook
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { sendPrompt } from '../api/acp-chat-client.js';
import type {
  AcpChatMessage,
  AcpSessionTokenUsage,
} from '../types/acp-chat';

/** SSE event shapes for chat updates. */
interface ChatMessageEvent {
  type: 'message.delta' | 'message.complete' | 'turn.completed';
  messageId: string;
  role?: string;
  content?: string;
  isStreaming?: boolean;
}

interface UsageEvent {
  type: 'usage.updated';
  usage: AcpSessionTokenUsage;
}

interface ToolCallEvent {
  type: 'tool.started' | 'tool.completed';
  toolCallId: string;
  toolName?: string;
  status?: string;
}

type SseEvent = ChatMessageEvent | UsageEvent | ToolCallEvent;

export interface UseAcpChatOptions {
  sessionId: string;
  /** Auto-connect SSE on mount (default: true). */
  autoConnect?: boolean;
}

export interface UseAcpChatReturn {
  messages: AcpChatMessage[];
  sessionUsage: AcpSessionTokenUsage | undefined;
  isGenerating: boolean;
  error: string | null;
  sendPrompt: (text: string) => Promise<void>;
  stop: () => void;
  clearError: () => void;
}

/** Build the SSE URL with auth token. */
function getSseUrl(sessionId: string): string {
  const baseUrl = import.meta.env.VITE_AEGIS_URL ?? '';
  return `${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/sse`;
}

export function useAcpChat({ sessionId, autoConnect = true }: UseAcpChatOptions): UseAcpChatReturn {
  const [messages, setMessages] = useState<AcpChatMessage[]>([]);
  const [sessionUsage, setSessionUsage] = useState<AcpSessionTokenUsage | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  // Clean up SSE on unmount or sessionId change
  useEffect(() => {
    if (!autoConnect) return;

    const url = getSseUrl(sessionId);
    const es = new EventSource(url);
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const event: SseEvent = JSON.parse(e.data);
        handleSseEvent(event);
      } catch {
        // Ignore malformed events
      }
    };

    es.onerror = () => {
      // SSE will auto-reconnect; just note the error
    };

    return () => {
      es.close();
      sseRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, autoConnect]);

  const handleSseEvent = useCallback((event: SseEvent) => {
    switch (event.type) {
      case 'message.delta': {
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === event.messageId);
          if (existing) {
            // Update existing streaming message
            return prev.map((m) =>
              m.id === event.messageId
                ? {
                    ...m,
                    content: m.content + (event.content ?? ''),
                    isStreaming: true,
                  }
                : m,
            );
          }
          // New message
          return [
            ...prev,
            {
              id: event.messageId,
              role: (event.role as AcpChatMessage['role']) ?? 'assistant',
              content: event.content ?? '',
              isStreaming: true,
              timestamp: new Date().toISOString(),
            },
          ];
        });
        setIsGenerating(true);
        break;
      }

      case 'message.complete': {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId ? { ...m, isStreaming: false } : m,
          ),
        );
        break;
      }

      case 'turn.completed': {
        setIsGenerating(false);
        break;
      }

      case 'usage.updated': {
        setSessionUsage(event.usage);
        break;
      }

      case 'tool.started':
      case 'tool.completed': {
        // Tool call events — update the relevant message's toolCalls array
        // For now, these are informational; full implementation in ACP-082
        break;
      }
    }
  }, []);

  const handleSendPrompt = useCallback(async (text: string) => {
    const controller = new AbortController();
    abortRef.current = controller;

    // Optimistically add user message
    const userMsg: AcpChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsGenerating(true);
    setError(null);

    try {
      const result = await sendPrompt(sessionId, text, controller.signal);
      if (!result.delivered) {
        setError(result.reason ?? 'Prompt was not delivered');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      abortRef.current = null;
    }
  }, [sessionId]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsGenerating(false);
  }, []);

  const handleClearError = useCallback(() => setError(null), []);

  return {
    messages,
    sessionUsage,
    isGenerating,
    error,
    sendPrompt: handleSendPrompt,
    stop: handleStop,
    clearError: handleClearError,
  };
}
