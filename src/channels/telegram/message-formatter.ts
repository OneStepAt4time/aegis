/**
 * channels/telegram/message-formatter.ts — Session/message formatting functions.
 * Extracted from formatter.ts to satisfy the 500-line architectural gate.
 */

import { homedir } from 'node:os';

import {
  esc,
  bold,
  code,
  italic,
} from '../telegram-style.js';

import type { ToolInfo, SessionProgress } from './types.js';
import {
  truncate,
  elapsed,
  shortPath,
  stripXmlTags,
  md2html,
} from './formatter.js';

// ── Path Utilities ────────────────────────────────────────────────────────

export function shortenHomePath(workDir: string): string {
  const normalized = workDir.replace(/\\/g, '/');
  const home = homedir().replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized === home) return '~';
  if (normalized.startsWith(`${home}/`)) return `~${normalized.slice(home.length)}`;
  return normalized;
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
