import { useState } from 'react';
import type { UIState } from '../../types';

interface PanePreviewProps {
  status: UIState;
  content: string;
  loading: boolean;
}

const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b[()][AB012]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}

export function PanePreview({ status, content, loading }: PanePreviewProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-[#555] text-sm animate-pulse">
        Loading terminalâ€¦
      </div>
    );
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-void-lighter)] rounded-lg overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center justify-between w-full px-4 py-2 text-xs text-[#888] hover:text-[var(--color-text-primary)] transition-colors border-b border-[var(--color-void-lighter)]"
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block transition-transform duration-200"
            style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
          >
            â–¼
          </span>
          <span className="font-mono">Terminal Pane</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: status === 'working' ? 'var(--color-success)' : '#888',
              boxShadow: status === 'working' ? '0 0 4px var(--color-success)' : 'none',
            }}
          />
          <span className="text-[10px] text-[#555] uppercase">
            {status === 'working' ? 'live' : 'idle'}
          </span>
        </div>
      </button>

      {/* Terminal content */}
      {!collapsed && (
        <pre
          className="p-4 text-sm leading-relaxed overflow-auto max-h-[300px]"
          style={{
            backgroundColor: 'var(--color-void-deep)',
            color: 'var(--color-success)',
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          }}
        >
          {content ? stripAnsi(content) : <span className="text-[#444] italic">No terminal output</span>}
        </pre>
      )}
    </div>
  );
}

