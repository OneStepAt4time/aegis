import { useState } from 'react';
import type { UIState } from '../../types';

interface PanePreviewProps {
  sessionId: string;
  status: UIState;
  content: string;
  loading: boolean;
}

export function PanePreview({ status, content, loading }: PanePreviewProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-[#555] text-sm animate-pulse">
        Loading terminal…
      </div>
    );
  }

  return (
    <div className="bg-[#111118] border border-[#1a1a2e] rounded-lg overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center justify-between w-full px-4 py-2 text-xs text-[#888] hover:text-[#e0e0e0] transition-colors border-b border-[#1a1a2e]"
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block transition-transform duration-200"
            style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
          >
            ▼
          </span>
          <span className="font-mono">Terminal Pane</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: status === 'working' ? '#00ff88' : '#888',
              boxShadow: status === 'working' ? '0 0 4px #00ff88' : 'none',
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
            backgroundColor: '#000000',
            color: '#00ff88',
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          }}
        >
          {content || <span className="text-[#444] italic">No terminal output</span>}
        </pre>
      )}
    </div>
  );
}
