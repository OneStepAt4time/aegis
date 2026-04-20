/**
 * utils/sanitizeStream.ts — Client-side sanitation of the tmux capture-pane
 * stream before it is rendered by xterm.js.
 *
 * The Claude Code launch command is echoed into the pane at spawn time, and
 * tmux `capture-pane` faithfully returns it. The resulting noise includes:
 *
 *   - PowerShell / bash bootstrap lines
 *       `Set-Location -LiteralPath '…'; Remove-Item Env:TMUX …; claude …`
 *       `cd '…' && unset TMUX TMUX_PANE && exec claude …`
 *   - A references to the random hook-settings path
 *       `…\aegis-hooks-4f3a1b\hooks-<uuid>.json`
 *   - The Claude CLI ASCII logo block
 *   - Raw Claude CLI status-footer text
 *       `· Frolicking…`, `esc to interrupt · high · /effort`
 *
 * This module strips those categories and NOTHING else. User transcript and
 * assistant output are always preserved. Anything inside a fenced code block
 * or between backticks is also preserved verbatim — we never strip text that
 * a user may have pasted intentionally.
 *
 * Tracked separately: issue 003 also plans server-side sanitation (the long-
 * term fix) and parsing of the CLI status footer into typed events. This
 * module is the first, reversible step.
 */

export interface SanitizeOptions {
  /**
   * Platform hint for bootstrap pattern selection. Defaults to `'auto'` which
   * inspects `navigator.userAgent`. The caller typically sets this explicitly
   * in tests.
   */
  platform?: NodeJS.Platform | 'auto';
  /**
   * When true, return the input unchanged. Used for an "Advanced: show raw"
   * debug toggle (surfaced today as the `?raw=1` query param).
   */
  preserveRaw?: boolean;
}

// ── Pattern helpers ────────────────────────────────────────────────

/** PowerShell prompt prefix, e.g. `PS D:\aegis>` or `PS C:\Users\dev\foo>` */
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
 * Covers both slash directions (`aegis-hooks-4f3a1b/hooks-…json` and
 * `aegis-hooks-4f3a1b\hooks-…json`). The 6+ hex suffix mirrors
 * `randomBytes(4).toString('hex')` used by `src/hook-settings.ts`.
 */
const HOOKS_PATH_LINE = /aegis-hooks-[0-9a-fA-F]{6,}[\\/][^\s'"]*\.json/;

/**
 * Claude CLI welcome header start marker. The logo is rendered with box-
 * drawing characters around a `ClaudeCode` wordmark. We anchor on the logo
 * token itself rather than trying to match the box — several terminals and
 * fonts render the box characters differently.
 */
const CLAUDE_LOGO_MARKER = /ClaudeCode/;

/**
 * End marker for the welcome block. The CC CLI prints a short info panel
 * after the logo that ends with lines referencing billing / API usage. If we
 * cannot find any of these markers, we fall back to the first blank line
 * after the logo (conservative).
 */
const CLAUDE_LOGO_END_MARKERS = [
  /APIUsageBilling/,
  /API\s*Usage\s*Billing/i,
  /Run\s*\/help\s*for\s*help/i,
  /Welcome\s*to\s*Claude\s*Code/i,
];

/**
 * Box-drawing characters frequently present on logo border lines. Used only
 * as a hint to widen the strip window backwards to the logo's first line.
 */
const BOX_DRAW_RE = /[\u2500-\u257F]/;

/**
 * Raw Claude CLI status-footer progress lines. These are transient
 * single-line interjections that will be replaced by a typed `<StatusStrip>`
 * in a follow-up PR. Two shapes:
 *
 *   · Frolicking…      (bullet + gerund)
 *   esc to interrupt · high · /effort
 *
 * We only strip lines that look like CLI status chrome, never arbitrary
 * user sentences that happen to start with "· ".
 */
const STATUS_PROGRESS_LINE = /^\s*[·•]\s*[A-Z][a-zA-Z]+(?:ing|ed)\s*[…\.]{0,3}\s*$/;
const STATUS_ESC_INTERRUPT_LINE = /^\s*(?:esc\s+to\s+interrupt)\b[^\n]*$/i;

// ── Code-fence detection ───────────────────────────────────────────

/**
 * Scan a chunk of text and mark which lines sit inside a fenced code block
 * (```…```) or an inline backtick run. Lines that are "protected" must not be
 * stripped regardless of their content — the user may have pasted an
 * example command into chat.
 *
 * This is intentionally simple: we only handle triple-backtick fences, which
 * is what Markdown-style chat uses. Inline-backtick protection is coarser
 * but safe.
 */
function markProtectedLines(lines: readonly string[]): boolean[] {
  const protectedMask = new Array<boolean>(lines.length).fill(false);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isFenceLine = /^\s*```/.test(line);
    if (isFenceLine) {
      // The fence line itself is protected; toggle state for following lines.
      protectedMask[i] = true;
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      protectedMask[i] = true;
    }
  }
  return protectedMask;
}

// ── Logo block detection ───────────────────────────────────────────

/**
 * Locate a contiguous Claude CLI welcome-logo block inside `lines`. Returns
 * `null` if no `ClaudeCode` token is found. The returned range is inclusive
 * of both endpoints and NEVER crosses a protected (code-fence) line.
 *
 * Conservative rules:
 *   - Anchor on the first line that contains `ClaudeCode`.
 *   - Extend backwards to the closest preceding line that is either blank or
 *     contains a box-drawing character. Bounded to 6 lines.
 *   - Extend forwards to the first line matching a known end-marker
 *     (APIUsageBilling etc.). If none is found within 15 lines, extend to
 *     the first blank line; if even that is not found, leave the block
 *     alone (strip nothing) — we never guess.
 */
function findLogoBlock(
  lines: readonly string[],
  protectedMask: readonly boolean[],
): { start: number; end: number } | null {
  let anchor = -1;
  for (let i = 0; i < lines.length; i++) {
    if (protectedMask[i]) continue;
    if (CLAUDE_LOGO_MARKER.test(lines[i])) {
      anchor = i;
      break;
    }
  }
  if (anchor === -1) return null;

  // Walk backwards.
  let start = anchor;
  const backLimit = Math.max(0, anchor - 6);
  for (let i = anchor - 1; i >= backLimit; i--) {
    if (protectedMask[i]) break;
    const line = lines[i];
    if (line.trim() === '' || BOX_DRAW_RE.test(line)) {
      start = i;
      continue;
    }
    // A non-border, non-blank line: stop widening.
    break;
  }

  // Walk forwards. First preference: a known end-marker.
  let end = -1;
  const forwardLimit = Math.min(lines.length - 1, anchor + 20);
  for (let i = anchor + 1; i <= forwardLimit; i++) {
    if (protectedMask[i]) break;
    if (CLAUDE_LOGO_END_MARKERS.some((re) => re.test(lines[i]))) {
      end = i;
      break;
    }
  }
  if (end !== -1) {
    // After the marker line, eat any trailing box-drawing border lines and
    // one following blank line if present. Bounded to 4 lines of widening
    // to keep the strip window tight.
    const trailLimit = Math.min(lines.length - 1, end + 4);
    for (let i = end + 1; i <= trailLimit; i++) {
      if (protectedMask[i]) break;
      const line = lines[i];
      if (BOX_DRAW_RE.test(line)) {
        end = i;
        continue;
      }
      if (line.trim() === '') {
        end = i;
        break;
      }
      break;
    }
    return { start, end };
  }

  // Fallback: first blank line after anchor, within 15 lines.
  const blankLimit = Math.min(lines.length - 1, anchor + 15);
  for (let i = anchor + 1; i <= blankLimit; i++) {
    if (protectedMask[i]) break;
    if (lines[i].trim() === '') {
      return { start, end: i };
    }
  }

  // Nothing certain — leave the block alone.
  return null;
}

// ── Platform resolution ────────────────────────────────────────────

function resolvePlatform(
  hint: SanitizeOptions['platform'],
  explicit?: 'win32' | 'darwin' | 'linux',
): 'win32' | 'darwin' | 'linux' {
  if (explicit) return explicit;
  if (hint && hint !== 'auto') {
    // Narrow NodeJS.Platform down to the three we care about; anything else
    // falls back to `linux`-style matching.
    if (hint === 'win32') return 'win32';
    if (hint === 'darwin') return 'darwin';
    return 'linux';
  }
  if (typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)) {
    return 'win32';
  }
  return 'linux';
}

// ── Main entry point ───────────────────────────────────────────────

/**
 * Strip shell bootstrap, hook-settings paths, the Claude CLI ASCII logo
 * block, and status-footer noise from a pane-capture string.
 *
 * Pure, deterministic, side-effect-free. Same input always yields same
 * output. Safe to call on every pane delta.
 */
export function sanitizeTerminalStream(
  text: string,
  platform: 'win32' | 'darwin' | 'linux',
  options: SanitizeOptions = {},
): string {
  if (options.preserveRaw) return text;
  if (!text) return text;

  const resolved = resolvePlatform(options.platform, platform);

  // Preserve the trailing newline behaviour: split then rejoin with `\n`.
  const lines = text.split('\n');
  const protectedMask = markProtectedLines(lines);

  // Pick the bootstrap regex for this platform. We still check both patterns
  // as a safety net — a Windows client connected to a macOS server will see
  // Unix bootstraps, and vice versa.
  const bootstrapRegexes: RegExp[] = resolved === 'win32'
    ? [WIN_BOOTSTRAP_LINE, UNIX_BOOTSTRAP_LINE]
    : [UNIX_BOOTSTRAP_LINE, WIN_BOOTSTRAP_LINE];

  // Pre-compute a mask of lines to drop.
  const drop = new Array<boolean>(lines.length).fill(false);

  // 1. Bootstrap + hooks-path + status lines.
  for (let i = 0; i < lines.length; i++) {
    if (protectedMask[i]) continue;
    const line = lines[i];

    // A bare PowerShell prompt line immediately preceding a bootstrap line.
    // We strip it only when the very next non-empty line is a bootstrap.
    if (resolved === 'win32' && WIN_PS_PROMPT.test(line) && line.replace(WIN_PS_PROMPT, '').trim() === '') {
      const nextIdx = nextNonEmptyIndex(lines, protectedMask, i + 1);
      if (nextIdx !== -1 && bootstrapRegexes.some((re) => re.test(lines[nextIdx]))) {
        drop[i] = true;
        continue;
      }
    }

    if (bootstrapRegexes.some((re) => re.test(line))) {
      drop[i] = true;
      continue;
    }

    if (HOOKS_PATH_LINE.test(line)) {
      drop[i] = true;
      continue;
    }

    if (STATUS_PROGRESS_LINE.test(line) || STATUS_ESC_INTERRUPT_LINE.test(line)) {
      drop[i] = true;
      continue;
    }
  }

  // 2. Claude CLI logo block.
  const logoBlock = findLogoBlock(lines, protectedMask);
  if (logoBlock) {
    for (let i = logoBlock.start; i <= logoBlock.end; i++) {
      drop[i] = true;
    }
  }

  // Reassemble. Collapse runs of blank-only dropped lines gracefully so we
  // don't leave a visible gap where the bootstrap used to be.
  const out: string[] = [];
  let prevBlank = false;
  for (let i = 0; i < lines.length; i++) {
    if (drop[i]) {
      // Substitute with a blank — but collapse consecutive blanks produced
      // by stripping so the pane doesn't grow vertical whitespace.
      continue;
    }
    const line = lines[i];
    const isBlank = line.trim() === '';
    if (isBlank && prevBlank) continue;
    out.push(line);
    prevBlank = isBlank;
  }

  return out.join('\n');
}

function nextNonEmptyIndex(
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

export default sanitizeTerminalStream;
