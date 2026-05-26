/**
 * channels/telegram/formatter.ts — Standalone formatting and utility functions
 * for the Telegram channel.
 */

import { homedir } from 'node:os';

import {
  esc,
  bold,
  code,
  italic,
  type StyledMessage,
} from '../telegram-style.js';

import type { ToolInfo, SessionProgress } from './types.js';

// ── Plain Utility Functions ────────────────────────────────────────────────

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

export function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function shortPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  // Keep only filename or last 2 segments
  const parts = normalized.replace(/^\//, '').split('/');
  if (parts.length <= 2) return parts.join('/');
  return '…/' + parts.slice(-2).join('/');
}

export function shortenHomePath(workDir: string): string {
  const normalized = workDir.replace(/\\/g, '/');
  const home = homedir().replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized === home) return '~';
  if (normalized.startsWith(`${home}/`)) return `~${normalized.slice(home.length)}`;
  return normalized;
}

/**
 * Strip Claude Code internal XML tags from assistant messages.
 * These tags (local-command-*, antml:*, etc.) are CC's internal markup
 * and must NEVER be shown to the user on Telegram.
 *
 * Some tags carry useful info — extract and convert them:
 *   <local-command-stdout>text</local-command-stdout> → keep "text"
 *   <command-name>/plan</command-name> → "🔄 Plan mode enabled"
 *   <command-name>/compact</command-name> → "🔄 Compact mode"
 *   <local-command-caveat>...</local-command-caveat> → strip entirely
 *   <antml:thinking>...</antml:thinking> → strip entirely
 *   <antml:tool_use>...</antml:tool_use> → strip entirely
 */
export function stripXmlTags(text: string): string {
  // 1. Extract useful command stdout
  let result = text.replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/gi, (_, content) => content.trim());

  // 2. Extract command name and produce clean status
  const cmdMatch = result.match(/<command-name>(.*?)<\/command-name>/i);
  if (cmdMatch) {
    const cmd = cmdMatch[1].trim();
    const cmdMap: Record<string, string> = {
      '/plan': '📋 Plan mode enabled',
      '/compact': '🔄 Compact mode',
      '/bug': '🐛 Bug mode',
      '/review': '🔍 Review mode',
    };
    const clean = cmdMap[cmd] || `⚡ ${cmd}`;
    // Replace the command block with clean status
    result = result.replace(/<command-name>[\s\S]*?<\/command-name>/gi, clean);
    result = result.replace(/<command-args>[\s\S]*?<\/command-args>/gi, '');
    }

  // 3. Strip all remaining CC internal tags (caveat, thinking, tool_use, etc.)
  result = result.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, '');
  result = result.replace(/<local-command-[a-z]+>[\s\S]*?<\/local-command-[a-z]+>/gi, '');
  result = result.replace(/<antml:[a-z]+>[\s\S]*?<\/antml:[a-z]+>/gi, '');
  result = result.replace(/<antml:[a-z]+\/>/gi, '');

  // 4. Strip remaining known CC internal tags (self-closing or unmatched)
  // Only strip tags from known CC namespaces, not arbitrary angle-bracket content
  result = result.replace(/<\/?(?:local-command-[a-z]+|antml:[a-z]+)(?:\s[^>]*)?\/?>/gi, '');

  // 5. Clean up whitespace left behind
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  return result;
}

// ── Option / Tree Parsing ──────────────────────────────────────────────────

/**
 * Parse numbered or labeled options from CC permission/question text.
 *
 * CC formats:
 *   "1. Yes\n2. Yes, and allow...\n3. No"
 *   "y/n" or "(y/n)"
 *   "Yes / No"
 *
 * Returns array of {label, value} or null if no options detected.
 * value is what gets sent to CC (the number or the text).
 */
export function parseOptions(text: string): Array<{ label: string; value: string }> | null {
  // Pattern 1: Numbered options "1. Yes\n2. Something else\n3. No"
  const numberedRegex = /^\s*(\d+)\.\s+(.+)$/gm;
  const numbered: Array<{ label: string; value: string }> = [];
  let m;
  while ((m = numberedRegex.exec(text)) !== null) {
    const num = m[1];
    let label = m[2].trim();
    // Truncate long labels for button display (max 30 chars)
    if (label.length > 30) label = label.slice(0, 28) + '…';
    numbered.push({ label: `${num}. ${label}`, value: num });
  }
  if (numbered.length >= 2) return numbered.slice(0, 4); // Max 4 buttons

  // Pattern 2: y/n shorthand
  if (/\(?\s*[yY]\s*\/\s*[nN]\s*\)?/.test(text)) {
    return [
      { label: '✅ Yes', value: 'y' },
      { label: '❌ No', value: 'n' },
    ];
  }

  // Pattern 3: Yes / No explicit
  if (/\b[Yy]es\b.*\b[Nn]o\b/.test(text)) {
    return [
      { label: '✅ Yes', value: 'yes' },
      { label: '❌ No', value: 'no' },
    ];
  }

  // Pattern 4: Allow/Deny
  if (/\b[Aa]llow\b/.test(text) || /\b[Dd]eny\b/.test(text)) {
    return [
      { label: '✅ Allow', value: 'allow' },
      { label: '❌ Deny', value: 'deny' },
    ];
  }

  return null;
}

/**
 * Detect and format CC sub-agent/explore tree output.
 * Pattern: "● N agents finished\n  ├─ name · stats\n  └─ name · stats"
 * Returns formatted string or null if no tree detected.
 */
export function formatSubAgentTree(text: string): string | null {
  // Match the tree header
  const headerMatch = text.match(/●\s+(\d+)\s+(explore|sub-?agent|agent)s?\s+(finished|running|launched)/i);
  if (!headerMatch) return null;

  const count = parseInt(headerMatch[1]);
  const status = headerMatch[3].toLowerCase();

  // Extract agent entries
  const entries: string[] = [];
  const entryRegex = /[├└│─\s●]*\s*(.+?)\s*[·•]\s*(\d+)\s*(tool uses?|steps?)\s*[·•]\s*([\d.]+[kKmM]?)\s*tokens?/gi;
  let m;
  while ((m = entryRegex.exec(text)) !== null) {
    const name = m[1].trim();
    const tools = m[2];
    const tokens = m[4];
    entries.push(`${bold(name)}  ${tools} tools  ${tokens} tokens`);
  }

  // Also try simpler format without token count
  if (entries.length === 0) {
    const simpleRegex = /[├└│─\s●]*\s*(.+?)\s*[·•]\s*(\d+)\s*(tool uses?|steps?)/gi;
    while ((m = simpleRegex.exec(text)) !== null) {
      entries.push(`${bold(m[1].trim())}  ${m[2]} tools`);
    }
  }

  if (entries.length === 0) return null;

  const emoji = status === 'running' ? '🔄' : status === 'finished' ? '✅' : '🚀';
  const header = `${emoji} ${bold(String(count))} ${status}`;
  const body = entries.slice(0, 5).join('\n');
  const extra = entries.length > 5 ? `\n  +${entries.length - 5} more` : '';

  return `${header}\n${body}${extra}`;
}

// ── Sanitizers ─────────────────────────────────────────────────────────────

/** Allowlisted URI schemes for md2html() link hrefs. Prevents javascript:, data:, vbscript:, etc. */
const ALLOWED_HREF_SCHEMES = ['http:', 'https:', 'tg:', '#:', 'mailto:'];

export function sanitizeHref(href: string): string {
  const trimmed = href.trim();
  // Allow relative/anchor links (no colon before slash/hash)
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return esc(trimmed);
  const scheme = trimmed.split(':')[0]?.toLowerCase() + ':';
  if (ALLOWED_HREF_SCHEMES.includes(scheme)) return esc(trimmed);
  // Block everything else — show the link text but drop the dangerous href
  return '#';
}

/** Strip control chars, RTL overrides, and truncate topic names for Telegram forum topics. */
export function sanitizeTopicName(name: string): string {
  return name
    // Strip control characters (C0, C1, RTL overrides LRE/RLE/LRO/RLO/PDF)
    .replace(/[\u0000-\u001F\u007F-\u009F\u200E-\u200F\u202A-\u202E]/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

/** Max callback_data length per Telegram Bot API (64 bytes). */
const MAX_CALLBACK_DATA_LENGTH = 64;

export function safeCallbackData(data: string): string {
  if (Buffer.byteLength(data, 'utf-8') <= MAX_CALLBACK_DATA_LENGTH) return data;
  // Truncate value portion to fit within 64 bytes
  const prefix = data.substring(0, data.lastIndexOf(':') + 1);
  const value = data.substring(prefix.length);
  // Binary search for max value length that fits
  let lo = 0, hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Buffer.byteLength(prefix + value.slice(0, mid), 'utf-8') <= MAX_CALLBACK_DATA_LENGTH) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return prefix + value.slice(0, lo);
}

// ── Markdown → HTML ────────────────────────────────────────────────────────

/**
 * Convert Markdown to Telegram HTML.
 * Handles: **bold**, `code`, ```blocks```, [links](url), tables
 * Must be called BEFORE wrapping in blockquote/pre tags.
 */
export function md2html(md: string): string {
  let result = '';
  const lines = md.split('\n');
  let inCodeBlock = false;
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block toggle
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        result += '</pre>\n';
        inCodeBlock = false;
      } else {
        // Close any open table before code block
        if (inTable) { result += '\n'; inTable = false; }
        inCodeBlock = true;
        result += '<pre>';
      }
      continue;
    }

    if (inCodeBlock) {
      result += esc(line) + '\n';
      continue;
    }

    // Markdown table detection: lines starting with |
    if (line.trimStart().startsWith('|') && line.trimEnd().endsWith('|')) {
      // Skip separator row (|---|---|)
      if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;

      if (!inTable) {
        // Close any previous content
        result += '\n';
        inTable = true;
      }

      // Parse table row
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.length === 0) continue;

      // First row becomes header (bold)
      const isFirstRow = !result.includes('•') || i === 0 || !lines[i - 1]?.trimStart().startsWith('|');
      const formatted = cells.map(c => isFirstRow ? bold(c) : esc(c)).join(' — ');
      result += `• ${formatted}\n`;
      continue;
    } else if (inTable) {
      // End of table
      inTable = false;
    }

    let processed = esc(line);

    // Headers → bold
    processed = processed.replace(/^#{1,4}\s+(.+)$/, '<b>$1</b>');

    // Bold: **text** or __text__
    processed = processed.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    processed = processed.replace(/__(.+?)__/g, '<b>$1</b>');

    // Inline code: `text` (before italic to avoid conflicts)
    processed = processed.replace(/`([^`]+?)`/g, '<code>$1</code>');

    // Italic: *text* or _text_ (not inside words)
    processed = processed.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<i>$1</i>');
    processed = processed.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<i>$1</i>');

    // Links: [text](url)
    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => '<a href="' + sanitizeHref(href) + '">' + text + '</a>');

    // List bullets
    processed = processed.replace(/^(\s*)[-*]\s+/, '$1• ');

    result += processed + '\n';
  }

  // Close unclosed blocks
  if (inCodeBlock) result += '</pre>\n';
  if (inTable) result += '\n';

  return result.trimEnd();
}

// ── Timestamp / Session Formatting ─────────────────────────────────────────

/** Issue #3747: Format timestamp in cc-connect style: [DD/MM/YYYY HH:MM] */
export function formatTimestamp(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `[${day}/${month}/${year} ${hours}:${minutes}]`;
}

export function formatSessionCreated(name: string, workDir: string, id: string, meta?: Record<string, unknown>): string {
  const shortId = id.slice(0, 8);
  const shortDir = shortenHomePath(workDir);
  const parts = [`${bold(name)}  ${code(shortDir)}  ${code(shortId)}`];
  const flags: string[] = [];
  if (meta?.permissionMode && meta.permissionMode !== 'default') flags.push(String(meta.permissionMode));
  else if (meta?.autoApprove) flags.push('auto-approve');
  if (meta?.model) flags.push(String(meta.model));
  if (flags.length) parts.push(flags.join(' · '));
  if (meta?.prompt) {
    const prompt = String(meta.prompt);
    if (prompt.length > 150) {
      // Long prompt → expandable blockquote
      parts.push(`<blockquote expandable>${esc(prompt)}</blockquote>`);
    } else {
      parts.push(italic(esc(prompt)));
    }
  }
  return `🧰 Process: ${name}\n🚀 ${parts.join('\n')}`;
}

export function formatAssistantMessage(detail: string): string | null {
  let text = detail.trim();
  if (!text) return null;

  // P0: Strip CC internal XML tags FIRST
  text = stripXmlTags(text);
  text = text.trim();
  if (!text) return null;

  // P2: Detect sub-agent/explore tree and format it
  const treeResult = formatSubAgentTree(text);
  if (treeResult) return treeResult;

  // Strip filler lines
  const allLines = text.split('\n');
  const lines = allLines.filter(l => {
    const t = l.trim();
    return t && !t.match(/^(Let me|I'll|Sure,|Okay,|Alright,|Great,|Now I|Now let me|I'm going to|First,? I|Looking at|I need to|I want to|I should|Next,? I)/i);
  });
  if (lines.length === 0) return null;

  const firstLine = lines[0];

  // Short helper: first 2 lines max 200 chars (Quick Update format)
  const short = (): string => md2html(truncate(lines.slice(0, 2).join(' '), 200));

  // Long helper: first line as summary, rest in expandable blockquote
  // Uses md2html to convert markdown → HTML BEFORE wrapping in blockquote
  const withExpandable = (emoji: string, maxSummary = 200): string => {
    const summary = md2html(truncate(firstLine, maxSummary));
    if (lines.length <= 2) return `${emoji} ${summary}`;
    const rest = lines.slice(1).join('\n');
    const restTruncated = truncate(rest, 1500);
    const restHtml = md2html(restTruncated);
    return `${emoji} ${summary}\n<blockquote expandable>${restHtml}</blockquote>`;
  };

  // P3: Plan detection — show full plan in expandable
  if (/^(plan|steps?|approach|here's (how|what|the plan)|my approach)/im.test(firstLine)) {
    return withExpandable('📋');
  }

  // Question — send immediately (important)
  if (/\?$/.test(firstLine) || /^(what|how|why|when|where|should|can you|do you|is there)/im.test(firstLine)) {
    return withExpandable('❓');
  }

  // Summary/conclusion
  if (/^(summary|done|complete|finished|all (tests|checks)|build (pass|succeed)|here (is|are) the)/im.test(firstLine)) {
    return withExpandable('✅');
  }

  // Sub-agent launch (but no tree yet)
  if (/launching\s+\d+\s+(explore|sub-?agent|agent)/im.test(firstLine)) {
    return withExpandable('🚀');
  }

  // Code changes
  if (/^(writing|implementing|adding|creating|updating|fixing|refactor)/im.test(firstLine)) {
    return `✏️ ${short()}`;
  }

  // Analysis
  if (/^(reading|examining|looking at|checking|analyzing|inspecting|reviewing)/im.test(firstLine)) {
    return `🔍 ${short()}`;
  }

  // Default: short update
  if (lines.length <= 2) return `💬 ${short()}`;
  return withExpandable('💬');
}

// ── Tool Use / Result Formatting ───────────────────────────────────────────

export function parseToolUse(detail: string): ToolInfo {
  const d = detail.trim();

  // Read file
  const readMatch = d.match(/^Read[:\s]+(.+)/im);
  if (readMatch) return { icon: '📖', label: `Reading ${shortPath(readMatch[1].trim())}`, file: readMatch[1].trim(), category: 'read' };

  // Edit file
  const editMatch = d.match(/^Edit[:\s]+(.+)/im);
  if (editMatch) return { icon: '✏️', label: `Editing ${shortPath(editMatch[1].trim())}`, file: editMatch[1].trim(), category: 'edit' };

  // Write/Create file
  const writeMatch = d.match(/^Write[:\s]+(.+)/im);
  if (writeMatch) return { icon: '📝', label: `Creating ${shortPath(writeMatch[1].trim())}`, file: writeMatch[1].trim(), category: 'create' };

  // Search/Grep/Glob
  const searchMatch = d.match(/^(Search|Grep|Glob)[:\s]+["']?(.+?)["']?$/im);
  if (searchMatch) return { icon: '🔍', label: `Searching: ${truncate(searchMatch[2], 50)}`, category: 'search' };

  // Bash/Run
  const bashMatch = d.match(/^(Bash|Run)[:\s]+(.+)$/im);
  if (bashMatch) {
    const cmd = bashMatch[2].trim();
    return { icon: '💻', label: truncate(cmd, 70), cmd, category: 'command' };
  }

  // List
  const listMatch = d.match(/^List(ing|Dir)?[:\s]*(.+)$/im);
  if (listMatch) return { icon: '📂', label: `Listing ${shortPath(listMatch[2].trim())}`, category: 'read' };

  // Generic — only if we can extract a meaningful name (>2 chars, not just punctuation)
  const toolName = d.split(/[:(\s]/)[0]?.trim() || '';
  if (toolName.length < 2 || /^[^a-zA-Z]+$/.test(toolName)) {
    // Unrecognized tool — track silently, don't show to user
    return { icon: '', label: '', category: 'other' };
  }
  return { icon: '🔧', label: toolName, category: 'other' };
}

export function formatToolResult(detail: string): { text: string; isError: boolean } | null {
  // Success → silent
  if (/^(success|ok|done|completed|passed)$/im.test(detail.trim())) return null;

  // Build output — extract file:line + TS error code + short message
  if (/build|compil|tsc/i.test(detail)) {
    if (/error|failed/i.test(detail)) {
      const tsErrors = detail.split('\n')
        .filter(l => /TS\d{4,}/.test(l))
        .map(l => {
          // Extract: src/file.ts(line,col): error TS2345: message...
          const m = l.match(/([^\s/]*\/[^\s(]+)\((\d+),?\d*\):\s*error\s+(TS\d+):\s*(.+)/);
          if (m) return `${shortPath(m[1])}:${m[2]} — ${m[3]}: ${truncate(m[4], 80)}`;
          // Fallback: just truncate the line
          return truncate(l.trim(), 120);
        })
        .slice(0, 4);
      const errorBlock = tsErrors.length > 0
        ? `\n<blockquote expandable><pre>${esc(tsErrors.join('\n'))}</pre></blockquote>`
        : '';
      return { text: `❌ ${bold('Build failed')}${errorBlock}`, isError: true };
    }
    return { text: `💻 tsc clean`, isError: false };
  }

  // Test output — differentiate single file vs full suite
  if (/test|spec|vitest|jest/i.test(detail)) {
    const passedMatch = detail.match(/(\d+)\s*(passed|passing)/i);
    const failedMatch = detail.match(/(\d+)\s*(failed|failing)/i);
    // Try to extract test file name for single-file runs
    const fileMatch = detail.match(/([a-zA-Z0-9_-]+\.test\.[tj]s)/i);
    // Detect "Test Files N passed" for full suite
    const suiteMatch = detail.match(/Test Files\s+(\d+)\s*passed/i);
    const prefix = fileMatch && !suiteMatch ? fileMatch[1] : suiteMatch ? 'Full suite' : '';

    if (failedMatch && parseInt(failedMatch[1]) > 0) {
      const label = prefix ? `${prefix}: ` : '';
      return { text: `💻 ${label}${failedMatch[1]} tests failed`, isError: true };
    }
    if (passedMatch) {
      const label = prefix ? `${prefix}: ` : '';
      return { text: `💻 ${label}${passedMatch[1]} tests passed`, isError: false };
    }
  }

  // Lint
  if (/lint|eslint|prettier/i.test(detail)) {
    if (/error|warning|failed/i.test(detail)) {
      const count = detail.match(/(\d+)\s*(error|warning)/i);
      return { text: `💻 lint: ${count ? count[0] : 'issues found'}`, isError: true };
    }
    return null;
  }

  // Error — blockquote expandable for long traces
  if (/error|failed|exception|ENOENT|EACCES|ERR_/i.test(detail)) {
    const errorLines = detail.split('\n').filter(l => l.trim()).slice(0, 8);
    const firstError = esc(truncate(errorLines[0] || detail, 200));
    if (errorLines.length > 1) {
      const rest = errorLines.slice(1).map(l => esc(l)).join('\n');
      return {
        text: `❌ ${firstError}\n<blockquote expandable><pre>${truncate(rest, 1000)}</pre></blockquote>`,
        isError: true,
      };
    }
    return { text: `❌ ${firstError}`, isError: true };
  }

  return null; // Success → silent
}

export function formatProgressCard(progress: SessionProgress): string {
  const duration = elapsed(Date.now() - progress.startedAt);
  const counters: string[] = [];
  if (progress.reads) counters.push(`${progress.reads}r`);
  if (progress.edits) counters.push(`${progress.edits}e`);
  if (progress.creates) counters.push(`${progress.creates}c`);
  if (progress.commands) counters.push(`${progress.commands}cmd`);
  const counterStr = counters.length ? `  ${counters.join(' ')}` : '';

  const parts = [`📊 ${bold(duration)}  ·  ${progress.totalMessages} msgs${counterStr}`];

  if (progress.filesEdited.length > 0) {
    const files = progress.filesEdited.slice(0, 4).map(f => code(shortPath(f))).join(', ');
    const extra = progress.filesEdited.length > 4 ? ` +${progress.filesEdited.length - 4}` : '';
    parts.push(`Files: ${files}${extra}`);
  }

  if (progress.lastMessage) {
    parts.push(esc(truncate(progress.lastMessage, 150)));
  }

  return parts.join('\n');
}
