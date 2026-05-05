/**
 * components/session/ToolCallCard.tsx — Tool call and diff cards for ACP chat view.
 *
 * Replaces the placeholder ToolCallPlaceholder in AcpChatView.
 * Displays:
 * - Tool name, status, duration
 * - Input preview (collapsible)
 * - Output/result preview
 * - File diffs with syntax highlighting (additions/deletions)
 * - Error display for failed tools
 *
 * Integrates with AcpChatView types from acp-chat.ts.
 *
 * TODO: Wire to real tool events once ACP-025 lands.
 * TODO: Add syntax highlighting for diffs (consider prism-react-renderer or similar).
 */

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  FileEdit,
  Terminal,
  Globe,
  Search,
  Code,
  AlertTriangle,
} from 'lucide-react';
import type { AcpToolCall, AcpFileDiff } from '../../types/acp-chat';

/** Tool icon mapping. */
function getToolIcon(toolName: string) {
  const lower = toolName.toLowerCase();
  if (lower.includes('bash') || lower.includes('shell') || lower.includes('exec')) return Terminal;
  if (lower.includes('edit') || lower.includes('write') || lower.includes('file')) return FileEdit;
  if (lower.includes('fetch') || lower.includes('http') || lower.includes('web')) return Globe;
  if (lower.includes('search') || lower.includes('grep') || lower.includes('find')) return Search;
  if (lower.includes('read')) return Code;
  return AlertTriangle;
}

/** Status configuration. */
const STATUS_CONFIG: Record<string, { label: string; icon: typeof Loader2; color: string; bgColor: string }> = {
  pending: { label: 'Pending', icon: Clock, color: 'text-[#888]', bgColor: 'bg-[#2a2a3a]' },
  running: { label: 'Running', icon: Loader2, color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
  completed: { label: 'Completed', icon: CheckCircle, color: 'text-green-400', bgColor: 'bg-green-500/10' },
  failed: { label: 'Failed', icon: XCircle, color: 'text-red-400', bgColor: 'bg-red-500/10' },
  cancelled: { label: 'Cancelled', icon: XCircle, color: 'text-[#888]', bgColor: 'bg-[#2a2a3a]' },
};

/** Diff line renderer. */
function DiffLine({ line }: { line: string }) {
  const isAddition = line.startsWith('+');
  const isDeletion = line.startsWith('-');
  const isHunk = line.startsWith('@@');

  return (
    <div
      className={`font-mono text-xs leading-5 ${
        isHunk
          ? 'text-[#555] bg-[#1a1a2a]'
          : isAddition
            ? 'text-green-400 bg-green-500/5'
            : isDeletion
              ? 'text-red-400 bg-red-500/5'
              : 'text-[#888]'
      }`}
    >
      {line || '\u00A0'}
    </div>
  );
}

/** File diff card. */
function FileDiffCard({ diff }: { diff: AcpFileDiff }) {
  const [expanded, setExpanded] = useState(false);
  const lines = diff.diff.split('\n');

  return (
    <div className="mt-2 rounded-lg border border-[#2a2a3a] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[#888] hover:bg-[#1a1a2a] transition-colors"
        aria-expanded={expanded}
        aria-controls={`diff-${diff.filePath}`}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <FileEdit className="h-3 w-3 text-[#555]" />
        <span className="font-mono">{diff.filePath}</span>
        {diff.additions !== undefined && (
          <span className="text-green-400">+{diff.additions}</span>
        )}
        {diff.deletions !== undefined && (
          <span className="text-red-400">-{diff.deletions}</span>
        )}
      </button>
      {expanded && (
        <div
          id={`diff-${diff.filePath}`}
          className="max-h-64 overflow-auto bg-[#0a0a0f] px-3 py-1"
        >
          {lines.map((line, i) => (
            <DiffLine key={i} line={line} />
          ))}
        </div>
      )}
    </div>
  );
}

export interface ToolCallCardProps {
  toolCall: AcpToolCall;
  /** Whether to show input preview by default. */
  showInput?: boolean;
}

export function ToolCallCard({ toolCall, showInput = false }: ToolCallCardProps) {
  const [inputExpanded, setInputExpanded] = useState(showInput);
  const [outputExpanded, setOutputExpanded] = useState(false);

  const statusConfig = STATUS_CONFIG[toolCall.status] ?? STATUS_CONFIG.pending;
  const StatusIcon = statusConfig.icon;
  const ToolIcon = getToolIcon(toolCall.toolName);
  const result = toolCall.result;

  return (
    <div
      className={`my-2 rounded-lg border border-[#2a2a3a] overflow-hidden ${statusConfig.bgColor}`}
      role="article"
      aria-label={`Tool call: ${toolCall.toolName}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <ToolIcon className="h-4 w-4 text-[#555] shrink-0" />
        <span className="font-mono text-sm font-medium text-[#e0e0e0]">{toolCall.toolName}</span>
        <span className={`ml-auto flex items-center gap-1 text-xs ${statusConfig.color}`}>
          <StatusIcon className={`h-3.5 w-3.5 ${toolCall.status === 'running' ? 'animate-spin' : ''}`} />
          {statusConfig.label}
        </span>
        {result?.durationMs !== undefined && (
          <span className="text-[10px] text-[#555]">
            {(result.durationMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* Input preview toggle */}
      {toolCall.input && Object.keys(toolCall.input).length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setInputExpanded((prev) => !prev)}
            className="flex w-full items-center gap-1 border-t border-[#2a2a3a] px-3 py-1.5 text-xs text-[#555] hover:bg-[#1a1a2a] transition-colors"
            aria-expanded={inputExpanded}
          >
            {inputExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Input
          </button>
          {inputExpanded && (
            <pre className="max-h-40 overflow-auto border-t border-[#2a2a3a] bg-[#0a0a0f] p-3 font-mono text-xs text-[#888]">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Error display */}
      {result?.error && (
        <div className="flex items-start gap-2 border-t border-[#2a2a3a] bg-red-500/5 px-3 py-2">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <pre className="flex-1 whitespace-pre-wrap break-words font-mono text-xs text-red-400">
            {result.error}
          </pre>
        </div>
      )}

      {/* Output preview toggle */}
      {result?.output && (
        <div>
          <button
            type="button"
            onClick={() => setOutputExpanded((prev) => !prev)}
            className="flex w-full items-center gap-1 border-t border-[#2a2a3a] px-3 py-1.5 text-xs text-[#555] hover:bg-[#1a1a2a] transition-colors"
            aria-expanded={outputExpanded}
          >
            {outputExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Output
          </button>
          {outputExpanded && (
            <pre className="max-h-40 overflow-auto border-t border-[#2a2a3a] bg-[#0a0a0f] p-3 font-mono text-xs text-[#888] whitespace-pre-wrap break-words">
              {result.output}
            </pre>
          )}
        </div>
      )}

      {/* File diffs */}
      {result?.diffs && result.diffs.length > 0 && (
        <div className="border-t border-[#2a2a3a] px-3 py-2">
          <span className="text-xs font-medium text-[#555]">
            {result.diffs.length} file{result.diffs.length > 1 ? 's' : ''} changed
          </span>
          {result.diffs.map((diff, i) => (
            <FileDiffCard key={`${diff.filePath}-${i}`} diff={diff} />
          ))}
        </div>
      )}
    </div>
  );
}
