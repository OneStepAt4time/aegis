/**
 * components/session/AcpChatView.tsx — ACP chat view.
 *
 * Displays the conversation with:
 * - User messages
 * - Assistant messages with streamed text
 * - Thinking blocks (collapsible)
 * - Tool call cards (placeholder for ACP-082)
 * - Token usage meter
 * - Driver prompt input
 *
 * This is the default tab content for the AcpSessionShell.
 *
 * TODO: Wire to real SSE event stream once ACP-025 lands.
 * TODO: Integrate tool-call/diff cards (ACP-082).
 */

import { useState, useRef, useEffect } from 'react';
import {
  Send,
  Bot,
  User,
  Brain,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import type {
  AcpChatMessage,
  AcpThinkingBlock,
  AcpTokenUsage,
  AcpSessionTokenUsage,
  AcpChatViewConfig,
} from '../../types/acp-chat';

export interface AcpChatViewProps {
  /** Session ID. */
  sessionId: string;
  /** Chat messages to display. */
  messages: AcpChatMessage[];
  /** Cumulative session token usage. */
  sessionUsage?: AcpSessionTokenUsage;
  /** Whether the session is currently generating a response. */
  isGenerating?: boolean;
  /** Whether the current user is the driver (can send prompts). */
  isDriver?: boolean;
  /** Callback when user sends a prompt. */
  onSend?: (text: string) => void;
  /** Callback when user requests a stop. */
  onStop?: () => void;
  /** View configuration. */
  config?: AcpChatViewConfig;
}

function ThinkingBlock({ block }: { block: AcpThinkingBlock }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1 text-xs text-[#555] hover:text-[#888] transition-colors"
        aria-expanded={expanded}
        aria-controls={`thinking-${block.id}`}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Brain className="h-3 w-3" />
        Thinking {block.isStreaming && <Loader2 className="h-3 w-3 animate-spin" />}
      </button>
      {expanded && (
        <pre
          id={`thinking-${block.id}`}
          className="mt-1 max-h-48 overflow-auto rounded-md border border-[#2a2a3a] bg-[#0a0a0f] p-2 font-mono text-xs text-[#666] whitespace-pre-wrap"
        >
          {block.content}
        </pre>
      )}
    </div>
  );
}

function TokenUsageInline({ usage }: { usage: AcpTokenUsage }) {
  return (
    <span className="ml-2 text-[10px] text-[#444]" title={`Input: ${usage.inputTokens} · Output: ${usage.outputTokens} · Total: ${usage.totalTokens}`}>
      {usage.totalTokens.toLocaleString()} tokens
    </span>
  );
}

function ToolCallPlaceholder({ toolCall }: { toolCall: import('../../types/acp-chat').AcpToolCall }) {
  const statusIcons: Record<string, string> = {
    pending: '⏳',
    running: '🔄',
    completed: '✅',
    failed: '❌',
    cancelled: '🚫',
  };

  return (
    <div className="my-1 flex items-center gap-2 rounded-md border border-[#2a2a3a] bg-[#12121f] px-3 py-1.5 text-xs text-[#888]">
      <span>{statusIcons[toolCall.status] ?? '❓'}</span>
      <span className="font-mono">{toolCall.toolName}</span>
      {toolCall.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
    </div>
  );
}

function MessageBubble({ message, showPerMessageUsage }: { message: AcpChatMessage; showPerMessageUsage?: boolean }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div className={`mb-4 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] ${isUser ? 'order-1' : ''}`}>
        {/* Role indicator */}
        <div className={`mb-1 flex items-center gap-1 text-xs ${isUser ? 'justify-end text-[#555]' : 'text-[#555]'}`}>
          {isUser ? (
            <>
              <span>You</span>
              <User className="h-3 w-3" />
            </>
          ) : (
            <>
              <Bot className="h-3 w-3" />
              <span>Assistant</span>
            </>
          )}
          {isSystem && <span className="text-[#555]">System</span>}
        </div>

        {/* Message content */}
        <div
          className={`rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'bg-blue-500/15 text-[#e0e0e0] border border-blue-500/20'
              : isSystem
                ? 'bg-[#1a1a2a] text-[#888] border border-[#2a2a3a]'
                : 'bg-[#12121f] text-[#d0d0d0] border border-[#2a2a3a]'
          }`}
        >
          {/* Thinking blocks */}
          {message.thinking && message.thinking.length > 0 && (
            <div className="mb-2">
              {message.thinking.map((block) => (
                <ThinkingBlock key={block.id} block={block} />
              ))}
            </div>
          )}

          {/* Text content */}
          <div className="whitespace-pre-wrap break-words">
            {message.content}
            {message.isStreaming && <span className="inline-block w-1.5 h-4 ml-0.5 animate-pulse bg-[#888]" />}
          </div>

          {/* Tool calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-2">
              {message.toolCalls.map((tc) => (
                <ToolCallPlaceholder key={tc.id} toolCall={tc} />
              ))}
            </div>
          )}
        </div>

        {/* Usage */}
        {showPerMessageUsage && message.usage && (
          <div className="mt-1">
            <TokenUsageInline usage={message.usage} />
          </div>
        )}
      </div>
    </div>
  );
}

function TokenMeter({ usage }: { usage: AcpSessionTokenUsage }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#2a2a3a] bg-[#12121f] px-3 py-2 text-xs">
      <div className="flex items-center gap-1 text-[#555]">
        <span>Input:</span>
        <span className="font-mono text-[#888]">{usage.inputTokens.toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-1 text-[#555]">
        <span>Output:</span>
        <span className="font-mono text-[#888]">{usage.outputTokens.toLocaleString()}</span>
      </div>
      {usage.cacheReadTokens > 0 && (
        <div className="flex items-center gap-1 text-[#555]">
          <span>Cache:</span>
          <span className="font-mono text-green-400">{usage.cacheReadTokens.toLocaleString()}</span>
        </div>
      )}
      <div className="ml-auto flex items-center gap-1">
        <span className="font-mono font-medium text-[#e0e0e0]">{usage.totalTokens.toLocaleString()}</span>
        <span className="text-[#555]">tokens</span>
      </div>
      {usage.estimatedCostUsd !== undefined && (
        <div className="text-[#555]">
          ~${usage.estimatedCostUsd.toFixed(4)}
        </div>
      )}
    </div>
  );
}

export function AcpChatView({
  sessionId,
  messages,
  sessionUsage,
  isGenerating = false,
  isDriver = true,
  onSend,
  onStop,
  config,
}: AcpChatViewProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  
  const showPerMessageUsage = config?.showPerMessageUsage ?? false;
  const autoScroll = config?.autoScroll ?? true;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || !onSend) return;
    onSend(text);
    setInput('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col" data-session-id={sessionId}>
      {/* Token meter */}
      {sessionUsage && <TokenMeter usage={sessionUsage} />}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4" role="log" aria-label="Chat messages">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[#555]">
            No messages yet. Send a prompt to start.
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              showPerMessageUsage={showPerMessageUsage}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      {isDriver ? (
        <div className="border-t border-[#2a2a3a] p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Send a prompt to the agent..."
              rows={1}
              className="flex-1 resize-none rounded-lg border border-[#2a2a3a] bg-[#0a0a0f] px-3 py-2.5 text-sm text-[#e0e0e0] placeholder-[#555] focus:border-blue-500/50 focus:outline-none"
              disabled={!isDriver}
              aria-label="Message input"
            />
            {isGenerating ? (
              <button
                type="button"
                onClick={onStop}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 transition-colors hover:bg-red-500/20"
                aria-label="Stop generation"
              >
                ⏹
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400 transition-colors hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="mt-1 text-right text-[10px] text-[#333]">
            Enter to send · Shift+Enter for new line
          </div>
        </div>
      ) : (
        <div className="border-t border-[#2a2a3a] p-3 text-center text-xs text-[#555]">
          Observer mode — you cannot send prompts
        </div>
      )}
    </div>
  );
}
