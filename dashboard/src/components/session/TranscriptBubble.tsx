import { useState, useRef, useEffect } from 'react';
import type { ParsedEntry } from '../../types';
import { RenderWithCodeBlocks } from '../shared/CodeBlock';
import { CopyButton } from '../shared/CopyButton';
import { Icon } from '../Icon';

interface TranscriptBubbleProps {
  entry: ParsedEntry;
  index: number;
  onFocus?: (index: number) => void;
  focused?: boolean;
}

function formatAbsoluteTime(ts?: string): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function formatRelativeTime(ts?: string): string {
  if (!ts) return '';
  try {
    const now = Date.now();
    const then = new Date(ts).getTime();
    const diff = Math.floor((now - then) / 1000);
    
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return '';
  }
}

function getRoleColor(role: string, contentType: string): string {
  if (role === 'user') return 'var(--color-cta-bg)';
  if (contentType === 'tool_use') return 'var(--color-warning)';
  if (contentType === 'tool_result' || contentType === 'tool_error') return 'var(--color-void-lighter)';
  if (role === 'system') return 'var(--color-text-muted)';
  return 'var(--color-surface)';
}

export function TranscriptBubble({ entry, index, onFocus, focused }: TranscriptBubbleProps) {
  const [showRelativeTime, setShowRelativeTime] = useState(false);
  const [collapsed, setCollapsed] = useState(
    entry.contentType === 'tool_use' || 
    entry.contentType === 'tool_result' || 
    entry.contentType === 'tool_error' ||
    entry.contentType === 'thinking'
  );
  const bubbleRef = useRef<HTMLDivElement>(null);
  const msgId = `msg-${entry.toolUseId ?? `${entry.role}-${entry.timestamp ?? index}`}`;

  useEffect(() => {
    if (focused && bubbleRef.current) {
      bubbleRef.current.focus();
    }
  }, [focused]);

  const isUser = entry.role === 'user';
  const isSystem = entry.role === 'system';
  const isTool = entry.contentType === 'tool_use' || entry.contentType === 'tool_result' || entry.contentType === 'tool_error';
  const isThinking = entry.contentType === 'thinking';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'c' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      navigator.clipboard.writeText(entry.text);
    }
  };

  const roleColor = getRoleColor(entry.role, entry.contentType);
  const absoluteTime = formatAbsoluteTime(entry.timestamp);
  const relativeTime = formatRelativeTime(entry.timestamp);

  const copyMessage = () => {
    navigator.clipboard.writeText(entry.text);
  };

  const copyUpToHere = () => {
    // This will be implemented by parent component
    const event = new CustomEvent('copy-transcript-up-to', { detail: { index } });
    window.dispatchEvent(event);
  };

  const copyPermalink = () => {
    const url = `${window.location.href.split('#')[0]}#${msgId}`;
    navigator.clipboard.writeText(url);
  };

  if (isSystem) {
    return (
      <div
        ref={bubbleRef}
        id={msgId}
        tabIndex={focused ? 0 : -1}
        onKeyDown={handleKeyDown}
        onClick={() => onFocus?.(index)}
        className="flex justify-start mb-2 group"
      >
        <div className="text-xs italic text-[var(--color-text-muted)] px-2 py-1">
          {entry.text}
        </div>
      </div>
    );
  }

  if (isThinking) {
    return (
      <div
        ref={bubbleRef}
        id={msgId}
        tabIndex={focused ? 0 : -1}
        onKeyDown={handleKeyDown}
        onClick={() => onFocus?.(index)}
        className="flex justify-start mb-3 group"
      >
        <div className="max-w-[90%] w-full">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed(!collapsed);
            }}
            className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors py-1"
          >
            <Icon 
              name="ChevronRight" 
              size={16}
              className={`transition-transform ${collapsed ? '' : 'rotate-90'}`}
            />
            <span className="italic">Thinking…</span>
          </button>
          {!collapsed && (
            <div className="bg-[var(--color-void)] border border-[var(--color-void-lighter)] rounded-lg px-4 py-3 mt-1 text-sm text-[var(--color-text-muted)] italic leading-relaxed whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
              {entry.text}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isTool) {
    const isFailed = entry.contentType === 'tool_error';
    const toolSummary = entry.text.length > 80 ? entry.text.slice(0, 80) + '…' : entry.text;
    const toolDisplay = collapsed ? toolSummary : entry.text;

    return (
      <div
        ref={bubbleRef}
        id={msgId}
        tabIndex={focused ? 0 : -1}
        onKeyDown={handleKeyDown}
        onClick={() => onFocus?.(index)}
        className="flex justify-start mb-3 group"
      >
        <div className="flex gap-2 max-w-[90%] w-full">
          {absoluteTime && (
            <div
              className="text-[10px] font-mono text-[var(--color-text-muted)] pt-1 w-16 text-right shrink-0"
              title={relativeTime}
              onMouseEnter={() => setShowRelativeTime(true)}
              onMouseLeave={() => setShowRelativeTime(false)}
            >
              {showRelativeTime && relativeTime ? relativeTime : absoluteTime}
            </div>
          )}
          <div className="flex-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed(!collapsed);
              }}
              className={`w-full text-left rounded-lg overflow-hidden border transition-colors ${
                isFailed
                  ? 'border-[var(--color-danger)]/40 bg-[var(--color-void)]'
                  : entry.contentType === 'tool_use'
                  ? 'border-[var(--color-warning)]/30 bg-[var(--color-void)]'
                  : 'border-[var(--color-void-lighter)] bg-[var(--color-void)]'
              }`}
            >
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-void-lighter)]">
                <Icon 
                  name={collapsed ? 'ChevronRight' : 'ChevronDown'} 
                  size={16}
                  className="text-[var(--color-text-muted)]"
                />
                {entry.contentType === 'tool_use' && (
                  <span className="text-xs font-semibold text-[var(--color-warning)] font-mono">
                    &gt; {entry.toolName ?? 'tool'}
                  </span>
                )}
                {entry.contentType === 'tool_result' && (
                  <span className="text-xs font-semibold text-[var(--color-success)] font-mono">
                    ✓ {entry.toolName ?? 'result'}
                  </span>
                )}
                {entry.contentType === 'tool_error' && (
                  <span className="text-xs font-semibold text-[var(--color-danger)] font-mono">
                    ✗ {entry.toolName ?? 'error'}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <CopyButton value={entry.text} label="message" size={16} />
                </div>
              </div>
              {!collapsed && (
                <div className="px-3 py-2 text-xs text-[var(--color-text-muted)] font-mono whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                  {toolDisplay}
                </div>
              )}
              {collapsed && (
                <div className="px-3 py-1.5 text-xs text-[var(--color-text-muted)] font-mono truncate">
                  {toolDisplay}
                </div>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={bubbleRef}
      id={msgId}
      tabIndex={focused ? 0 : -1}
      onKeyDown={handleKeyDown}
      onClick={() => onFocus?.(index)}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3 group`}
    >
      <div className="flex gap-2 max-w-[90%]">
        {!isUser && absoluteTime && (
          <div
            className="text-[10px] font-mono text-[var(--color-text-muted)] pt-1 w-16 text-right shrink-0"
            title={relativeTime}
            onMouseEnter={() => setShowRelativeTime(true)}
            onMouseLeave={() => setShowRelativeTime(false)}
          >
            {showRelativeTime && relativeTime ? relativeTime : absoluteTime}
          </div>
        )}
        <div
          className={`rounded-lg px-4 py-2.5 text-sm leading-relaxed relative ${
            isUser
              ? 'rounded-br-sm'
              : 'rounded-bl-sm border border-[var(--color-void-lighter)]'
          }`}
          style={{
            backgroundColor: isUser ? roleColor : 'var(--color-surface)',
            color: isUser ? 'var(--color-void)' : 'var(--color-text-primary)',
          }}
        >
          <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                copyMessage();
              }}
              className="p-1 rounded hover:bg-[var(--color-void)]/10 transition-colors"
              title="Copy message"
            >
              <Icon name="Copy" size={16} className={isUser ? 'text-[var(--color-void)]' : 'text-[var(--color-text-muted)]'} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                copyUpToHere();
              }}
              className="p-1 rounded hover:bg-[var(--color-void)]/10 transition-colors"
              title="Copy transcript up to here"
            >
              <Icon name="FileText" size={16} className={isUser ? 'text-[var(--color-void)]' : 'text-[var(--color-text-muted)]'} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                copyPermalink();
              }}
              className="p-1 rounded hover:bg-[var(--color-void)]/10 transition-colors"
              title="Copy permalink"
            >
              <Icon name="Link" size={16} className={isUser ? 'text-[var(--color-void)]' : 'text-[var(--color-text-muted)]'} />
            </button>
          </div>
          <RenderWithCodeBlocks text={entry.text} />
          {entry.timestamp && (
            <div className={`text-[10px] mt-1 ${isUser ? 'text-[var(--color-void)]/60' : 'text-[var(--color-text-muted)]'}`}>
              {absoluteTime}
            </div>
          )}
        </div>
        {isUser && absoluteTime && (
          <div
            className="text-[10px] font-mono text-[var(--color-text-muted)] pt-1 w-16 shrink-0"
            title={relativeTime}
            onMouseEnter={() => setShowRelativeTime(true)}
            onMouseLeave={() => setShowRelativeTime(false)}
          >
            {showRelativeTime && relativeTime ? relativeTime : absoluteTime}
          </div>
        )}
      </div>
    </div>
  );
}
