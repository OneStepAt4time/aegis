/**
 * components/session/DiffViewer.tsx — File diff viewer for session detail (#2906).
 *
 * Parses Edit/Write tool_use events from transcript and renders
 * an inline diff view with file list sidebar.
 *
 * Data source: ParsedEntry[] from getSessionMessages()
 * - Edit: toolName="edit", text contains JSON with file_path, old_string, new_string
 * - Write: toolName="write", text contains JSON with file_path, content
 */

import { useMemo, useState } from 'react';
import { FileEdit, FilePlus2, File, ChevronRight, Loader2 } from 'lucide-react';
import type { ParsedEntry } from '../../types';

/** A parsed file change from transcript. */
export interface FileChange {
  /** Unique ID for this change. */
  id: string;
  /** File path. */
  filePath: string;
  /** Type of change. */
  type: 'edit' | 'write';
  /** Old content (for edits). */
  oldContent: string | null;
  /** New content. */
  newContent: string;
  /** Timestamp of the change. */
  timestamp: string;
}

/** Parse file changes from transcript entries. */
export function parseFileChanges(entries: ParsedEntry[]): FileChange[] {
  const changes: FileChange[] = [];

  for (const entry of entries) {
    if (entry.contentType !== 'tool_use') continue;

    const toolName = entry.toolName?.toLowerCase();
    if (toolName !== 'edit' && toolName !== 'write') continue;

    try {
      // CC tool input is in the text field — try JSON parse
      const input = JSON.parse(entry.text);
      const filePath = input.file_path ?? input.path ?? '';

      if (!filePath) continue;

      if (toolName === 'edit') {
        const oldStr = input.old_string ?? input.oldText ?? '';
        const newStr = input.new_string ?? input.newText ?? '';
        changes.push({
          id: `${entry.toolUseId ?? entry.timestamp}-${filePath}`,
          filePath,
          type: 'edit',
          oldContent: oldStr,
          newContent: newStr,
          timestamp: entry.timestamp ?? '',
        });
      } else if (toolName === 'write') {
        changes.push({
          id: `${entry.toolUseId ?? entry.timestamp}-${filePath}`,
          filePath,
          type: 'write',
          oldContent: null,
          newContent: input.content ?? '',
          timestamp: entry.timestamp ?? '',
        });
      }
    } catch {
      // Not valid JSON — skip. Some tool_use entries have non-JSON text.
      continue;
    }
  }

  return changes;
}

/** Compute unified diff lines from old and new content. */
export function computeDiff(oldContent: string | null, newContent: string): DiffLine[] {
  const lines: DiffLine[] = [];

  if (oldContent === null) {
    // New file — all lines are additions
    for (const line of newContent.split('\n')) {
      lines.push({ type: 'add', content: line });
    }
    return lines;
  }

  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Simple line-by-line diff (LCS would be better but this works for now)
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine === undefined && newLine !== undefined) {
      lines.push({ type: 'add', content: newLine });
    } else if (oldLine !== undefined && newLine === undefined) {
      lines.push({ type: 'remove', content: oldLine });
    } else if (oldLine !== newLine) {
      lines.push({ type: 'remove', content: oldLine! });
      lines.push({ type: 'add', content: newLine! });
    } else {
      lines.push({ type: 'context', content: oldLine! });
    }
  }

  return lines;
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
}

export interface DiffViewerProps {
  /** Transcript entries to parse for file changes. */
  entries: ParsedEntry[];
  /** Whether transcript is still loading. */
  isLoading?: boolean;
}

export function DiffViewer({ entries, isLoading }: DiffViewerProps) {
  const changes = useMemo(() => parseFileChanges(entries), [entries]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8" role="status" aria-busy="true">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent-cyan)]" />
        <span className="ml-2 text-sm text-[var(--color-text-muted)]">Scanning transcript for file changes…</span>
      </div>
    );
  }

  if (changes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <File className="h-8 w-8 text-[var(--color-text-muted)] opacity-40" aria-hidden="true" />
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">No file changes detected in this session.</p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)] opacity-60">
          Edit and Write operations will appear here as inline diffs.
        </p>
      </div>
    );
  }

  const selectedChange = changes[selectedIndex];

  return (
    <div className="flex h-full min-h-[300px] divide-x divide-[var(--color-border-strong)]" role="region" aria-label="File diff viewer">
      {/* File list sidebar */}
      <nav className="w-56 shrink-0 overflow-y-auto bg-[var(--color-surface)]" aria-label="Changed files">
        <div className="p-2">
          <h3 className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            {changes.length} file{changes.length !== 1 ? 's' : ''} changed
          </h3>
          <ul className="mt-1 space-y-0.5" role="listbox" aria-label="File list">
            {changes.map((change, i) => (
              <li key={change.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === selectedIndex}
                  onClick={() => setSelectedIndex(i)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
                    i === selectedIndex
                      ? 'bg-[var(--color-accent-cyan)]/10 text-[var(--color-accent-cyan)]'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-void-lighter)]'
                  }`}
                >
                  {change.type === 'edit' ? (
                    <FileEdit className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <FilePlus2 className="h-3.5 w-3.5 shrink-0 text-[var(--color-success)]" aria-hidden="true" />
                  )}
                  <span className="truncate font-mono">{change.filePath.split('/').pop()}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Diff content */}
      <div className="flex-1 overflow-auto bg-[var(--color-surface-strong)]">
        {/* File header */}
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2">
          <ChevronRight className="h-3.5 w-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
          <span className="font-mono text-xs text-[var(--color-text-primary)]">{selectedChange.filePath}</span>
          <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
            selectedChange.type === 'edit'
              ? 'bg-amber-500/10 text-amber-400'
              : 'bg-emerald-500/10 text-emerald-400'
          }`}>
            {selectedChange.type === 'edit' ? 'modified' : 'created'}
          </span>
        </div>

        {/* Diff lines */}
        <div className="p-0">
          <DiffContent change={selectedChange} />
        </div>
      </div>
    </div>
  );
}

function DiffContent({ change }: { change: FileChange }) {
  const diffLines = useMemo(() => computeDiff(change.oldContent, change.newContent), [change]);

  return (
    <pre className="text-xs leading-5 font-mono" role="presentation">
      {diffLines.map((line, i) => (
        <div
          key={i}
          className={`flex ${
            line.type === 'add'
              ? 'bg-emerald-500/10'
              : line.type === 'remove'
                ? 'bg-red-500/10'
                : ''
          }`}
        >
          <span className="w-8 shrink-0 select-none text-right pr-2 text-[var(--color-text-muted)] opacity-40">
            {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
          </span>
          <span className={
            line.type === 'add'
              ? 'text-emerald-400'
              : line.type === 'remove'
                ? 'text-red-400'
                : 'text-[var(--color-text-muted)]'
          }>
            {line.content}
          </span>
        </div>
      ))}
    </pre>
  );
}
