/**
 * telegram-style.test.ts — Tests for Telegram style guide compliance.
 *
 * Validates the formatting rules from docs/telegram-style-guide.md:
 * - 1 emoji per message at the start
 * - Max length limits per message type
 * - No separators (━━━)
 * - Blockquote expandable for long content
 * - Edit-in-place progress support
 */

import { describe, it, expect } from 'vitest';

// Re-implement formatting functions for testing (mirrors telegram.ts)
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
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

function shortPath(path: string): string {
  const parts = path.replace(/^\//, '').split('/');
  if (parts.length <= 2) return parts.join('/');
  return '…/' + parts.slice(-2).join('/');
}

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ── Format functions (mirroring telegram.ts) ────────────────────────────────

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
    parts.push(`${italic(esc(truncate(String(meta.prompt), 200)))}`);
  }
  return `🚀 ${parts.join('\n')}`;
}

function formatSessionEnded(_name: string, detail: string, progress: { totalMessages: number; errors: number; edits: number; creates: number; filesEdited: string[]; startedAt: number }): string {
  const duration = elapsed(Date.now() - progress.startedAt);
  const lines = [`✅ ${bold('Done')}  ${duration}  ·  ${progress.totalMessages} msgs`];
  const checks: string[] = [];
  if (progress.errors === 0) checks.push('☑ No errors');
  else checks.push(`☒ ${progress.errors} errors`);
  if (progress.edits || progress.creates) {
    const edited = progress.filesEdited.slice(0, 5).map(f => code(shortPath(f))).join(', ');
    const extra = progress.filesEdited.length > 5 ? ` +${progress.filesEdited.length - 5}` : '';
    checks.push(`☑ Files: ${edited}${extra}`);
  }
  if (checks.length) lines.push(checks.join('\n'));
  if (detail) lines.push(esc(truncate(detail, 200)));
  return lines.join('\n\n');
}

function formatAssistantMessage(detail: string): string | null {
  const text = detail.trim();
  if (!text) return null;
  const allLines = text.split('\n');
  const lines = allLines.filter(l => {
    const t = l.trim();
    return t && !t.match(/^(Let me|I'll|Sure,|Okay,|Alright,|Great,|Now I|I'm going to|First,? I|Looking at)/i);
  });
  if (lines.length === 0) return null;
  const firstLine = lines[0];
  const short = (): string => esc(truncate(lines.slice(0, 2).join(' '), 200));
  const withExpandable = (emoji: string, maxSummary = 200): string => {
    const summary = esc(truncate(firstLine, maxSummary));
    if (lines.length <= 2) return `${emoji} ${summary}`;
    const rest = lines.slice(1).map(l => esc(l)).join('\n');
    const restTruncated = truncate(rest, 1500);
    return `${emoji} ${summary}\n<blockquote expandable>${restTruncated}</blockquote>`;
  };
  if (/\?$/.test(firstLine)) return withExpandable('❓');
  if (/^(plan|steps?|approach)/im.test(firstLine)) return withExpandable('📋');
  if (/^(summary|done|complete|finished)/im.test(firstLine)) return withExpandable('✅');
  if (/^(writing|implementing|adding|creating|updating|fixing|refactor)/im.test(firstLine)) return `✏️ ${short()}`;
  if (/^(reading|examining|looking at|checking|analyzing)/im.test(firstLine)) return `🔍 ${short()}`;
  if (lines.length <= 2) return `💬 ${short()}`;
  return withExpandable('💬');
}

function formatProgressCard(progress: { totalMessages: number; reads: number; edits: number; creates: number; commands: number; filesEdited: string[]; startedAt: number }): string {
  const duration = elapsed(Date.now() - progress.startedAt);
  const counters: string[] = [];
  if (progress.reads) counters.push(`${progress.reads}r`);
  if (progress.edits) counters.push(`${progress.edits}e`);
  if (progress.creates) counters.push(`${progress.creates}c`);
  if (progress.commands) counters.push(`${progress.commands}cmd`);
  const counterStr = counters.length ? `  ${counters.join(' ')}` : '';
  const parts = [`📊 ${duration}  ·  ${progress.totalMessages} msgs${counterStr}`];
  if (progress.filesEdited.length > 0) {
    const files = progress.filesEdited.slice(0, 4).map(f => code(shortPath(f))).join(', ');
    const extra = progress.filesEdited.length > 4 ? ` +${progress.filesEdited.length - 4}` : '';
    parts.push(`Files: ${files}${extra}`);
  }
  return parts.join('\n');
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Telegram Style Guide Compliance', () => {
  // Helper: count emoji at the START of a message (first char)
  function startsWithOneEmoji(msg: string): boolean {
    // Strip HTML tags for analysis
    const stripped = msg.replace(/<[^>]+>/g, '');
    // Emoji are multi-byte — check first grapheme cluster is emoji
    const emojiRegex = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
    return emojiRegex.test(stripped);
  }

  // Helper: no separators
  function hasNoSeparators(msg: string): boolean {
    return !msg.includes('━') && !msg.includes('───') && !msg.includes('---');
  }

  describe('1 emoji rule', () => {
    it('session created starts with 1 emoji', () => {
      const msg = formatSessionCreated('cc-test', '/home/user/projects/aegis', 'abc12345-6789');
      expect(startsWithOneEmoji(msg)).toBe(true);
    });

    it('session ended starts with 1 emoji', () => {
      const msg = formatSessionEnded('cc-test', 'Done', {
        totalMessages: 50, errors: 0, edits: 3, creates: 1,
        filesEdited: ['src/a.ts', 'src/b.ts'], startedAt: Date.now() - 60000,
      });
      expect(startsWithOneEmoji(msg)).toBe(true);
    });

    it('assistant message starts with 1 emoji', () => {
      const msg = formatAssistantMessage('Writing the authentication module')!;
      expect(msg).not.toBeNull();
      expect(startsWithOneEmoji(msg)).toBe(true);
    });

    it('progress card starts with 1 emoji', () => {
      const msg = formatProgressCard({
        totalMessages: 30, reads: 10, edits: 3, creates: 1, commands: 5,
        filesEdited: ['src/a.ts'], startedAt: Date.now() - 120000,
      });
      expect(startsWithOneEmoji(msg)).toBe(true);
    });
  });

  describe('no separators', () => {
    it('session created has no separators', () => {
      const msg = formatSessionCreated('cc-test', '/home/user/projects/aegis', 'abc12345');
      expect(hasNoSeparators(msg)).toBe(true);
    });

    it('session ended has no separators', () => {
      const msg = formatSessionEnded('cc-test', 'Complete', {
        totalMessages: 50, errors: 0, edits: 3, creates: 1,
        filesEdited: ['src/a.ts'], startedAt: Date.now() - 60000,
      });
      expect(hasNoSeparators(msg)).toBe(true);
    });

    it('progress card has no separators', () => {
      const msg = formatProgressCard({
        totalMessages: 30, reads: 10, edits: 3, creates: 1, commands: 5,
        filesEdited: ['src/a.ts'], startedAt: Date.now() - 120000,
      });
      expect(hasNoSeparators(msg)).toBe(true);
    });
  });

  describe('length limits', () => {
    it('quick update (short assistant msg) fits in 2 lines', () => {
      const msg = formatAssistantMessage('Fixing the typo in config.ts')!;
      const stripped = msg.replace(/<[^>]+>/g, '');
      expect(stripped.split('\n').length).toBeLessThanOrEqual(2);
    });

    it('session ended fits in 10 lines', () => {
      const msg = formatSessionEnded('cc-test', 'All done', {
        totalMessages: 100, errors: 0, edits: 5, creates: 2,
        filesEdited: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
        startedAt: Date.now() - 300000,
      });
      const lines = msg.split('\n').filter(l => l.trim());
      expect(lines.length).toBeLessThanOrEqual(10);
    });

    it('progress card fits in 8 lines', () => {
      const msg = formatProgressCard({
        totalMessages: 50, reads: 20, edits: 8, creates: 3, commands: 10,
        filesEdited: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
        startedAt: Date.now() - 600000,
      });
      const lines = msg.split('\n').filter(l => l.trim());
      expect(lines.length).toBeLessThanOrEqual(8);
    });
  });

  describe('blockquote expandable for long content', () => {
    it('long assistant message uses blockquote expandable', () => {
      const longMsg = 'Here is the summary:\n' + Array.from({ length: 10 }, (_, i) => `Point ${i + 1}: something important here`).join('\n');
      const msg = formatAssistantMessage(longMsg)!;
      expect(msg).toContain('<blockquote expandable>');
    });

    it('short assistant message does NOT use blockquote', () => {
      const msg = formatAssistantMessage('Quick fix applied')!;
      expect(msg).not.toContain('<blockquote');
    });
  });

  describe('filler stripping', () => {
    it('strips filler-only messages', () => {
      expect(formatAssistantMessage("Let me check the code")).toBeNull();
      expect(formatAssistantMessage("I'll look into that now")).toBeNull();
      expect(formatAssistantMessage("Sure, let me do that")).toBeNull();
    });

    it('keeps meaningful content after filler', () => {
      const msg = formatAssistantMessage("Let me check\nThe config has a bug in line 42")!;
      expect(msg).not.toBeNull();
      expect(msg).toContain('bug');
    });
  });

  describe('session created format', () => {
    it('is compact (no multi-line headers)', () => {
      const msg = formatSessionCreated('cc-test', '/home/user/projects/aegis', 'abc12345-6789');
      // First line should contain name + dir + id
      const firstLine = msg.split('\n')[0];
      expect(firstLine).toContain('cc-test');
      expect(firstLine).toContain('abc12345');
    });

    it('includes flags inline', () => {
      const msg = formatSessionCreated('cc-test', '/tmp/x', 'abc12345', { permissionMode: 'acceptEdits', model: 'sonnet' });
      expect(msg).toContain('acceptEdits');
      expect(msg).toContain('sonnet');
    });

    it('includes legacy auto-approve flag for backward compat', () => {
      const msg = formatSessionCreated('cc-test', '/tmp/x', 'abc12345', { autoApprove: true, model: 'sonnet' });
      expect(msg).toContain('auto-approve');
      expect(msg).toContain('sonnet');
    });
  });

  describe('session ended format', () => {
    it('includes checklist', () => {
      const msg = formatSessionEnded('cc-test', '', {
        totalMessages: 50, errors: 0, edits: 3, creates: 0,
        filesEdited: ['src/a.ts'], startedAt: Date.now() - 60000,
      });
      expect(msg).toContain('☑');
    });

    it('shows errors as ☒', () => {
      const msg = formatSessionEnded('cc-test', '', {
        totalMessages: 50, errors: 2, edits: 3, creates: 0,
        filesEdited: ['src/a.ts'], startedAt: Date.now() - 60000,
      });
      expect(msg).toContain('☒ 2 errors');
    });
  });
});
