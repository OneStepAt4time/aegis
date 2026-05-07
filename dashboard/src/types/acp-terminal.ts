/**
 * types/acp-terminal.ts — Types for the ACP terminal debug tab.
 *
 * Per epic §11.4 — diagnostic surface for raw terminal output.
 * Not the primary control model — a debugging aid.
 *
 * Features:
 * - Raw terminal output (xterm.js integration)
 * - Terminal input for authorized drivers
 * - Read-only mode for observers
 * - Terminal resize support
 * - Clear diagnostic indication
 */

/** Terminal session mode. */
export type AcpTerminalMode = 'read-only' | 'driver';

/** Terminal connection state. */
export type AcpTerminalState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/** Terminal size in columns and rows. */
export interface AcpTerminalSize {
  cols: number;
  rows: number;
}

/** Terminal view configuration. */
export interface AcpTerminalConfig {
  /** Terminal mode. */
  mode: AcpTerminalMode;
  /** Initial terminal size. */
  initialSize?: AcpTerminalSize;
  /** Terminal font size in px. */
  fontSize?: number;
  /** Terminal font family. */
  fontFamily?: string;
  /** Whether to show the scrollback buffer. */
  showScrollback?: boolean;
  /** Max scrollback lines. */
  scrollbackLines?: number;
  /** Whether to enable cursor blinking. */
  cursorBlink?: boolean;
  /** Terminal theme (dark only for now). */
  theme?: AcpTerminalTheme;
}

/** Terminal color theme. */
export interface AcpTerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/** Default dark terminal theme matching dashboard aesthetic. */
export const DEFAULT_TERMINAL_THEME: AcpTerminalTheme = {
  background: '#0a0a0f',
  foreground: '#d0d0d0',
  cursor: '#e0e0e0',
  cursorAccent: '#0a0a0f',
  selectionBackground: 'rgba(59, 130, 246, 0.3)',
  black: '#1a1a2a',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e0e0e0',
  brightBlack: '#444',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff',
};

/** Default terminal configuration. */
export const DEFAULT_TERMINAL_CONFIG: Required<AcpTerminalConfig> = {
  mode: 'read-only',
  initialSize: { cols: 80, rows: 24 },
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  showScrollback: true,
  scrollbackLines: 1000,
  cursorBlink: true,
  theme: DEFAULT_TERMINAL_THEME,
};
