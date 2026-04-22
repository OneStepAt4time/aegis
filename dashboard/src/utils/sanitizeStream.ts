/**
 * utils/sanitizeStream.ts — Client-side sanitation of the tmux capture-pane
 * stream before it is rendered by xterm.js.
 *
 * Only true noise is stripped:
 *   - PowerShell / bash bootstrap lines (shell launch commands echoed to pane)
 *   - Hook-settings file paths (internal plumbing)
 *
 * Real CC TUI content is preserved: logo, status footer, mode markers,
 * ANSI formatting, prompts, tool output — everything the user would see
 * in a real terminal.
 */

export interface SanitizeOptions {
  platform?: NodeJS.Platform | 'auto';
  preserveRaw?: boolean;
}

// ── Pattern helpers ────────────────────────────────────────────────

const WIN_PS_PROMPT = /^PS\s+[A-Za-z]:[^\n>]*>\s*/;

const WIN_BOOTSTRAP_LINE =
  /^(?:PS\s+[A-Za-z]:[^\n>]*>\s*)?(?:Set-Location\s+-LiteralPath\s+[^;]+;\s*)?Remove-Item\s+Env:TMUX(?:_PANE)?\b[^\n]*claude\b[^\n]*$/;

const UNIX_BOOTSTRAP_LINE =
  /^(?:\$\s+)?(?:cd\s+[^\n&]+&&\s*)?unset\s+TMUX\s+TMUX_PANE\s*&&\s*(?:exec\s+)?claude\b[^\n]*$/;

const HOOKS_PATH_LINE = /aegis-hooks-[0-9a-fA-F]{6,}[\\/][^\s'"]*\.json/;

// ── Code-fence protection ─────────────────────────────────────────

function markProtectedLines(lines: readonly string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { mask[i] = true; inFence = !inFence; continue; }
    if (inFence) mask[i] = true;
  }
  return mask;
}

// ── Platform resolution ────────────────────────────────────────────

function resolvePlatform(
  hint: SanitizeOptions['platform'],
  explicit?: 'win32' | 'darwin' | 'linux',
): 'win32' | 'darwin' | 'linux' {
  if (explicit) return explicit;
  if (hint && hint !== 'auto') {
    if (hint === 'win32') return 'win32';
    if (hint === 'darwin') return 'darwin';
    return 'linux';
  }
  if (typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)) return 'win32';
  return 'linux';
}

// ── Main entry point ───────────────────────────────────────────────

/**
 * Strip only shell bootstrap and hook-settings path noise.
 * All real CC TUI content passes through unchanged.
 */
export function sanitizeTerminalStream(
  text: string,
  platform: 'win32' | 'darwin' | 'linux',
  options: SanitizeOptions = {},
): string {
  if (options.preserveRaw) return text;
  if (!text) return text;

  const resolved = resolvePlatform(options.platform, platform);
  const lines = text.split('\n');
  const protectedMask = markProtectedLines(lines);

  const bootstrapRegexes: RegExp[] = resolved === 'win32'
    ? [WIN_BOOTSTRAP_LINE, UNIX_BOOTSTRAP_LINE]
    : [UNIX_BOOTSTRAP_LINE, WIN_BOOTSTRAP_LINE];

  const drop = new Array<boolean>(lines.length).fill(false);

  for (let i = 0; i < lines.length; i++) {
    if (protectedMask[i]) continue;
    const line = lines[i];

    if (resolved === 'win32' && WIN_PS_PROMPT.test(line) && line.replace(WIN_PS_PROMPT, '').trim() === '') {
      const nextIdx = nextNonEmptyIndex(lines, protectedMask, i + 1);
      if (nextIdx !== -1 && bootstrapRegexes.some((re) => re.test(lines[nextIdx]))) { drop[i] = true; continue; }
    }

    if (bootstrapRegexes.some((re) => re.test(line))) { drop[i] = true; continue; }
    if (HOOKS_PATH_LINE.test(line)) { drop[i] = true; continue; }
  }

  // Reassemble, collapsing consecutive blanks from stripping
  const out: string[] = [];
  let prevBlank = false;
  for (let i = 0; i < lines.length; i++) {
    if (drop[i]) continue;
    const isBlank = lines[i].trim() === '';
    if (isBlank && prevBlank) continue;
    out.push(lines[i]);
    prevBlank = isBlank;
  }

  return out.join('\n');
}

function nextNonEmptyIndex(lines: readonly string[], protectedMask: readonly boolean[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (protectedMask[i]) return -1;
    if (lines[i].trim() !== '') return i;
  }
  return -1;
}

export default sanitizeTerminalStream;
