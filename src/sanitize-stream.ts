/**
 * src/sanitize-stream.ts — Server-side sanitation of raw tmux pane output.
 *
 * Only true noise is stripped:
 *   - Shell bootstrap lines (PowerShell/bash launch commands echoed to pane)
 *   - Hook-settings file paths (internal plumbing)
 *   - Bash `set -x` trace lines
 *   - CLAUDE_* env export lines
 *
 * Real CC TUI content is preserved: logo, status footer, mode markers,
 * ANSI formatting, prompts — everything the user sees in a real terminal.
 *
 * This is the server-side complement to dashboard/src/utils/sanitizeStream.ts.
 */

// ── Pattern constants ──────────────────────────────────────────────────────

const WIN_PS_PROMPT = /^PS\s+[A-Za-z]:[^\n>]*>\s*/;

const WIN_BOOTSTRAP_LINE =
  /^(?:PS\s+[A-Za-z]:[^\n>]*>\s*)?(?:Set-Location\s+-LiteralPath\s+[^;]+;\s*)?Remove-Item\s+Env:TMUX(?:_PANE)?\b[^\n]*claude\b[^\n]*$/;

const UNIX_BOOTSTRAP_LINE =
  /^(?:\$\s+)?(?:cd\s+[^\n&]+&&\s*)?unset\s+TMUX\s+TMUX_PANE\s*&&\s*(?:exec\s+)?claude\b[^\n]*$/;

const HOOKS_PATH_LINE = /aegis-hooks-[0-9a-fA-F]{6,}[\\/][^\s'"]*\.json/;

const BASH_TRACE_LINE = /^\+\s+/;

const ENV_EXPORT_LINE = /^\s*(?:export\s+CLAUDE_|set\s+CLAUDE_|\$env:CLAUDE_)/;

// ── Code-fence protection ──────────────────────────────────────────────────

function markProtectedLines(lines: readonly string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { mask[i] = true; inFence = !inFence; continue; }
    if (inFence) mask[i] = true;
  }
  return mask;
}

function nextNonEmpty(lines: readonly string[], protectedMask: readonly boolean[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (protectedMask[i]) return -1;
    if (lines[i].trim() !== '') return i;
  }
  return -1;
}

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Strip only shell bootstrap, hook paths, bash traces, and env exports.
 * All real CC TUI content passes through unchanged.
 */
export function sanitizeOutput(raw: string): string {
  if (!raw) return raw;

  const platform: 'win32' | 'darwin' | 'linux' =
    process.platform === 'win32' ? 'win32' :
    process.platform === 'darwin' ? 'darwin' :
    'linux';

  const lines = raw.split('\n');
  const protectedMask = markProtectedLines(lines);

  const bootstrapRegexes: RegExp[] = platform === 'win32'
    ? [WIN_BOOTSTRAP_LINE, UNIX_BOOTSTRAP_LINE]
    : [UNIX_BOOTSTRAP_LINE, WIN_BOOTSTRAP_LINE];

  const drop = new Array<boolean>(lines.length).fill(false);

  for (let i = 0; i < lines.length; i++) {
    if (protectedMask[i]) continue;
    const line = lines[i];

    if (WIN_PS_PROMPT.test(line) && line.replace(WIN_PS_PROMPT, '').trim() === '') {
      const nextIdx = nextNonEmpty(lines, protectedMask, i + 1);
      if (nextIdx !== -1 && bootstrapRegexes.some((re) => re.test(lines[nextIdx]))) { drop[i] = true; continue; }
    }

    if (bootstrapRegexes.some((re) => re.test(line))) { drop[i] = true; continue; }
    if (HOOKS_PATH_LINE.test(line)) { drop[i] = true; continue; }
    if (BASH_TRACE_LINE.test(line)) { drop[i] = true; continue; }
    if (ENV_EXPORT_LINE.test(line)) { drop[i] = true; continue; }
  }

  // Reassemble, collapsing consecutive blanks left by stripping.
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

// ── Stream (line-buffered) sanitizer ─────────────────────────────────────

/** Strip CSI/OSC/single-byte ESC sequences from a line for pattern matching.
 *  The original line (with ANSI) is output — this is only for matching. */
function stripAnsiForMatching(line: string): string {
  return line
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b[\x40-\x5e]/g, '');
}

export interface StreamSanitizer {
  feed(chunk: string): string;
  flush(): string;
}

/** Create a line-buffered sanitizer for incremental stream data.
 *  Accumulates partial lines across chunks, filters bootstrap noise,
 *  passes ANSI escape sequences through untouched. */
export function createStreamSanitizer(platform: 'win32' | 'darwin' | 'linux'): StreamSanitizer {
  let buffer = '';

  const platformBootstrap: RegExp[] = platform === 'win32'
    ? [WIN_BOOTSTRAP_LINE, UNIX_BOOTSTRAP_LINE]
    : [UNIX_BOOTSTRAP_LINE, WIN_BOOTSTRAP_LINE];

  function shouldDrop(text: string): boolean {
    const clean = stripAnsiForMatching(text);
    if (WIN_PS_PROMPT.test(clean) && clean.replace(WIN_PS_PROMPT, '').trim() === '') return false;
    if (platformBootstrap.some((re) => re.test(clean))) return true;
    if (HOOKS_PATH_LINE.test(clean)) return true;
    if (BASH_TRACE_LINE.test(clean)) return true;
    if (ENV_EXPORT_LINE.test(clean)) return true;
    return false;
  }

  return {
    feed(chunk: string): string {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      const out: string[] = [];
      for (const line of lines) {
        if (shouldDrop(line)) continue;
        out.push(line);
      }
      return out.join('\n') + (out.length > 0 ? '\n' : '');
    },

    flush(): string {
      if (!buffer) return '';
      const line = buffer;
      buffer = '';
      if (shouldDrop(line)) return '';
      return line + '\n';
    },
  };
}

export default sanitizeOutput;
