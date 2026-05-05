/**
 * components/session/AcpSessionShell.tsx — ACP session detail shell.
 *
 * Main container for the ACP dashboard session view. Provides:
 * - Tabbed content area (Chat, Terminal, Timeline, Transcript)
 * - Persistent control rail sidebar
 * - Responsive layout (collapses rail on mobile)
 *
 * This is the ACP-native replacement for the monolithic SessionDetailPage.
 * Individual views (ACP-081 chat, ACP-086 terminal, ACP-087 timeline)
 * plug in as tab content via children/render props.
 *
 * TODO: Wire to real session data once ACP-061 (REST session routes) lands.
 * TODO: Integrate PauseControlBar, DriverControlBar, AcpApprovalModal.
 */

import { useState, useCallback, type ReactNode } from 'react';
import {
  MessageSquare,
  Terminal,
  Clock,
  FileText,
  PanelRightClose,
  PanelRightOpen,
  ChevronLeft,
  type LucideIcon,
} from 'lucide-react';
import type {
  AcpSessionTab,
  AcpSessionShellConfig,
} from '../../types/acp-session-shell';
import { DEFAULT_SESSION_TABS } from '../../types/acp-session-shell';

/** Map icon name strings to Lucide components. */
const ICON_MAP: Record<string, LucideIcon> = {
  MessageSquare,
  Terminal,
  Clock,
  FileText,
};

export interface AcpSessionShellProps {
  /** Session ID. */
  sessionId: string;
  /** Session status for display. */
  sessionStatus?: string;
  /** Tab configuration. */
  config?: Partial<AcpSessionShellConfig>;
  /** Content renderer for each tab. Keyed by tab ID. */
  children: Record<AcpSessionTab, ReactNode>;
  /** Control rail content. */
  controlRail?: ReactNode;
  /** Whether the shell is loading. */
  isLoading?: boolean;
  /** Error message. */
  error?: string | null;
}

export function AcpSessionShell({
  sessionId,
  sessionStatus,
  config,
  children,
  controlRail,
  isLoading = false,
  error = null,
}: AcpSessionShellProps) {
  const tabs = config?.tabs ?? DEFAULT_SESSION_TABS;
  const defaultTab = config?.defaultTab ?? 'chat';
  const showRailDefault = config?.showControlRail ?? true;

  const [activeTab, setActiveTab] = useState<AcpSessionTab>(defaultTab);
  const [railOpen, setRailOpen] = useState(showRailDefault);

  const handleTabChange = useCallback((tab: AcpSessionTab) => {
    setActiveTab(tab);
  }, []);

  return (
    <div className="flex h-full flex-col bg-[#0a0a0f]" data-session-id={sessionId}>
      {/* Session status bar */}
      <div className="flex items-center justify-between border-b border-[#2a2a3a] px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[#555]">{sessionId.slice(0, 8)}</span>
          {sessionStatus && (
            <span className="rounded bg-[#2a2a3a] px-2 py-0.5 text-xs text-[#888]">
              {sessionStatus}
            </span>
          )}
        </div>
        {controlRail && (
          <button
            type="button"
            onClick={() => setRailOpen((prev) => !prev)}
            className="flex items-center gap-1 rounded-md border border-[#2a2a3a] px-2 py-1 text-xs text-[#888] transition-colors hover:text-[#ccc] hover:border-[#3a3a4a]"
            aria-label={railOpen ? 'Hide control rail' : 'Show control rail'}
            aria-expanded={railOpen}
          >
            {railOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            Controls
          </button>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center justify-center p-4">
          <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400" role="alert">
            {error}
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && !error && (
        <div className="flex items-center justify-center p-8" role="status">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#2a2a3a] border-t-blue-500" />
          <span className="ml-3 text-sm text-[#888]">Loading session...</span>
        </div>
      )}

      {/* Main content area */}
      {!isLoading && !error && (
        <div className="flex flex-1 overflow-hidden">
          {/* Tab content */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Tab bar */}
            <nav
              className="flex items-center border-b border-[#2a2a3a] px-2"
              role="tablist"
              aria-label="Session views"
            >
              {tabs.map((tab) => {
                const Icon = ICON_MAP[tab.icon] ?? MessageSquare;
                const isActive = activeTab === tab.id;
                const isDisabled = tab.disabled;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`tabpanel-${tab.id}`}
                    disabled={isDisabled}
                    onClick={() => !isDisabled && handleTabChange(tab.id)}
                    className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                      isActive
                        ? 'text-[#e0e0e0]'
                        : isDisabled
                          ? 'text-[#333] cursor-not-allowed'
                          : 'text-[#555] hover:text-[#888]'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                    {tab.badge !== undefined && (
                      <span className="ml-1 rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-bold text-blue-400">
                        {tab.badge}
                      </span>
                    )}
                    {/* Active indicator */}
                    {isActive && (
                      <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-blue-500" />
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Tab panels */}
            <div className="flex-1 overflow-auto">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  id={`tabpanel-${tab.id}`}
                  role="tabpanel"
                  aria-labelledby={tab.id}
                  hidden={activeTab !== tab.id}
                  className="h-full"
                >
                  {activeTab === tab.id && (children[tab.id] ?? (
                    <div className="flex h-full items-center justify-center text-sm text-[#555]">
                      {tab.label} view not yet implemented
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Control rail */}
          {railOpen && controlRail && (
            <aside
              className="w-72 shrink-0 overflow-y-auto border-l border-[#2a2a3a] bg-[#12121f]"
              role="complementary"
              aria-label="Session controls"
            >
              {/* Rail close button (mobile) */}
              <div className="flex items-center justify-end border-b border-[#2a2a3a] p-2 lg:hidden">
                <button
                  type="button"
                  onClick={() => setRailOpen(false)}
                  className="rounded-md p-1 text-[#888] hover:text-[#ccc]"
                  aria-label="Close control rail"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-col gap-3 p-3">
                {controlRail}
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
