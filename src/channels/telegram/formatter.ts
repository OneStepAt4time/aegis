/**
 * channels/telegram/formatter.ts — Standalone formatting and utility functions
 * for the Telegram channel.
 */

import {
  esc,
  bold,
} from '../telegram-style.js';

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
