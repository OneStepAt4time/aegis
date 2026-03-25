/**
 * terminal-parser.ts — Detects Claude Code UI state from tmux pane content.
 * 
 * Port of CCBot's terminal_parser.py.
 * Detects: permission prompts, plan mode, ask questions, status line.
 */

export type UIState = 
  | 'idle'               // CC is at the prompt, waiting for user input
  | 'working'            // CC is actively processing  
  | 'permission_prompt'  // CC is asking for permission (yes/no)
  | 'plan_mode'          // CC is showing a plan and asking to proceed
  | 'ask_question'       // CC is asking the user a question
  | 'bash_approval'      // CC is asking to approve a bash command
  | 'settings'           // CC settings modal is open
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
      /^\s*Do you want to trust this (project|workspace)/,      // workspace trust
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
      /Esc to cancel/,
      /Esc to exit/,
      /Enter to confirm/,
      /^\s*Type to filter/,
    ],
    minGap: 2,
  },
];

// Spinner characters Claude Code uses (including braille spinners with TERM=xterm-256color)
// Issue #102: CC also uses * (asterisk) and ● (bullet) for status lines like "* Perambulating…"
const STATUS_SPINNERS = new Set([
  '·', '✻', '✽', '✶', '✳', '✢', '*', '●',
  '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏',
  '⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷',
]);

/** Detect the UI state from captured pane text. */
export function detectUIState(paneText: string): UIState {
  if (!paneText) return 'unknown';

  const lines = paneText.trim().split('\n');

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

  if (statusText) {
    // "Worked for Xs" = finished, not working
    if (/^Worked for/i.test(statusText) || /^Compacted/i.test(statusText)) {
      return hasPrompt ? 'idle' : 'unknown';
    }
    // Active spinner text = working regardless of prompt
    return 'working';
  }

  // Even without parseStatusLine match, if we see active spinners → working
  if (hasActiveSpinner) {
    return 'working';
  }

  if (hasPrompt) {
    return 'idle';
  }

  // Check for chrome separator (─────) near bottom = CC is loaded
  for (let i = Math.max(0, lines.length - 10); i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (stripped.length >= 20 && /^─+$/.test(stripped)) {
      return 'idle'; // Has chrome, probably at prompt
    }
  }

  return 'unknown';
}

/** Check if any line in the pane has an active spinner character followed by working text. */
function hasSpinnerAnywhere(lines: string[]): boolean {
  // Only check lines in the content area (not the very bottom few which are prompt/footer)
  const searchEnd = Math.max(0, lines.length - 3);
  for (let i = Math.max(0, lines.length - 20); i < searchEnd; i++) {
    const stripped = lines[i].trim();
    if (!stripped) continue;
    // Check for spinner characters at start of line, followed by text containing "…" or "..."
    if (STATUS_SPINNERS.has(stripped[0]) && (stripped.includes('…') || stripped.includes('...'))) {
      // Exclude "Worked for" which is a completion indicator
      if (/^.Worked for/i.test(stripped) || /^.Compacted/i.test(stripped)) continue;
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
    if (stripped === '❯' || stripped === '❯\u00a0' || stripped === '❯ ') {
      return true;
    }
  }
  return false;
}

/** Extract the interactive UI content if present. */
export function extractInteractiveContent(paneText: string): { content: string; name: UIState } | null {
  if (!paneText) return null;
  
  const lines = paneText.trim().split('\n');
  for (const pattern of UI_PATTERNS) {
    const result = extractPattern(lines, pattern);
    if (result) return { content: result, name: pattern.name };
  }
  return null;
}

/** Parse the status line text (what CC is doing). */
export function parseStatusLine(paneText: string): string | null {
  if (!paneText) return null;

  const lines = paneText.split('\n');

  // Find chrome separator
  let chromeIdx: number | null = null;
  const searchStart = Math.max(0, lines.length - 10);
  for (let i = searchStart; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (stripped.length >= 20 && /^─+$/.test(stripped)) {
      chromeIdx = i;
      break;
    }
  }

  if (chromeIdx === null) return null;

  // Check lines above separator for spinner
  for (let i = chromeIdx - 1; i > Math.max(chromeIdx - 5, -1); i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (STATUS_SPINNERS.has(line[0])) {
      return line.slice(1).trim();
    }
    return null; // First non-empty line isn't a spinner
  }
  return null;
}

function tryMatchPattern(lines: string[], pattern: UIPattern): boolean {
  let topIdx: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (topIdx === null) {
      if (pattern.top.some(re => re.test(lines[i]))) {
        topIdx = i;
      }
    } else if (pattern.bottom.length > 0) {
      if (pattern.bottom.some(re => re.test(lines[i]))) {
        return i - topIdx >= pattern.minGap;
      }
    }
  }

  // No bottom pattern = match if we found top + enough lines after
  if (topIdx !== null && pattern.bottom.length === 0) {
    const lastNonEmpty = findLastNonEmpty(lines, topIdx + 1);
    if (lastNonEmpty !== null && lastNonEmpty - topIdx >= pattern.minGap) {
      return true;
    }
  }

  return false;
}

function extractPattern(lines: string[], pattern: UIPattern): string | null {
  let topIdx: number | null = null;
  let bottomIdx: number | null = null;

  for (let i = 0; i < lines.length; i++) {
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
