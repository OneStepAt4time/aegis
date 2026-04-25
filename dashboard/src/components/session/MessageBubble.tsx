import { useState } from 'react';
import type { ParsedEntry } from '../../types';
import { RenderWithCodeBlocks } from '../shared/CodeBlock';

const TOOL_ICONS: Record<string, string> = {
  Read: '\u{1F4D6}',
  Edit: '\u270F\uFE0F',
  Write: '\u{1F4DD}',
  Bash: '\u{1F4BB}',
  Search: '\u{1F50D}',
};

function getToolIcon(toolName?: string): string {
  if (!toolName) return '\u2753';
  return TOOL_ICONS[toolName] ?? '\u2753';
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

/** Check if text contains markdown fenced code blocks. */
function hasCodeBlocks(text: string): boolean {
  return /```\w*\n?[\s\S]*?```/.test(text);
}

// ── Text Message ─────────────────────────────────────────────────────
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

// ── Thinking Block ───────────────────────────────────────────────────
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
            \u25B6
          </span>
          <span className="italic">Thinking\u2026</span>
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

// ── Tool Use Card ────────────────────────────────────────────────────
function ToolUseCard({ entry }: { entry: ParsedEntry }) {
  const [expanded, setExpanded] = useState(false);
  const rawText = entry.text;
  const containsCodeBlocks = hasCodeBlocks(rawText);

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
        {containsCodeBlocks ? (
          <div className={`px-3 py-2 overflow-y-auto ${expanded ? 'max-h-[600px]' : 'max-h-32'}`}>
            <RenderWithCodeBlocks text={rawText} />
          </div>
        ) : (
          <div className={`px-3 py-2 text-xs text-[#888] font-mono whitespace-pre-wrap break-all overflow-y-auto ${expanded ? 'max-h-[600px]' : 'max-h-32'}`}>
            {expanded ? rawText : (rawText.length > 100 ? rawText.slice(0, 100) + '\u2026' : rawText)}
          </div>
        )}
        {rawText.length > 100 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="w-full text-[10px] text-[#555] hover:text-[#888] py-1 border-t border-[var(--color-void-lighter)] transition-colors"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tool Result Card ─────────────────────────────────────────────────
function ToolResultCard({ entry }: { entry: ParsedEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isError =
    /^\s*error(?:\s*[:\-]|\s*$)/i.test(entry.text)
    || /^\s*(?:failed|exception)(?:\s*[:\-]|\s*$)/i.test(entry.text);
  const rawText = entry.text || '(empty)';
  const containsCodeBlocks = hasCodeBlocks(rawText);

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
        {containsCodeBlocks ? (
          <div className={`px-3 py-2 overflow-y-auto ${expanded ? 'max-h-[600px]' : 'max-h-32'}`}>
            <RenderWithCodeBlocks text={rawText} />
          </div>
        ) : (
          <div className={`px-3 py-2 text-xs text-[#666] font-mono whitespace-pre-wrap break-all overflow-y-auto ${expanded ? 'max-h-[600px]' : 'max-h-32'}`}>
            {expanded ? rawText : (rawText.length > 100 ? rawText.slice(0, 100) + '\u2026' : rawText)}
          </div>
        )}
        {rawText.length > 100 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="w-full text-[10px] text-[#555] hover:text-[#888] py-1 border-t border-[var(--color-void-lighter)] transition-colors"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
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

// ── MessageBubble (main export) ──────────────────────────────────────
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
