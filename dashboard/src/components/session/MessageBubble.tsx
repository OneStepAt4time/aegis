import { useState } from 'react';
import type { ParsedEntry } from '../../types';
import { RenderWithCodeBlocks } from '../shared/CodeBlock';

const TOOL_ICONS: Record<string, string> = {
  Read: 'ðŸ“–',
  Edit: 'âœï¸',
  Write: 'ðŸ“',
  Bash: 'ðŸ’»',
  Search: 'ðŸ”',
};

function getToolIcon(toolName?: string): string {
  if (!toolName) return 'â“';
  return TOOL_ICONS[toolName] ?? 'â“';
}

function formatTimestamp(ts?: string): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

// â”€â”€â”€ Text Message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function TextMessage({ entry }: { entry: ParsedEntry }) {
  const isUser = entry.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-[var(--color-accent-purple)] text-[var(--color-text-primary)] rounded-br-sm'
            : 'bg-[var(--color-surface)] text-[var(--color-text-primary)] rounded-bl-sm border border-[var(--color-void-lighter)]'
        }`}
      >
        <RenderWithCodeBlocks text={entry.text} />
        {entry.timestamp && (
          <div className={`text-[10px] mt-1 ${isUser ? 'text-[#555]' : 'text-[#444]'}`}>
            {formatTimestamp(entry.timestamp)}
          </div>
        )}
      </div>
    </div>
  );
}

// â”€â”€â”€ Thinking Block â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ThinkingBlock({ entry }: { entry: ParsedEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[80%] w-full">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 text-xs text-[#555] hover:text-[#777] transition-colors py-1 group"
        >
          <span
            className="inline-block transition-transform duration-200"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            â–¶
          </span>
          <span className="italic">Thinkingâ€¦</span>
        </button>
        {open && (
          <div className="bg-[var(--color-void-deepest)] border border-[var(--color-void-lighter)] rounded-lg px-4 py-3 mt-1 text-sm text-[#555] italic leading-relaxed whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
            {entry.text}
          </div>
        )}
      </div>
    </div>
  );
}

// â”€â”€â”€ Tool Use Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ToolUseCard({ entry }: { entry: ParsedEntry }) {
  const rawPreview = entry.text;
  const preview = rawPreview.length > 100 ? rawPreview.slice(0, 100) + 'â€¦' : rawPreview;

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[80%] w-full bg-[var(--color-void-deepest)] border border-[var(--color-void-lighter)] rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-void-lighter)]">
          <span className="text-base">{getToolIcon(entry.toolName)}</span>
          <span className="text-xs font-semibold text-[var(--color-accent)] font-mono">
            {entry.toolName ?? 'Tool'}
          </span>
          <span className="text-[10px] text-[#555] ml-auto">tool_use</span>
        </div>
        <div className="px-3 py-2 text-xs text-[#888] font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
          {preview}
        </div>
      </div>
    </div>
  );
}

// â”€â”€â”€ Tool Result Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ToolResultCard({ entry }: { entry: ParsedEntry }) {
  const isError =
    /^\s*error(?:\s*[:\-]|\s*$)/i.test(entry.text)
    || /^\s*(?:failed|exception)(?:\s*[:\-]|\s*$)/i.test(entry.text);

  return (
    <div className="flex justify-start mb-3">
      <div
        className={`max-w-[80%] w-full bg-[var(--color-void-deepest)] rounded-lg overflow-hidden ${
          isError ? 'border border-[var(--color-error)]/40' : 'border border-[var(--color-success)]/30'
        }`}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-void-lighter)]">
          <span className="text-xs font-semibold text-[#888]">
            {isError ? 'X Result' : 'OK Result'}
          </span>
          {entry.toolName && (
            <span className="text-[10px] text-[#555] font-mono">{entry.toolName}</span>
          )}
        </div>
        <div className="px-3 py-2 text-xs text-[#666] font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
          {entry.text || '(empty)'}
        </div>
      </div>
    </div>
  );
}

function PermissionRequestMessage({ entry }: { entry: ParsedEntry }) {
  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[85%] w-full bg-[var(--color-error-border)] border border-[var(--color-error-bg)] text-[var(--color-error-light)] rounded-lg px-3 py-2">
        <div className="text-[11px] uppercase tracking-wide font-semibold text-[var(--color-error-mid)]">Permission Request</div>
        <div className="mt-1 text-sm font-mono whitespace-pre-wrap break-words">{entry.text}</div>
      </div>
    </div>
  );
}

// â”€â”€â”€ MessageBubble (main export) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function MessageBubble({ entry }: { entry: ParsedEntry }) {
  if (entry.contentType === 'permission_request') {
    return <PermissionRequestMessage entry={entry} />;
  }

  if (entry.role === 'user') {
    return <TextMessage entry={entry} />;
  }

  switch (entry.contentType) {
    case 'text':
      return <TextMessage entry={entry} />;
    case 'thinking':
      return <ThinkingBlock entry={entry} />;
    case 'tool_use':
      return <ToolUseCard entry={entry} />;
    case 'tool_result':
      return <ToolResultCard entry={entry} />;
    default:
      return <TextMessage entry={entry} />;
  }
}

