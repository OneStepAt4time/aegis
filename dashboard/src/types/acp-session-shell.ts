/**
 * types/acp-session-shell.ts — Types for the ACP session shell and control rail.
 *
 * The session shell is the main container for the ACP dashboard session detail view.
 * It provides a tabbed layout (Chat, Terminal, Timeline) with a persistent control rail.
 *
 * From epic §11.1–11.2:
 *   - Tabs: Chat, Terminal Debug, Timeline, Transcript
 *   - Control rail: state, driver/observer, pause/resume, approval, metrics
 */

/** Available tabs in the session shell. */
export type AcpSessionTab = 'chat' | 'terminal' | 'timeline' | 'transcript';

/** Configuration for each tab. */
export interface AcpSessionTabConfig {
  id: AcpSessionTab;
  label: string;
  icon: string; // Lucide icon name
  disabled?: boolean;
  badge?: string | number;
}

/** Default tab configuration. */
export const DEFAULT_SESSION_TABS: AcpSessionTabConfig[] = [
  { id: 'chat', label: 'Chat', icon: 'MessageSquare' },
  { id: 'terminal', label: 'Terminal', icon: 'Terminal' },
  { id: 'timeline', label: 'Timeline', icon: 'Clock' },
  { id: 'transcript', label: 'Transcript', icon: 'FileText' },
];

/** Control rail section — groups related controls together. */
export interface AcpControlRailSection {
  id: string;
  label?: string;
  /** Whether this section is collapsible. */
  collapsible?: boolean;
  /** Whether this section starts collapsed. */
  defaultCollapsed?: boolean;
}

/** Session shell layout configuration. */
export interface AcpSessionShellConfig {
  /** Available tabs. */
  tabs: AcpSessionTabConfig[];
  /** Default active tab. */
  defaultTab?: AcpSessionTab;
  /** Whether the control rail is visible by default. */
  showControlRail?: boolean;
  /** Whether the control rail is on the right side. */
  controlRailRight?: boolean;
  /** Control rail width in pixels. */
  controlRailWidth?: number;
}
