/**
 * src/sanitize-stream.ts — Server-side sanitation of raw tmux pane output.
 *
 * The Claude Code launch command, shell bootstrap, and CLI status footer are
 * stripped before the pane content is sent over WebSocket or SSE. User
 * transcript and assistant output are always preserved. Content inside fenced
 * code blocks is also preserved verbatim.
 *
 * This is the server-side complement to dashboard/src/utils/sanitizeStream.ts.
 * Both implement equivalent sanitation rules; the server-side version uses
 * `process.platform` for automatic platform detection.
 */

// ── Pattern constants ──────────────────────────────────────────────────────

/** PowerShell prompt prefix, e.g. `PS D:\aegis>` or `PS C:\Users\dev>` */
const WIN_PS_PROMPT = /^PS\s+[A-Za-z]:[^\n>]*>\s*/;

/**
 * Windows bootstrap: optional `Set-Location -LiteralPath '…';` then one or
 * more `Remove-Item Env:TMUX…` clauses then `claude …`. May be preceded by a
 * PowerShell prompt. Matches the whole line.
 */
const WIN_BOOTSTRAP_LINE =
  /^(?:PS\s+[A-Za-z]:[^\n>]*>\s*)?(?:Set-Location\s+-LiteralPath\s+[^;]+;\s*)?Remove-Item\s+Env:TMUX(?:_PANE)?\b[^\n]*claude\b[^\n]*$/;

/**
 * Unix bootstrap: optional `cd '…' &&` then `unset TMUX TMUX_PANE && exec
 * claude …`. Matches the whole line. Also tolerates a leading `$ ` prompt.
 */
const UNIX_BOOTSTRAP_LINE =
  /^(?:\$\s+)?(?:cd\s+[^\n&]+&&\s*)?unset\s+TMUX\s+TMUX_PANE\s*&&\s*(?:exec\s+)?claude\b[^\n]*$/;

/**
 * Any line that contains a reference to the randomised hooks-settings path.
 * Covers both slash directions. The 6+ hex suffix mirrors
 * `randomBytes(4).toString('hex')` used by `src/hook-settings.ts`.
 */
const HOOKS_PATH_LINE = /aegis-hooks-[0-9a-fA-F]{6,}[\\/][^\s'"]*\.json/;

/** Claude CLI welcome header anchor — the logo wordmark. */
const CLAUDE_LOGO_MARKER = /ClaudeCode/;

/** End markers for the welcome block. */
const CLAUDE_LOGO_END_MARKERS = [
  /APIUsageBilling/,
  /API\s*Usage\s*Billing/i,
  /Run\s*\/help\s*for\s*help/i,
  /Welcome\s*to\s*Claude\s*Code/i,
];

/** Box-drawing characters — used as a hint for logo border lines. */
const BOX_DRAW_RE = /[\u2500-\u257F]/;

/**
 * Raw Claude CLI status-footer progress lines.
 * Shape: `· Frolicking…` (bullet + gerund form)
 */
const STATUS_PROGRESS_LINE = /^\s*[·•]\s*[A-Z][a-zA-Z]+(?:ing|ed)\s*[…\.]{0,3}\s*$/;

/** `esc to interrupt · high · /effort` footer line */
const STATUS_ESC_INTERRUPT_LINE = /^\s*(?:esc\s+to\s+interrupt)\b[^\n]*$/i;

/** Bash `set -x` trace lines starting with `+ ` */
const BASH_TRACE_LINE = /^\+\s+/;

/** `export CLAUDE_*=` or `$env:CLAUDE_*=` env variable export lines */
const ENV_EXPORT_LINE = /^\s*(?:export\s+CLAUDE_|set\s+CLAUDE_|\$env:CLAUDE_)/;

// ── Code-fence protection ──────────────────────────────────────────────────

/**
 * Scan a chunk of text and mark which lines sit inside a fenced code block
 * (```…```). Lines that are "protected" must not be stripped regardless of
 * their content — the user may have pasted an example command into chat.
 */
function markProtectedLines(lines: readonly string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const isFence = /^\s*```/.test(lines[i]);
    if (isFence) {
      mask[i] = true;
      inFence = !inFence;
      continue;
    }
    if (inFence) mask[i] = true;
  }
  return mask;
}

// ── Logo block detection ───────────────────────────────────────────────────

/**
 * Locate a contiguous Claude CLI welcome-logo block inside `lines`.
 * Returns `null` if no `ClaudeCode` token is found.
 * The returned range is inclusive and NEVER crosses a protected line.
 */
function findLogoBlock(
  lines: readonly string[],
  protectedMask: readonly boolean[],
): { start: number; end: number } | null {
  let anchor = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!protectedMask[i] && CLAUDE_LOGO_MARKER.test(lines[i])) {
      anchor = i;
      break;
    }
  }
  if (anchor === -1) return null;

  // Walk backwards to include box-drawing border lines.
  let start = anchor;
  const backLimit = Math.max(0, anchor - 6);
  for (let i = anchor - 1; i >= backLimit; i--) {
    if (protectedMask[i]) break;
    if (lines[i].trim() === '' || BOX_DRAW_RE.test(lines[i])) {
      start = i;
    } else {
      break;
    }
  }

  // Walk forwards to known end-marker.
  let end = -1;
  const fwdLimit = Math.min(lines.length - 1, anchor + 20);
  for (let i = anchor + 1; i <= fwdLimit; i++) {
    if (protectedMask[i]) break;
    if (CLAUDE_LOGO_END_MARKERS.some((re) => re.test(lines[i]))) {
      end = i;
      break;
    }
  }

  if (end !== -1) {
    // Eat trailing box-drawing border lines and one blank line.
    const trailLimit = Math.min(lines.length - 1, end + 4);
    for (let i = end + 1; i <= trailLimit; i++) {
      if (protectedMask[i]) break;
      if (BOX_DRAW_RE.test(lines[i])) { end = i; continue; }
      if (lines[i].trim() === '') { end = i; break; }
      break;
    }
    return { start, end };
  }

  // Fallback: first blank line after anchor, within 15 lines.
  const blankLimit = Math.min(lines.length - 1, anchor + 15);
  for (let i = anchor + 1; i <= blankLimit; i++) {
    if (protectedMask[i]) break;
    if (lines[i].trim() === '') return { start, end: i };
  }

  return null;
}

function nextNonEmpty(
  lines: readonly string[],
  protectedMask: readonly boolean[],
  from: number,
): number {
  for (let i = from; i < lines.length; i++) {
    if (protectedMask[i]) return -1;
    if (lines[i].trim() !== '') return i;
  }
  return -1;
}

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Strip shell bootstrap, hook-settings paths, the Claude CLI ASCII logo
 * block, and status-footer noise from a raw tmux pane capture string.
 *
 * Pure, deterministic, side-effect-free. Platform is detected from
 * `process.platform` at call time.
 */
export function sanitizeOutput(raw: string): string {
  if (!raw) return raw;

  const platform: 'win32' | 'darwin' | 'linux' =
    process.platform === 'win32' ? 'win32' :
    process.platform === 'darwin' ? 'darwin' :
    'linux';

  const lines = raw.split('\n');
  const protectedMask = markProtectedLines(lines);

  // Check both bootstrap patterns regardless of platform — a Windows client
  // connected to a macOS server will see Unix bootstraps, and vice versa.
  const bootstrapRegexes: RegExp[] = platform === 'win32'
    ? [WIN_BOOTSTRAP_LINE, UNIX_BOOTSTRAP_LINE]
    : [UNIX_BOOTSTRAP_LINE, WIN_BOOTSTRAP_LINE];

  const drop = new Array<boolean>(lines.length).fill(false);

  for (let i = 0; i < lines.length; i++) {
    if (protectedMask[i]) continue;
    const line = lines[i];

    // Strip bare PowerShell prompt line immediately preceding a bootstrap line.
    if (WIN_PS_PROMPT.test(line) && line.replace(WIN_PS_PROMPT, '').trim() === '') {
      const nextIdx = nextNonEmpty(lines, protectedMask, i + 1);
      if (nextIdx !== -1 && bootstrapRegexes.some((re) => re.test(lines[nextIdx]))) {
        drop[i] = true;
        continue;
      }
    }

    if (bootstrapRegexes.some((re) => re.test(line))) { drop[i] = true; continue; }
    if (HOOKS_PATH_LINE.test(line)) { drop[i] = true; continue; }
    if (STATUS_PROGRESS_LINE.test(line) || STATUS_ESC_INTERRUPT_LINE.test(line)) { drop[i] = true; continue; }
    if (BASH_TRACE_LINE.test(line)) { drop[i] = true; continue; }
    if (ENV_EXPORT_LINE.test(line)) { drop[i] = true; continue; }
  }

  const logoBlock = findLogoBlock(lines, protectedMask);
  if (logoBlock) {
    for (let i = logoBlock.start; i <= logoBlock.end; i++) drop[i] = true;
  }

  // Reassemble, collapsing consecutive blank lines left by stripping.
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

export default sanitizeOutput;
