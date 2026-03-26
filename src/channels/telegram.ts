/**
 * channels/telegram.ts — Telegram notification channel.
 *
 * Creates one topic per CC session in a Telegram supergroup.
 * Bidirectional: reads replies from topics and fires inbound commands.
 *
 * Formatting: HTML parse_mode with structured, clean messages.
 */

import type {
  Channel,
  SessionEventPayload,
  InboundHandler,
} from './types.js';
import type { SwarmMonitor } from '../swarm-monitor.js';

import {
  esc as styleEsc,
  bold as styleBold,
  code as styleCode,
  quickUpdate,
  quickUpdateCode,
  taskComplete,
  alert as styleAlert,
  yesNo,
  decision,
  progress as styleProgress,
  type StyledMessage,
} from './telegram-style.js';

export interface TelegramChannelConfig {
  botToken: string;
  groupChatId: string;
}

interface SessionTopic {
  sessionId: string;
  topicId: number;
  windowName: string;
}

interface SessionProgress {
  totalMessages: number;
  reads: number;
  edits: number;
  creates: number;
  commands: number;
  searches: number;
  errors: number;
  filesRead: string[];
  filesEdited: string[];
  startedAt: number;
  lastMessage: string;
  currentStatus: string;
  progressMessageId: number | null; // For edit-in-place progress
}

interface QueuedItem {
  text: string;
  priority: 'high' | 'normal' | 'low';
  timestamp: number;
}

// Global rate limit state for Telegram API
let rateLimitUntil = 0;

/** Call Telegram Bot API with retry on 429. */
async function tgApi(
  token: string,
  method: string,
  body: Record<string, unknown>,
  retries = 3,
): Promise<unknown> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const now = Date.now();
    if (rateLimitUntil > now) {
      const waitMs = rateLimitUntil - now;
      console.log(`Telegram rate limit: waiting ${Math.ceil(waitMs / 1000)}s before ${method}`);
      await sleep(waitMs);
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      ok: boolean;
      result?: unknown;
      description?: string;
      parameters?: { retry_after?: number };
    };

    if (data.ok) return data.result;

    if (res.status === 429 && data.parameters?.retry_after) {
      const retryAfter = data.parameters.retry_after;
      rateLimitUntil = Date.now() + retryAfter * 1000 + 500;
      console.log(
        `Telegram 429: retry_after=${retryAfter}s, attempt ${attempt + 1}/${retries + 1}`,
      );
      if (attempt < retries) {
        await sleep(retryAfter * 1000 + 500);
        continue;
      }
    }

    if (attempt === retries) {
      throw new Error(`Telegram API ${method}: ${data.description || 'unknown error'}`);
    }
    await sleep(1000 * (attempt + 1));
  }
  throw new Error('Unreachable');
}

// ── HTML Helpers ────────────────────────────────────────────────────────────

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function bold(text: string): string {
  return `<b>${esc(text)}</b>`;
}

function code(text: string): string {
  return `<code>${esc(text)}</code>`;
}

function italic(text: string): string {
  return `<i>${esc(text)}</i>`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function shortPath(path: string): string {
  // Keep only filename or last 2 segments
  const parts = path.replace(/^\//, '').split('/');
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
function stripXmlTags(text: string): string {
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
function parseOptions(text: string): Array<{ label: string; value: string }> | null {
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
function formatSubAgentTree(text: string): string | null {
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

/**
 * Convert Markdown to Telegram HTML.
 * Handles: **bold**, `code`, ```blocks```, [links](url), tables
 * Must be called BEFORE wrapping in blockquote/pre tags.
 */
function md2html(md: string): string {
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
    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // List bullets
    processed = processed.replace(/^(\s*)[-*]\s+/, '$1• ');

    result += processed + '\n';
  }

  // Close unclosed blocks
  if (inCodeBlock) result += '</pre>\n';
  if (inTable) result += '\n';

  return result.trimEnd();
}

// ── Message Formatting ──────────────────────────────────────────────────────

function formatSessionCreated(name: string, workDir: string, id: string, meta?: Record<string, unknown>): string {
  const shortId = id.slice(0, 8);
  const shortDir = workDir.replace(/^\/home\/[^/]+\/projects\//, '~/');
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
  return `🚀 ${parts.join('\n')}`;
}

function formatSessionEnded(name: string, detail: string, progress: SessionProgress): string {
  const duration = elapsed(Date.now() - progress.startedAt);
  const lines = [`✅ ${bold('Done')}  ${duration}  ·  ${progress.totalMessages} msgs`];

  // Quality gate checklist
  const checks: string[] = [];
  if (progress.errors === 0) checks.push('☑ No errors');
  else checks.push(`☒ ${progress.errors} errors`);
  if (progress.edits || progress.creates) {
    const edited = progress.filesEdited.slice(0, 5).map(f => code(shortPath(f))).join(', ');
    const extra = progress.filesEdited.length > 5 ? ` +${progress.filesEdited.length - 5}` : '';
    checks.push(`☑ Files: ${edited}${extra}`);
  }
  if (checks.length) lines.push(checks.join('\n'));

  if (detail) {
    const d = truncate(detail, 200);
    lines.push(esc(d));
  }
  return lines.join('\n\n');
}

function formatAssistantMessage(detail: string): string | null {
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

interface ToolInfo {
  icon: string;
  label: string;
  file?: string;
  cmd?: string;
  category: 'read' | 'edit' | 'create' | 'search' | 'command' | 'other';
}

function parseToolUse(detail: string): ToolInfo {
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

function formatToolResult(detail: string): { text: string; isError: boolean } | null {
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

function formatProgressCard(progress: SessionProgress): string {
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

// ── Telegram Channel ────────────────────────────────────────────────────────

export class TelegramChannel implements Channel {
  readonly name = 'telegram';

  private topics = new Map<string, SessionTopic>();
  private progress = new Map<string, SessionProgress>();
  private pollOffset = 0;
  private polling = false;
  private onInbound: InboundHandler | null = null;

  // Rate limiting & batching
  private messageQueue = new Map<string, QueuedItem[]>();
  private lastSent = new Map<string, number>();
  private flushTimers = new Map<string, NodeJS.Timeout>();
  private pendingTool = new Map<string, ToolInfo>();

  // Issue #89 L12: Backpressure — max in-flight messages per session
  static readonly MAX_IN_FLIGHT = 10;
  private inFlightCount = new Map<string, number>();

  // Issue #46: Buffer messages that arrive before topic is created
  private preTopicBuffer = new Map<string, Array<{ method: string; payload: SessionEventPayload }>>();

  // Group consecutive reads
  private pendingReads = new Map<string, string[]>();
  private readTimer = new Map<string, NodeJS.Timeout>();

  // Dedup: track last user message text per session to avoid duplicates
  private lastUserMessage = new Map<string, string>();

  // Issue #71: Swarm monitor for /swarm command
  private swarmMonitor: SwarmMonitor | null = null;

  /** Set the swarm monitor for /swarm command support. */
  setSwarmMonitor(monitor: SwarmMonitor): void {
    this.swarmMonitor = monitor;
  }

  constructor(private config: TelegramChannelConfig) {}

  async init(onInbound: InboundHandler): Promise<void> {
    this.onInbound = onInbound;
    this.polling = true;
    this.pollLoop(); // fire-and-forget
    console.log(`Telegram channel: polling started, group ${this.config.groupChatId}`);
  }

  async destroy(): Promise<void> {
    this.polling = false;
    for (const timer of this.flushTimers.values()) clearTimeout(timer);
    for (const timer of this.readTimer.values()) clearTimeout(timer);
    this.flushTimers.clear();
    this.readTimer.clear();
  }

  async onSessionCreated(payload: SessionEventPayload): Promise<void> {
    const topicName = `🤖 ${payload.session.name}`;
    const result = (await tgApi(this.config.botToken, 'createForumTopic', {
      chat_id: this.config.groupChatId,
      name: topicName,
    })) as { message_thread_id: number };

    const topicId = result.message_thread_id;
    this.topics.set(payload.session.id, {
      sessionId: payload.session.id,
      topicId,
      windowName: payload.session.name,
    });

    this.progress.set(payload.session.id, {
      totalMessages: 0,
      reads: 0,
      edits: 0,
      creates: 0,
      commands: 0,
      searches: 0,
      errors: 0,
      filesRead: [],
      filesEdited: [],
      startedAt: Date.now(),
      lastMessage: '',
      currentStatus: 'starting',
      progressMessageId: null,
    });

    await this.sendImmediate(
      payload.session.id,
      formatSessionCreated(payload.session.name, payload.session.workDir, payload.session.id, payload.meta),
    );

    // Issue #46: Replay any messages that arrived before topic was created
    const buffered = this.preTopicBuffer.get(payload.session.id);
    if (buffered && buffered.length > 0) {
      console.log(`Telegram: replaying ${buffered.length} buffered messages for ${payload.session.name}`);
      for (const item of buffered) {
        if (item.method === 'message') {
          await this.onMessage(item.payload);
        } else if (item.method === 'statusChange') {
          await this.onStatusChange(item.payload);
        }
      }
    }
    this.preTopicBuffer.delete(payload.session.id);
  }

  async onSessionEnded(payload: SessionEventPayload): Promise<void> {
    // Flush pending reads
    await this.flushReads(payload.session.id);
    await this.flushQueue(payload.session.id);

    const prog = this.progress.get(payload.session.id);
    if (prog) {
      // Use taskComplete style for clean session endings
      const duration = elapsed(Date.now() - prog.startedAt);
      const checks: Array<[string, boolean]> = [];
      checks.push([`${prog.totalMessages} msgs`, true]);
      checks.push([prog.errors === 0 ? 'No errors' : `${prog.errors} errors`, prog.errors === 0]);
      if (prog.filesEdited.length > 0) {
        checks.push([`${prog.filesEdited.length} files edited`, true]);
      }

      const styled = taskComplete({
        taskRef: payload.session.name,
        title: truncate(payload.detail || 'Session complete', 80),
        duration,
        branch: '',
        checks,
      });
      await this.sendStyled(payload.session.id, styled);
    } else {
      const styled = quickUpdate('✅', `${payload.session.name} — Session ended`);
      await this.sendStyled(payload.session.id, styled);
    }

    this.cleanup(payload.session.id);
  }

  async onMessage(payload: SessionEventPayload): Promise<void> {
    // Issue #46: If topic doesn't exist yet, buffer the message
    if (!this.topics.has(payload.session.id)) {
      if (!this.preTopicBuffer.has(payload.session.id)) {
        this.preTopicBuffer.set(payload.session.id, []);
      }
      this.preTopicBuffer.get(payload.session.id)!.push({ method: 'message', payload });
      return;
    }

    const progress = this.progress.get(payload.session.id);
    if (progress) progress.totalMessages++;

    switch (payload.event) {
      case 'message.user': {
        await this.flushReads(payload.session.id);
        // Dedup: skip if this is the same message we just sent
        const lastMsg = this.lastUserMessage.get(payload.session.id);
        if (lastMsg === payload.detail) break;
        this.lastUserMessage.set(payload.session.id, payload.detail);
        await this.queueMessage(payload.session.id, `👤 ${bold('User')}  ${esc(truncate(payload.detail, 200))}`, 'high');
        break;
      }

      case 'message.assistant': {
        if (progress) progress.lastMessage = truncate(payload.detail, 500);
        const formatted = formatAssistantMessage(payload.detail);
        if (formatted) {
          await this.queueMessage(payload.session.id, formatted, 'normal');
        }
        break;
      }

      case 'message.thinking':
        // Completely silent — no thinking noise
        break;

      case 'message.tool_use': {
        const detail = payload.detail?.trim();
        // Skip empty/whitespace-only tool_use — nothing useful to show
        if (!detail) break;

        const tool = parseToolUse(detail);
        this.pendingTool.set(payload.session.id, tool);

        if (progress) {
          switch (tool.category) {
            case 'read': progress.reads++; if (tool.file) progress.filesRead.push(tool.file); break;
            case 'edit': progress.edits++; if (tool.file && !progress.filesEdited.includes(tool.file)) progress.filesEdited.push(tool.file); break;
            case 'create': progress.creates++; if (tool.file && !progress.filesEdited.includes(tool.file)) progress.filesEdited.push(tool.file); break;
            case 'search': progress.searches++; break;
            case 'command': progress.commands++; break;
          }
        }
        break;
      }

      case 'message.tool_result': {
        const tool = this.pendingTool.get(payload.session.id);
        this.pendingTool.delete(payload.session.id);

        const result = formatToolResult(payload.detail);

        if (result) {
          // Has result to show (error, build, test)
          await this.flushReads(payload.session.id);
          if (result.isError && progress) progress.errors++;
          // Use alert style for critical errors, quick update for non-critical
          if (result.isError && tool?.category === 'command') {
            const styled = styleAlert(
              { title: tool.label || 'Command failed', resourceId: payload.session.name, details: truncate(payload.detail, 200) },
            );
            await this.sendStyled(payload.session.id, styled);
          } else {
            await this.queueMessage(payload.session.id, result.text, result.isError ? 'high' : 'normal');
          }
        } else if (tool && tool.label) {
          // Success → show the tool action grouped with consecutive reads
          if (tool.category === 'read' && tool.file) {
            this.addPendingRead(payload.session.id, tool.file);
          } else {
            await this.flushReads(payload.session.id);
            await this.queueMessage(
              payload.session.id,
              `${tool.icon} ${esc(tool.label)}`,
              'low',
            );
          }
        }
        // else: unknown/empty tool — silent (tracked in progress counters only)
        break;
      }
    }

    // Progress card every 5 messages — edit-in-place (was 15, too infrequent)
    if (progress && progress.totalMessages > 0 && progress.totalMessages % 5 === 0) {
      await this.flushReads(payload.session.id);
      const progressText = formatProgressCard(progress);
      if (progress.progressMessageId) {
        // Edit existing progress message
        await this.editMessage(payload.session.id, progress.progressMessageId, progressText);
      } else {
        // First progress message — send new, store ID
        const msgId = await this.sendImmediate(payload.session.id, progressText);
        if (msgId) progress.progressMessageId = msgId;
      }
    }
  }

  async onStatusChange(payload: SessionEventPayload): Promise<void> {
    // Issue #46: If topic doesn't exist yet, buffer the status change
    if (!this.topics.has(payload.session.id)) {
      if (!this.preTopicBuffer.has(payload.session.id)) {
        this.preTopicBuffer.set(payload.session.id, []);
      }
      this.preTopicBuffer.get(payload.session.id)!.push({ method: 'statusChange', payload });
      return;
    }

    // Track current status for progress cards
    const progress = this.progress.get(payload.session.id);
    const statusName = payload.event.replace('status.', '');
    if (progress) progress.currentStatus = statusName;

    switch (payload.event) {
      case 'status.permission': {
        await this.flushReads(payload.session.id);
        await this.flushQueue(payload.session.id);
        const permSummary = truncate(payload.detail, 300);
        const options = parseOptions(payload.detail);

        const buttons: Array<{ text: string; callback_data: string }> = [];

        if (options) {
          // Dynamic buttons from CC's options
          for (const opt of options) {
            buttons.push({
              text: opt.label,
              callback_data: `cb_option:${payload.session.id}:${opt.value}`,
            });
          }
        } else {
          // Fallback: generic approve/reject
          buttons.push(
            { text: '✅ Approve', callback_data: `perm_approve:${payload.session.id}` },
            { text: '❌ Reject', callback_data: `perm_reject:${payload.session.id}` },
          );
        }

        const permStyled: StyledMessage = {
          text: `⚠️ Permission: ${esc(permSummary)}`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [buttons] },
        };
        await this.sendStyled(payload.session.id, permStyled);
        break;
      }

      case 'status.idle':
        // Silent unless there's meaningful detail
        break;

      case 'status.working':
        // Silent
        break;

      case 'status.question': {
        await this.flushReads(payload.session.id);
        await this.flushQueue(payload.session.id);
        const questionText = esc(truncate(payload.detail, 400));
        const options = parseOptions(payload.detail);

        const buttons: Array<{ text: string; callback_data: string }> = [];

        if (options) {
          for (const opt of options) {
            buttons.push({
              text: opt.label,
              callback_data: `cb_option:${payload.session.id}:${opt.value}`,
            });
          }
          // Always add Skip for questions
          if (buttons.length < 4) {
            buttons.push({ text: '🤷 Skip', callback_data: `cb_skip:${payload.session.id}` });
          }
        } else {
          buttons.push(
            { text: '✅ Yes', callback_data: `cb_yes:${payload.session.id}` },
            { text: '❌ No', callback_data: `cb_no:${payload.session.id}` },
            { text: '🤷 Skip', callback_data: `cb_skip:${payload.session.id}` },
          );
        }

        const qStyled: StyledMessage = {
          text: `❓ ${questionText}`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [buttons] },
        };
        await this.sendStyled(payload.session.id, qStyled);
        break;
      }

      case 'status.plan': {
        await this.flushReads(payload.session.id);
        await this.flushQueue(payload.session.id);
        const planLines = payload.detail.split('\n');
        const planSummary = md2html(truncate(planLines[0] || payload.detail, 200));
        const planBody = planLines.length > 1
          ? `\n<blockquote expandable>${md2html(planLines.slice(1).join('\n'))}</blockquote>`
          : '';

        const planStyled: StyledMessage = {
          text: `📋 ${planSummary}${planBody}`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '▶ Execute', callback_data: `plan_exec:${payload.session.id}` },
                { text: '⚡ Execute All', callback_data: `plan_exec_all:${payload.session.id}` },
                { text: '❌ Cancel', callback_data: `plan_cancel:${payload.session.id}` },
              ],
            ],
          },
        };
        await this.sendStyled(payload.session.id, planStyled);
        break;
      }

      case 'swarm.teammate_spawned': {
        await this.flushReads(payload.session.id);
        const teammateName = (payload.meta?.teammateName as string) || 'unknown';
        const teammateId = (payload.meta?.teammateWindowId as string) || '';
        const label = `${bold(teammateName)}${teammateId ? `  ${code(teammateId)}` : ''}`;
        await this.sendImmediate(payload.session.id, `🔧 Teammate ${label} spawned`);
        break;
      }

      case 'swarm.teammate_finished': {
        await this.flushReads(payload.session.id);
        const teammateName = (payload.meta?.teammateName as string) || 'unknown';
        await this.sendImmediate(payload.session.id, `✅ Teammate ${bold(teammateName)} finished`);
        break;
      }
    }
  }

  // ── Read grouping ─────────────────────────────────────────────────────────

  private addPendingRead(sessionId: string, file: string): void {
    if (!this.pendingReads.has(sessionId)) {
      this.pendingReads.set(sessionId, []);
    }
    this.pendingReads.get(sessionId)!.push(file);

    // Flush after 4 seconds to batch consecutive reads
    const existing = this.readTimer.get(sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => this.flushReads(sessionId), 4000);
    this.readTimer.set(sessionId, timer);
  }

  private async flushReads(sessionId: string): Promise<void> {
    const timer = this.readTimer.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.readTimer.delete(sessionId);
    }

    const files = this.pendingReads.get(sessionId);
    if (!files || files.length === 0) return;
    this.pendingReads.delete(sessionId);

    if (files.length === 1) {
      await this.queueMessage(sessionId, `📖 Reading ${code(shortPath(files[0]))}`, 'low');
    } else {
      const listed = files.slice(0, 8).map(f => code(shortPath(f))).join(', ');
      const extra = files.length > 8 ? ` +${files.length - 8} more` : '';
      await this.queueMessage(
        sessionId,
        `📖 Reading ${bold(String(files.length))} files: ${listed}${extra}`,
        'low',
      );
    }
  }

  // ── Styled Message Support ─────────────────────────────────────────────────

  /**
   * Send a StyledMessage (from telegram-style.ts) with inline keyboard support.
   * This is the primary way to send the 6 standard message types.
   */
  async sendStyled(sessionId: string, styled: StyledMessage): Promise<number | null> {
    await this.flushQueue(sessionId);
    return this.sendStyledToTopic(sessionId, styled);
  }

  private async sendStyledToTopic(sessionId: string, styled: StyledMessage): Promise<number | null> {
    const topic = this.topics.get(sessionId);
    if (!topic) return null;

    const truncated = styled.text.length > 4096 ? styled.text.slice(0, 4096) + '\n…' : styled.text;

    // Rate limit: 3s between messages per session
    const lastSentTime = this.lastSent.get(sessionId) || 0;
    const now = Date.now();
    const waitMs = Math.max(0, 3000 - (now - lastSentTime));
    if (waitMs > 0) await sleep(waitMs);

    const body: Record<string, unknown> = {
      chat_id: this.config.groupChatId,
      message_thread_id: topic.topicId,
      text: truncated,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };

    if (styled.reply_markup) {
      body.reply_markup = JSON.stringify(styled.reply_markup);
    }

    try {
      const result = (await tgApi(this.config.botToken, 'sendMessage', body)) as { message_id: number };
      this.lastSent.set(sessionId, Date.now());
      return result.message_id;
    } catch {
      // Fallback: strip HTML + buttons, send plain
      try {
        const plain = truncated.replace(/<[^>]+>/g, '');
        const result = (await tgApi(this.config.botToken, 'sendMessage', {
          chat_id: this.config.groupChatId,
          message_thread_id: topic.topicId,
          text: plain,
          disable_web_page_preview: true,
        })) as { message_id: number };
        this.lastSent.set(sessionId, Date.now());
        return result.message_id;
      } catch (e) {
        console.error(`Telegram: failed to send styled to topic ${topic.topicId}:`, e);
        return null;
      }
    }
  }

  /**
   * Edit a message in-place with a StyledMessage (for progress updates with buttons).
   */
  async editStyled(sessionId: string, messageId: number, styled: StyledMessage): Promise<boolean> {
    const topic = this.topics.get(sessionId);
    if (!topic) return false;

    const truncated = styled.text.length > 4096 ? styled.text.slice(0, 4096) + '\n…' : styled.text;
    const body: Record<string, unknown> = {
      chat_id: this.config.groupChatId,
      message_id: messageId,
      text: truncated,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (styled.reply_markup) {
      body.reply_markup = JSON.stringify(styled.reply_markup);
    }

    try {
      await tgApi(this.config.botToken, 'editMessageText', body);
      return true;
    } catch {
      return false;
    }
  }

  // ── Edit in-place (for progress) ────────────────────────────────────────────

  private async editMessage(sessionId: string, messageId: number, text: string): Promise<boolean> {
    const topic = this.topics.get(sessionId);
    if (!topic) return false;

    const truncated = text.length > 4096 ? text.slice(0, 4096) + '\n…' : text;
    try {
      await tgApi(this.config.botToken, 'editMessageText', {
        chat_id: this.config.groupChatId,
        message_id: messageId,
        text: truncated,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      return true;
    } catch {
      // Edit can fail if message is too old or unchanged — not critical
      return false;
    }
  }

  // ── Send / Queue ──────────────────────────────────────────────────────────

  private async sendImmediate(sessionId: string, text: string): Promise<number | null> {
    await this.flushQueue(sessionId);
    return this.sendToTopic(sessionId, text);
  }

  private async sendToTopic(sessionId: string, text: string): Promise<number | null> {
    const topic = this.topics.get(sessionId);
    if (!topic) return null;

    const truncated = text.length > 4096 ? text.slice(0, 4096) + '\n…' : text;

    // Rate limit: 3s between messages per session
    const lastSent = this.lastSent.get(sessionId) || 0;
    const now = Date.now();
    const waitMs = Math.max(0, 3000 - (now - lastSent));
    if (waitMs > 0) await sleep(waitMs);

    // Issue #89 L12: Track in-flight count
    this.inFlightCount.set(sessionId, (this.inFlightCount.get(sessionId) || 0) + 1);

    // Try HTML first, fallback to plain text
    try {
      const result = (await tgApi(this.config.botToken, 'sendMessage', {
        chat_id: this.config.groupChatId,
        message_thread_id: topic.topicId,
        text: truncated,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      })) as { message_id: number };
      this.lastSent.set(sessionId, Date.now());
      this.decrementInFlight(sessionId);
      return result.message_id;
    } catch {
      // Fallback: strip HTML, send plain
      try {
        const plain = truncated.replace(/<[^>]+>/g, '');
        const result = (await tgApi(this.config.botToken, 'sendMessage', {
          chat_id: this.config.groupChatId,
          message_thread_id: topic.topicId,
          text: plain,
          disable_web_page_preview: true,
        })) as { message_id: number };
        this.lastSent.set(sessionId, Date.now());
        this.decrementInFlight(sessionId);
        return result.message_id;
      } catch (e) {
        console.error(`Telegram: failed to send to topic ${topic.topicId}:`, e);
        this.decrementInFlight(sessionId);
        return null;
      }
    }
  }

  /** Issue #89 L12: Decrement in-flight counter, clamped to 0. */
  private decrementInFlight(sessionId: string): void {
    const current = this.inFlightCount.get(sessionId) || 0;
    if (current <= 1) {
      this.inFlightCount.delete(sessionId);
    } else {
      this.inFlightCount.set(sessionId, current - 1);
    }
  }

  private async queueMessage(
    sessionId: string,
    text: string,
    priority: QueuedItem['priority'],
  ): Promise<void> {
    if (!this.messageQueue.has(sessionId)) {
      this.messageQueue.set(sessionId, []);
    }
    const queue = this.messageQueue.get(sessionId)!;

    // Issue #89 L12: Backpressure — if in-flight + pending exceeds max, drop oldest pending
    const inFlight = this.inFlightCount.get(sessionId) || 0;
    if (inFlight + queue.length >= TelegramChannel.MAX_IN_FLIGHT) {
      const dropped = queue.shift();
      console.warn(`Telegram backpressure: dropped oldest pending message for session ${sessionId} (in-flight: ${inFlight}, queued: ${queue.length})`);
      void dropped; // consumed
    }

    queue.push({ text, priority, timestamp: Date.now() });

    // High priority: flush immediately
    if (priority === 'high') {
      await this.flushQueue(sessionId);
      return;
    }

    // Normal/low: batch for 3 seconds
    if (!this.flushTimers.has(sessionId)) {
      const timer = setTimeout(() => this.flushQueue(sessionId), 3000);
      this.flushTimers.set(sessionId, timer);
    }
  }

  private async flushQueue(sessionId: string): Promise<void> {
    const timer = this.flushTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(sessionId);
    }

    const items = this.messageQueue.get(sessionId);
    if (!items || items.length === 0) return;
    this.messageQueue.delete(sessionId);

    // Group low-priority items together, send high/normal separately
    const groups: string[] = [];
    let lowBatch: string[] = [];

    for (const item of items) {
      if (item.priority === 'low') {
        lowBatch.push(item.text);
      } else {
        // Flush any pending low-priority batch first
        if (lowBatch.length > 0) {
          groups.push(lowBatch.join('\n'));
          lowBatch = [];
        }
        groups.push(item.text);
      }
    }
    if (lowBatch.length > 0) {
      groups.push(lowBatch.join('\n'));
    }

    for (let i = 0; i < groups.length; i++) {
      await this.sendToTopic(sessionId, groups[i]);
    }
  }

  private cleanup(sessionId: string): void {
    this.topics.delete(sessionId);
    this.progress.delete(sessionId);
    this.lastSent.delete(sessionId);
    this.pendingTool.delete(sessionId);
    this.pendingReads.delete(sessionId);
    this.preTopicBuffer.delete(sessionId);
    this.lastUserMessage.delete(sessionId);
    this.inFlightCount.delete(sessionId);
    const ft = this.flushTimers.get(sessionId);
    if (ft) { clearTimeout(ft); this.flushTimers.delete(sessionId); }
    const rt = this.readTimer.get(sessionId);
    if (rt) { clearTimeout(rt); this.readTimer.delete(sessionId); }
  }

  // ── /swarm command ──────────────────────────────────────────────────

  private async handleSwarmCommand(sessionId: string): Promise<void> {
    if (!this.swarmMonitor) {
      await this.sendImmediate(sessionId, '⚠️ Swarm monitoring not available');
      return;
    }

    const swarm = this.swarmMonitor.findSwarmByParentSessionId(sessionId);
    if (!swarm || swarm.teammates.length === 0) {
      await this.sendImmediate(sessionId, '🐝 No active swarm teammates');
      return;
    }

    const statusEmoji: Record<string, string> = {
      running: '🔄',
      idle: '💤',
      dead: '💀',
    };

    const lines = [`🐝 ${bold('Swarm')}  ${swarm.teammates.length} teammate${swarm.teammates.length !== 1 ? 's' : ''}\n`];
    for (const t of swarm.teammates) {
      const emoji = statusEmoji[t.status] || '❓';
      lines.push(`${emoji} ${bold(t.windowName)}  ${code(t.windowId)}  ${t.status}`);
    }

    await this.sendImmediate(sessionId, lines.join('\n'));
  }

  // ── Bidirectional polling ─────────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const updates = (await tgApi(this.config.botToken, 'getUpdates', {
          offset: this.pollOffset,
          timeout: 10,
          allowed_updates: ['message', 'callback_query'],
        })) as Array<{ update_id: number; message?: unknown; callback_query?: unknown }>;

        if (Array.isArray(updates)) {
          for (const update of updates) {
            this.pollOffset = update.update_id + 1;
            await this.handleUpdate(update);
          }
        }
      } catch (e) {
        console.error('Telegram poll error:', e);
        await sleep(5000);
      }
    }
  }

  private async handleUpdate(update: { message?: unknown; callback_query?: unknown }): Promise<void> {
    // Handle callback queries from inline buttons
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    const msg = update.message as {
      text?: string;
      message_thread_id?: number;
      from?: { is_bot?: boolean };
    } | undefined;

    if (!msg?.text || !msg.message_thread_id || msg.from?.is_bot) return;

    for (const [sessionId, topic] of this.topics) {
      if (topic.topicId === msg.message_thread_id) {
        const text = msg.text.trim().toLowerCase();
        const raw = msg.text.trim();

        if (text === 'approve' || text === 'y' || text === 'yes') {
          await this.onInbound?.({ sessionId, action: 'approve' });
        } else if (text === 'reject' || text === 'n' || text === 'no') {
          await this.onInbound?.({ sessionId, action: 'reject' });
        } else if (text === 'escape' || text === 'esc') {
          await this.onInbound?.({ sessionId, action: 'escape' });
        } else if (text === 'kill' || text === 'stop') {
          await this.onInbound?.({ sessionId, action: 'kill' });
        } else if (text === '/swarm') {
          await this.handleSwarmCommand(sessionId);
        } else if (raw.startsWith('/')) {
          await this.onInbound?.({ sessionId, action: 'command', text: raw });
        } else {
          await this.onInbound?.({ sessionId, action: 'message', text: raw });
        }
        break;
      }
    }
  }

  private async handleCallbackQuery(cbQuery: unknown): Promise<void> {
    const cb = cbQuery as {
      id: string;
      data?: string;
      message?: { message_id?: number; message_thread_id?: number };
    };

    if (!cb.data || !cb.message?.message_thread_id) return;

    // Answer the callback to remove loading state
    try {
      await tgApi(this.config.botToken, 'answerCallbackQuery', { callback_query_id: cb.id });
    } catch { /* non-critical */ }

    // Route callback to the right session
    for (const [sessionId, topic] of this.topics) {
      if (topic.topicId === cb.message.message_thread_id) {
        const data = cb.data;

        if (data.startsWith('perm_approve:')) {
          await this.onInbound?.({ sessionId, action: 'approve' });
          // Remove buttons after one-shot action
          if (cb.message.message_id) {
            await this.removeReplyMarkup(sessionId, cb.message.message_id);
          }
        } else if (data.startsWith('perm_reject:')) {
          await this.onInbound?.({ sessionId, action: 'reject' });
          if (cb.message.message_id) {
            await this.removeReplyMarkup(sessionId, cb.message.message_id);
          }
        } else if (data.startsWith('cb_option:')) {
          // Dynamic option from parseOptions: extract value after sessionId:
          const optParts = data.split(':');
          const optValue = optParts.slice(2).join(':');
          await this.onInbound?.({ sessionId, action: 'message', text: optValue });
          if (cb.message.message_id) {
            await this.removeReplyMarkup(sessionId, cb.message.message_id);
          }
        } else if (data.startsWith('cb_yes:')) {
          await this.onInbound?.({ sessionId, action: 'message', text: 'yes' });
          if (cb.message.message_id) {
            await this.removeReplyMarkup(sessionId, cb.message.message_id);
          }
        } else if (data.startsWith('cb_no:')) {
          await this.onInbound?.({ sessionId, action: 'message', text: 'no' });
          if (cb.message.message_id) {
            await this.removeReplyMarkup(sessionId, cb.message.message_id);
          }
        } else if (data.startsWith('cb_skip:')) {
          await this.onInbound?.({ sessionId, action: 'message', text: 'skip' });
          if (cb.message.message_id) {
            await this.removeReplyMarkup(sessionId, cb.message.message_id);
          }
        } else if (data.startsWith('plan_exec:')) {
          await this.onInbound?.({ sessionId, action: 'message', text: 'Execute the plan step by step' });
          if (cb.message.message_id) {
            await this.removeReplyMarkup(sessionId, cb.message.message_id);
          }
        } else if (data.startsWith('plan_exec_all:')) {
          await this.onInbound?.({ sessionId, action: 'message', text: 'Execute all phases of the plan' });
          if (cb.message.message_id) {
            await this.removeReplyMarkup(sessionId, cb.message.message_id);
          }
        } else if (data.startsWith('plan_cancel:')) {
          await this.onInbound?.({ sessionId, action: 'escape' });
          if (cb.message.message_id) {
            await this.removeReplyMarkup(sessionId, cb.message.message_id);
          }
        } else {
          // Generic callback → forward as command
          await this.onInbound?.({ sessionId, action: 'command', text: data });
        }
        break;
      }
    }
  }

  /**
   * Remove inline keyboard from a message after button click (one-shot actions).
   */
  private async removeReplyMarkup(sessionId: string, messageId: number): Promise<void> {
    const topic = this.topics.get(sessionId);
    if (!topic) return;
    try {
      await tgApi(this.config.botToken, 'editMessageReplyMarkup', {
        chat_id: this.config.groupChatId,
        message_id: messageId,
        reply_markup: JSON.stringify({ inline_keyboard: [] }),
      });
    } catch { /* non-critical — message may be too old or already edited */ }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}