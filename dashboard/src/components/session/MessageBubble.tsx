import { useState } from 'react';
import type { ParsedEntry } from '../../types';
import { RenderWithCodeBlocks } from '../shared/CodeBlock';

const TOOL_ICONS: Record<string, string> = {
  Read: 'R',
  Edit: 'E',
  Write: 'W',
  Bash: 'B',
  Search: 'S',
};

function getToolIcon(toolName?: string): string {
  if (!toolName) return '?';
  return TOOL_ICONS[toolName] ?? toolName.charAt(0).toUpperCase();
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

function TextMessage({ entry }: { entry: ParsedEntry }) {
  const isUser = entry.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[92%] sm:max-w-[86%] rounded-xl px-4 py-3 text-sm leading-6 shadow-sm ${
          isUser
            ? 'bg-[var(--color-accent-purple)] text-[var(--color-text-primary)] rounded-br-sm border border-[var(--color-accent-cyan)]/15'
            : 'bg-[var(--color-surface)] text-[var(--color-text-primary)] rounded-bl-sm border border-[var(--color-void-lighter)]'
        }`}
      >
        <RenderWithCodeBlocks text={entry.text} />
        {entry.timestamp && (
          <div className={`text-[10px] mt-2 uppercase tracking-wide ${isUser ? 'text-[#73738a]' : 'text-[#66667a]'}`}>
            {formatTimestamp(entry.timestamp)}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingBlock({ entry }: { entry: ParsedEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] sm:max-w-[86%] w-full rounded-xl border border-[var(--color-void-lighter)] bg-[var(--color-void)]/70 overflow-hidden">
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-2 text-xs text-[#777] hover:text-[#9a9ab1] transition-colors px-3 py-2"
        >
          <span
            className="inline-block transition-transform duration-200"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            {'>'}
          </span>
          <span className="font-mono uppercase tracking-wide">Thinking</span>
        </button>
        {open && (
          <div className="px-4 pb-3 text-sm text-[#8f90a6] leading-6 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
            {entry.text}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolUseCard({ entry }: { entry: ParsedEntry }) {
  const rawPreview = entry.text;
  const preview = rawPreview.length > 300 ? `${rawPreview.slice(0, 300)}...` : rawPreview;

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] sm:max-w-[86%] w-full rounded-xl overflow-hidden border border-[var(--color-accent-cyan)]/25 bg-[var(--color-void-deepest)]">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-void-lighter)]">
          <span className="w-5 h-5 rounded-full bg-[var(--color-accent-cyan)]/15 text-[var(--color-accent-cyan)] flex items-center justify-center text-[11px] font-mono">
            {getToolIcon(entry.toolName)}
          </span>
          <span className="text-xs font-semibold text-[var(--color-accent-cyan)] font-mono">{entry.toolName ?? 'Tool'}</span>
          <span className="text-[10px] text-[#666] ml-auto uppercase">tool use</span>
        </div>
        <div className="px-3 py-2.5 text-xs text-[#a1a1bb] font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto leading-5">
          {preview}
        </div>
      </div>
    </div>
  );
}

function ToolResultCard({ entry }: { entry: ParsedEntry }) {
  const isError =
    /^\s*error(?:\s*[:\-]|\s*$)/i.test(entry.text)
    || /^\s*(?:failed|exception)(?:\s*[:\-]|\s*$)/i.test(entry.text);

  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[92%] sm:max-w-[86%] w-full rounded-xl overflow-hidden bg-[var(--color-void-deepest)] ${
          isError ? 'border border-[var(--color-error)]/45' : 'border border-[var(--color-success)]/35'
        }`}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-void-lighter)]">
          <span className={`text-[11px] font-semibold uppercase tracking-wide ${isError ? 'text-[var(--color-error)]' : 'text-[var(--color-success)]'}`}>
            {isError ? 'Error Result' : 'Result'}
          </span>
          {entry.toolName && <span className="text-[10px] text-[#666] font-mono">{entry.toolName}</span>}
        </div>
        <div className="px-3 py-2.5 text-xs text-[#b0b0c4] font-mono whitespace-pre-wrap break-all max-h-56 overflow-y-auto leading-5">
          {entry.text || '(empty)'}
        </div>
      </div>
    </div>
  );
}

function PermissionRequestMessage({ entry }: { entry: ParsedEntry }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] sm:max-w-[86%] w-full bg-[var(--color-error-border)] border border-[var(--color-error-bg)] text-[var(--color-error-light)] rounded-xl px-3 py-2.5">
        <div className="text-[11px] uppercase tracking-wide font-semibold text-[var(--color-error-mid)]">Permission Request</div>
        <div className="mt-1.5 text-sm font-mono whitespace-pre-wrap break-words leading-6">{entry.text}</div>
      </div>
    </div>
  );
}

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
