/**
 * terminal-parser.ts — Detects Claude Code UI state from tmux pane content.
 *
 * Port of CCBot's terminal_parser.py.
 * Detects: permission prompts, plan mode, ask questions, status line.
 *
 * Phase 2 (issue #2204): raw pane text is fed through VT100Screen to strip
 * ANSI/VT100 escape sequences before pattern matching.
 */

import { VT100Screen } from './vt100-screen.js';

export type UIState =
  | 'idle'               // CC finished work, at prompt with chrome separator
  | 'working'            // CC is actively processing
  | 'compacting'         // CC is compacting context to save tokens
  | 'context_warning'    // CC context window is getting full (percentage warning)
  | 'waiting_for_input'  // CC is waiting for user input (no chrome separator)
  | 'permission_prompt'  // CC is asking for permission (yes/no)
  | 'plan_mode'          // CC is showing a plan and asking to proceed
  | 'ask_question'       // CC is asking the user a question
  | 'bash_approval'      // CC is asking to approve a bash command
  | 'settings'           // CC settings modal is open
  | 'error'              // CC encountered an API/transient error
  | 'unknown';           // Can't determine state

interface UIPattern {
  name: UIState;
  top: RegExp[];
  bottom: RegExp[];
  minGap: number;
}

const UI_PATTERNS: UIPattern[] = [
  {
    name: 'plan_mode',
    top: [
      /^\s*Would you like to proceed\?/,
      /^\s*Claude has written up a plan/,
    ],
    bottom: [
      /^\s*ctrl-g to edit in /,
      /^\s*Esc to (cancel|exit)/,
    ],
    minGap: 2,
  },
  {
    name: 'ask_question',
    top: [/^\s*[☐✔☒]/],
    bottom: [/^\s*Enter to select/],
    minGap: 1,
  },
  {
    name: 'permission_prompt',
    top: [
      /^\s*Do you want to proceed\?/,
      /^\s*Do you want to make this edit/,
      /^\s*Do you want to create \S/,
      /^\s*Do you want to delete \S/,
      /^\s*Do you want to allow Claude to make these changes/,  // batch edit
      /^\s*Do you want to allow Claude to use/,                 // MCP tool
      /^\s*Do you want to trust this (project|workspace)/,      // workspace trust (old)
      /^\s*Quick safety check/,                                  // workspace trust (CC ≥2.1.92)
      /^\s*Is this a project you created/,                       // workspace trust alt text
      /^\s*Do you want to allow (reading|writing)/,             // file scope
      /^\s*Do you want to run this command/,                    // alt bash approval
      /^\s*Do you want to allow writing to/,                    // file write scope
      /^\s*Continue\?/,                                         // continuation
    ],
    bottom: [/^\s*Esc to cancel/],
    minGap: 2,
  },
  {
    name: 'permission_prompt',
    top: [/^\s*❯\s*1\.\s*Yes/],
    bottom: [],
    minGap: 2,
  },
  {
    name: 'bash_approval',
    top: [
      /^\s*Bash command\s*$/,
      /^\s*This command requires approval/,
    ],
    bottom: [/^\s*Esc to cancel/],
    minGap: 2,
  },
  {
    name: 'settings',
    top: [
      /^\s*Settings:.*tab to cycle/,
      /^\s*Select model/,
    ],
    bottom: [
      /^\s*Esc to cancel/,
      /^\s*Esc to exit/,
      /^\s*Enter to confirm/,
      /^\s*Type to filter/,
    ],
    minGap: 2,
  },
  {
    name: 'error',
    top: [
      /^Error:/,
      /Rate limit/,
      /Authentication failed/,
      /overloaded/i,
      /API error/,
      /^429\b/,
    ],
    bottom: [/^\s*❯\s*$/],
    minGap: 1,
  },
];

// Spinner characters Claude Code uses (including braille spinners with TERM=xterm-256color)
// Issue #102: CC also uses * (asterisk) and ● (bullet) for status lines like "* Perambulating…"
const STATUS_SPINNERS = new Set([
  '·', '✻', '✽', '✶', '✳', '✢', '*', '●',
  '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏',
  '⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷',
]);

/**
 * Feed raw pane text through a VT100 screen buffer to produce clean rendered text.
 * Strips all ANSI/VT100 escape sequences, DCS, OSC, and cursor positioning codes
 * that `capture-pane -p` includes in its output.
 */
function cleanPaneText(paneText: string): string {
  const rawLines = paneText.split('\n');
  const cols = 200;
  const rows = Math.max(rawLines.length, 1);
  const screen = new VT100Screen(cols, rows);
  // capture-pane output uses LF-only line endings; VT100 needs CR+LF
  // to return cursor to column 0 before advancing to the next row.
  screen.write(paneText.replace(/\r?\n/g, '\r\n'));
  return screen.getText().trim();
}

/** Detect the UI state from captured pane text. */
export function detectUIState(paneText: string): UIState {
  if (!paneText) return 'unknown';

  const lines = cleanPaneText(paneText).split('\n');

  // Check for interactive UI patterns first (highest priority)
  for (const pattern of UI_PATTERNS) {
    if (tryMatchPattern(lines, pattern)) {
      return pattern.name;
    }
  }

  // Check for working status — scan entire pane for active spinners
  const statusText = parseStatusLine(paneText);
  const hasActiveSpinner = hasSpinnerAnywhere(lines);

  // Check for the prompt (❯) near the bottom
  const hasPrompt = hasIdlePrompt(lines);
  const hasChrome = hasChromeSeparator(lines);

  if (statusText) {
    // "Worked for Xs" = finished, not working; "Aborted" = CC was interrupted
    if (/^Worked for/i.test(statusText) || /^Compacted/i.test(statusText) || /aborted/i.test(statusText)) {
      return hasPrompt ? 'idle' : 'unknown';
    }
    // Pure turn counter "4" is a stale spinner, not active work
    if (/^\d+$/.test(statusText) && hasPrompt && hasChrome) {
      return 'idle';
    }
    // Prompt + chrome separator present means CC is actually idle,
    // even if parseStatusLine found a stale spinner from scrollback
    if (hasPrompt && hasChrome) {
      return 'idle';
    }
    // Active spinner text = working
    return 'working';
  }

  // Even without parseStatusLine match, if we see active spinners → working
  if (hasActiveSpinner) {
    return 'working';
  }

  // L30: Check for compacting state — CC shows "Compacting..." when compacting context
  // Checked after working so active spinners take priority over compacting text
  const compactingState = detectCompacting(lines);
  if (compactingState) return 'compacting';

  // L31: Check for context window warning — CC shows "Context window X% full" or "context window exceeded"
  const contextWarning = detectContextWarning(lines);
  if (contextWarning) return 'context_warning';

  if (hasPrompt) {
    // L32: Differentiate idle (chrome separator present) vs waiting_for_input (no chrome)
    return hasChrome ? 'idle' : 'waiting_for_input';
  }

  // Check for chrome separator (─────) near bottom = CC is loaded
  if (hasChrome) {
    return 'idle';
  }

  // L32: Check for waiting-for-input patterns without the idle separator
  if (detectWaitingForInput(lines)) return 'waiting_for_input';

  return 'unknown';
}

/** Number of lines from the bottom of the pane to scan for active spinners. */
const SPINNER_SEARCH_LINES = 30;

/** Check if any line in the pane has an active spinner character followed by working text. */
function hasSpinnerAnywhere(lines: string[]): boolean {
  // Only check lines in the content area (not the very bottom few which are prompt/footer)
  const searchEnd = Math.max(0, lines.length - 3);
  for (let i = Math.max(0, lines.length - SPINNER_SEARCH_LINES); i < searchEnd; i++) {
    const stripped = lines[i].trim();
    if (!stripped) continue;
    // Check for spinner characters at start of line, followed by text containing "…" or "..."
    const firstChar = stripped[0];
    if (STATUS_SPINNERS.has(firstChar) && stripped.length > 1) {
      // For `*` (also a markdown bullet), require `* ` + ellipsis/dots to avoid false positives
      if (firstChar === '*') {
        if (stripped[1] !== ' ' || !(stripped.includes('…') || stripped.includes('...'))) continue;
      } else if (firstChar === '●' && /^\d+\s*$/.test(stripped.slice(1).trim())) {
        continue;
      } else if (!(stripped.includes('…') || stripped.includes('...') || /[^\s\u00a0]/.test(stripped.slice(1)))) {
        continue;
      }
      // Exclude "Worked for" which is a completion indicator, and "Aborted" which means CC stopped
      if (/^.Worked for/i.test(stripped) || /^.Compacted/i.test(stripped) || /aborted/i.test(stripped)) continue;
      return true;
    }
  }
  return false;
}

/** Check if the prompt ❯ is visible between chrome separators. */
function hasIdlePrompt(lines: string[]): boolean {
  // Look for ❯ on its own line near the bottom, between two ─── separators
  for (let i = Math.max(0, lines.length - 8); i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (stripped === '❯' || stripped === '❯\u00a0' || stripped.startsWith('❯ ') || stripped.startsWith('❯\u00a0')) {
      return true;
    }
  }
  return false;
}

/** Check if a chrome separator (─────) is present near the bottom of the pane. */
function hasChromeSeparator(lines: string[]): boolean {
  for (let i = Math.max(0, lines.length - 10); i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (stripped.length >= 20 && /^─+$/.test(stripped)) {
      return true;
    }
  }
  return false;
}

/** L30: Detect compacting state — CC shows "Compacting..." when compacting context. */
function detectCompacting(lines: string[]): boolean {
  // Check last 15 lines for compacting indicators
  const searchStart = Math.max(0, lines.length - 15);
  for (let i = searchStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/compacting/i.test(line) && !/compacted/i.test(line)) {
      return true;
    }
  }
  return false;
}

/** L31: Detect context window warning — CC shows "Context window X% full" or "context window exceeded" or "context window exceeded". */
function detectContextWarning(lines: string[]): boolean {
  // Check last 15 lines for context window warnings
  const searchStart = Math.max(0, lines.length - 15);
  for (let i = searchStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Match "Context window 85% full" (percentage) OR "context window exceeded" (hard crash, no percentage)
    if (/context\s+window/i.test(line) && (/(\d+)%/.test(line) || /exceeded/i.test(line))) {
      return true;
    }
  }
  return false;
}

/** L32: Detect waiting-for-input state — CC prompt without chrome separator. */
function detectWaitingForInput(lines: string[]): boolean {
  // Look for prompt-like text near the bottom without the chrome separator
  const searchStart = Math.max(0, lines.length - 8);
  for (let i = searchStart; i < lines.length; i++) {
    const stripped = lines[i].trim();
    // ❯ with text (but not bare ❯ which is idle)
    if ((stripped.startsWith('❯ ') || stripped.startsWith('❯\u00a0')) && stripped.length > 2) {
      return true;
    }
    // CC asking questions like "What would you like to do?" near bottom
    if (/^(What would you like|What do you want|How would you like|How should I)/i.test(stripped)) {
      return true;
    }
  }
  return false;
}

/** Extract the interactive UI content if present. */
export function extractInteractiveContent(paneText: string): { content: string; name: UIState } | null {
  if (!paneText) return null;

  const lines = cleanPaneText(paneText).split('\n');
  for (const pattern of UI_PATTERNS) {
    const result = extractPattern(lines, pattern);
    if (result) return { content: result, name: pattern.name };
  }
  return null;
}

/** Parse the status line text (what CC is doing). */
export function parseStatusLine(paneText: string): string | null {
  if (!paneText) return null;

  const lines = cleanPaneText(paneText).split('\n');

  // Find the bottom-most chrome separator (scan upward from bottom)
  let chromeIdx: number | null = null;
  const searchFloor = Math.max(0, lines.length - 10);
  for (let i = lines.length - 1; i >= searchFloor; i--) {
    const stripped = lines[i].trim();
    if (stripped.length >= 20 && /^─+$/.test(stripped)) {
      chromeIdx = i;
      break;
    }
  }

  if (chromeIdx === null) return null;

  // Check lines above separator for spinner
  for (let i = chromeIdx - 1; i > Math.max(chromeIdx - 10, -1); i--) {
    const line = lines[i].trim();
    // Stop at the top chrome separator — don't scan into previous turn's scrollback
    if (line.length >= 20 && /^─+$/.test(line)) {
      break;
    }
    if (!line) continue;
    if (STATUS_SPINNERS.has(line[0])) {
      // For `*`, require `* ` + ellipsis/dots to avoid matching markdown bullets
      if (line[0] === '*' && (line[1] !== ' ' || !(line.includes('…') || line.includes('...')))) {
        // Not a real spinner line — skip
        continue;
      }
      // Exclude bare bullet + number (turn counter, e.g. "● 4") — not an active spinner
      if (line[0] === '●' && /^\d+\s*$/.test(line.slice(1).trim())) {
        continue;
      }
      return line.slice(1).trim();
    }
    // Skip non-spinner lines (tool output between spinner and separator) and keep scanning
  }
  return null;
}

/**
 * Parse the duration from a "Cogitated for Xm Ys" status text.
 * CC shows this during extended thinking mode.
 * Returns duration in ms, or null if the pattern doesn't match.
 */
export function parseCogitatedDuration(statusText: string): number | null {
  const match = /^Cogitated for\s+(\d+)m\s+(\d+)s/i.exec(statusText.trim());
  if (!match) return null;
  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  return (minutes * 60 + seconds) * 1000;
}

function tryMatchPattern(lines: string[], pattern: UIPattern): boolean {
  // Only search the last 30 lines to avoid matching scrollback text
  const searchStart = Math.max(0, lines.length - 30);

  // Try each top match — don't give up after the first one fails to find a bottom
  for (let t = searchStart; t < lines.length; t++) {
    if (!pattern.top.some(re => re.test(lines[t]))) continue;

    if (pattern.bottom.length === 0) {
      const lastNonEmpty = findLastNonEmpty(lines, t + 1);
      if (lastNonEmpty !== null && lastNonEmpty - t >= pattern.minGap) {
        return true;
      }
      continue;
    }

    // Search for a matching bottom after this top
    for (let b = t + 1; b < lines.length; b++) {
      if (pattern.bottom.some(re => re.test(lines[b]))) {
        if (b - t >= pattern.minGap) {
          return true;
        }
      }
    }
    // No matching bottom for this top — try next top match
  }

  return false;
}

function extractPattern(lines: string[], pattern: UIPattern): string | null {
  let topIdx: number | null = null;
  let bottomIdx: number | null = null;

  // Only search the last 30 lines to avoid matching scrollback text
  const searchStart = Math.max(0, lines.length - 30);
  for (let i = searchStart; i < lines.length; i++) {
    if (topIdx === null) {
      if (pattern.top.some(re => re.test(lines[i]))) {
        topIdx = i;
      }
    } else if (pattern.bottom.length > 0 && pattern.bottom.some(re => re.test(lines[i]))) {
      bottomIdx = i;
      break;
    }
  }

  if (topIdx === null) return null;

  if (pattern.bottom.length === 0) {
    bottomIdx = findLastNonEmpty(lines, topIdx + 1);
  }

  if (bottomIdx === null || bottomIdx - topIdx < pattern.minGap) return null;

  return lines.slice(topIdx, bottomIdx + 1).join('\n').trimEnd();
}

function findLastNonEmpty(lines: string[], from: number = 0): number | null {
  let last: number | null = null;
  for (let i = from; i < lines.length; i++) {
    if (lines[i].trim()) last = i;
  }
  return last;
}
