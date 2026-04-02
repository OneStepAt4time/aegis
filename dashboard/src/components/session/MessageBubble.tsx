import { useState } from 'react';
import DOMPurify from 'dompurify';
import type { ParsedEntry } from '../../types';

/** Strip all HTML tags from untrusted text — defense-in-depth against XSS. */
function sanitizeText(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [] });
}

const TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Edit: '✏️',
  Write: '📝',
  Bash: '💻',
  Search: '🔍',
};

function getToolIcon(toolName?: string): string {
  if (!toolName) return '❓';
  return TOOL_ICONS[toolName] ?? '❓';
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

// ─── Text Message ────────────────────────────────────────────────
function TextMessage({ entry }: { entry: ParsedEntry }) {
  const isUser = entry.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-[#1a1a3e] text-[#e0e0e0] rounded-br-sm'
            : 'bg-[#111118] text-[#e0e0e0] rounded-bl-sm border border-[#1a1a2e]'
        }`}
      >
        <div className="whitespace-pre-wrap break-words">{sanitizeText(entry.text)}</div>
        {entry.timestamp && (
          <div className={`text-[10px] mt-1 ${isUser ? 'text-[#555]' : 'text-[#444]'}`}>
            {formatTimestamp(entry.timestamp)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Thinking Block ──────────────────────────────────────────────
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
            ▶
          </span>
          <span className="italic">Thinking…</span>
        </button>
        {open && (
          <div className="bg-[#0d0d12] border border-[#1a1a2e] rounded-lg px-4 py-3 mt-1 text-sm text-[#555] italic leading-relaxed whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
            {sanitizeText(entry.text)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tool Use Card ───────────────────────────────────────────────
function ToolUseCard({ entry }: { entry: ParsedEntry }) {
  const rawPreview = sanitizeText(entry.text);
  const preview = rawPreview.length > 100 ? rawPreview.slice(0, 100) + '…' : rawPreview;

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[80%] w-full bg-[#0d0d12] border border-[#1a1a2e] rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1a1a2e]">
          <span className="text-base">{getToolIcon(entry.toolName)}</span>
          <span className="text-xs font-semibold text-[#00e5ff] font-mono">
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

// ─── Tool Result Card ────────────────────────────────────────────
function ToolResultCard({ entry }: { entry: ParsedEntry }) {
  const isError =
    entry.text.toLowerCase().startsWith('error');

  return (
    <div className="flex justify-start mb-3">
      <div
        className={`max-w-[80%] w-full bg-[#0d0d12] rounded-lg overflow-hidden ${
          isError ? 'border border-[#ff3366]/40' : 'border border-[#00ff88]/30'
        }`}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#1a1a2e]">
          <span className="text-xs font-semibold text-[#888]">
            {isError ? '✗ Result' : '✓ Result'}
          </span>
          {entry.toolName && (
            <span className="text-[10px] text-[#555] font-mono">{entry.toolName}</span>
          )}
        </div>
        <div className="px-3 py-2 text-xs text-[#666] font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
          {sanitizeText(entry.text) || '(empty)'}
        </div>
      </div>
    </div>
  );
}

// ─── MessageBubble (main export) ─────────────────────────────────
export function MessageBubble({ entry }: { entry: ParsedEntry }) {
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
    case 'permission_request':
      return <div className="text-red-400 text-sm font-semibold px-3 py-2">Permission Request: {sanitizeText(entry.text)}</div>;
    default:
      return <TextMessage entry={entry} />;
  }
}
