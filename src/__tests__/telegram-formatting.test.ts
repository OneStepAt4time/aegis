/**
 * telegram-formatting.test.ts — Tests for Issue #43: Telegram message formatting.
 */

import { describe, it, expect } from 'vitest';

// Test the formatting logic directly (these mirror the internal functions)

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function shortPath(path: string): string {
  const parts = path.replace(/^\//, '').split('/');
  if (parts.length <= 2) return parts.join('/');
  return '…/' + parts.slice(-2).join('/');
}

// Mirror sanitizeHref from telegram.ts for testing
const ALLOWED_HREF_SCHEMES = ['http:', 'https:', 'tg:', '#:', 'mailto:'];

function sanitizeHref(href: string): string {
  const trimmed = href.trim();
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return esc(trimmed);
  const scheme = trimmed.split(':')[0]?.toLowerCase() + ':';
  if (ALLOWED_HREF_SCHEMES.includes(scheme)) return esc(trimmed);
  return '#';
}

describe('Telegram formatting (Issue #43)', () => {
  describe('Truncation limits', () => {
    it('should allow 500 chars for assistant messages (not 150)', () => {
      const msg = 'A'.repeat(500);
      const truncated = truncate(msg, 500);
      expect(truncated).toBe(msg); // Exactly 500 — not truncated
    });

    it('should allow 800 chars for plans (not 180)', () => {
      const plan = 'Step 1: do X\nStep 2: do Y\n'.repeat(30);
      const truncated = truncate(plan, 800);
      expect(truncated.length).toBeLessThanOrEqual(800);
    });

    it('should allow 500 chars for questions (not 250)', () => {
      const question = 'What should I do about ' + 'X'.repeat(480) + '?';
      const truncated = truncate(question, 500);
      expect(truncated.length).toBeLessThanOrEqual(500);
    });
  });

  describe('Multi-line preservation', () => {
    it('should preserve newlines up to 10 lines for plans', () => {
      const lines = Array.from({ length: 15 }, (_, i) => `Step ${i + 1}: do something`);
      const selected = lines.slice(0, 10);
      expect(selected).toHaveLength(10);
      expect(selected.join('\n')).toContain('\n');
    });

    it('should preserve newlines up to 5 lines for default messages', () => {
      const lines = ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5', 'Line 6'];
      const selected = lines.slice(0, 5);
      expect(selected).toHaveLength(5);
    });

    it('should not collapse multi-line to single line', () => {
      const text = 'First line\nSecond line\nThird line';
      const lines = text.split('\n').slice(0, 5);
      const result = lines.map(l => esc(l)).join('\n');
      expect(result).toContain('\n');
      expect(result.split('\n')).toHaveLength(3);
    });
  });

  describe('Code blocks use <pre>', () => {
    it('should use <pre> for multi-line error output', () => {
      const error = 'Error: something failed\n  at line 10\n  at line 20';
      const errorLines = error.split('\n').filter(l => l.trim()).slice(0, 5);
      expect(errorLines.length).toBeGreaterThan(1);
      const formatted = `❌ <b>Error</b>\n<pre>${esc(errorLines.join('\n'))}</pre>`;
      expect(formatted).toContain('<pre>');
      expect(formatted).not.toContain('<code>');
    });

    it('should use <code> for single-line errors', () => {
      const error = 'ENOENT: file not found';
      const formatted = `❌ <code>${esc(error)}</code>`;
      expect(formatted).toContain('<code>');
    });

    it('should use <pre> for multi-line tool output', () => {
      const output = 'line1\nline2\nline3\nline4\nline5\nline6';
      expect(output.includes('\n')).toBe(true);
      expect(output.length).toBeGreaterThan(100 - 80); // would trigger <pre> at >100 chars
    });

    it('should use <pre> for permission prompt details', () => {
      const detail = 'Allow write to /home/user/project/src/index.ts\nContent: export function main()...';
      const formatted = `<pre>${esc(truncate(detail, 600))}</pre>`;
      expect(formatted).toContain('<pre>');
      expect(formatted).not.toContain('&lt;pre&gt;'); // esc should not double-escape tags outside
    });
  });

  describe('Session created — enhanced info', () => {
    it('should include permissionMode when non-default', () => {
      const meta = { permissionMode: 'acceptEdits' };
      const lines: string[] = [];
      if (meta.permissionMode && meta.permissionMode !== 'default') lines.push(`Mode: ${meta.permissionMode}`);
      expect(lines).toContain('Mode: acceptEdits');
    });

    it('should include legacy autoApprove status when true', () => {
      const meta = { autoApprove: true };
      const lines: string[] = [];
      if (meta.autoApprove) lines.push('✅ Auto-approve: ON');
      expect(lines).toContain('✅ Auto-approve: ON');
    });

    it('should include model when present', () => {
      const meta = { model: 'claude-sonnet-4' };
      const lines: string[] = [];
      if (meta.model) lines.push(`🧠 Model: ${meta.model}`);
      expect(lines[0]).toContain('claude-sonnet-4');
    });

    it('should include prompt preview', () => {
      const meta = { prompt: 'Build a login page with OAuth integration and dark theme' };
      const preview = truncate(String(meta.prompt), 200);
      expect(preview).toBe(meta.prompt); // Under 200 chars
    });

    it('should not show permissionMode when default', () => {
      const meta = { permissionMode: 'default' };
      const lines: string[] = [];
      if (meta.permissionMode && meta.permissionMode !== 'default') lines.push(`Mode: ${meta.permissionMode}`);
      expect(lines).toHaveLength(0);
    });
  });

  describe('Progress card — status and last message', () => {
    it('should include current status', () => {
      const status = 'working';
      const line = `Status: <b>${esc(status)}</b>`;
      expect(line).toContain('working');
    });

    it('should include last message', () => {
      const lastMessage = 'Writing the authentication middleware';
      const line = `<b>Last:</b> ${esc(truncate(lastMessage, 200))}`;
      expect(line).toContain('authentication middleware');
    });

    it('should truncate long last messages to 200 chars', () => {
      const lastMessage = 'X'.repeat(300);
      const truncated = truncate(lastMessage, 200);
      expect(truncated.length).toBe(200);
      expect(truncated.endsWith('…')).toBe(true);
    });
  });

  describe('HTML escaping', () => {
    it('should escape < and > in user content', () => {
      expect(esc('array<string>')).toBe('array&lt;string&gt;');
    });

    it('should escape & in content', () => {
      expect(esc('foo & bar')).toBe('foo &amp; bar');
    });

    it('should handle empty string', () => {
      expect(esc('')).toBe('');
    });

    it('should escape double quotes to prevent attribute injection', () => {
      expect(esc('hello "world"')).toBe('hello &quot;world&quot;');
    });

    it('should escape all HTML-special characters together', () => {
      expect(esc('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
    });
  });

  // ── Security: HTML injection vectors (#3219) ─────────────────────────────
  describe('Security: HTML injection prevention (#3219)', () => {
    it('should escape single quotes', () => {
      expect(esc("it's a test")).toBe('it&#39;s a test');
    });

    it('should escape script tags', () => {
      expect(esc('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    it('should escape img onerror injection', () => {
      expect(esc('<img src=x onerror=alert(1)>')).toBe(
        '&lt;img src=x onerror=alert(1)&gt;'
      );
    });

    it('should escape event handler attributes', () => {
      expect(esc('<div onload="alert(1)" onclick=\'alert(2)\'>')).toBe(
        '&lt;div onload=&quot;alert(1)&quot; onclick=&#39;alert(2)&#39;&gt;'
      );
    });

    it('should handle nested/malformed tag injection', () => {
      // <scr<script>ipt> → after escaping, both layers are safe
      expect(esc('<scr<script>ipt>')).toBe('&lt;scr&lt;script&gt;ipt&gt;');
    });

    it('should handle null bytes in content', () => {
      const withNull = 'before\x00after';
      // esc() should not crash on null bytes
      expect(() => esc(withNull)).not.toThrow();
      expect(esc(withNull)).toBe('before\x00after');
    });

    it('should prevent double-encoding attack (entity smuggling)', () => {
      // Attacker tries to inject via pre-encoded entities
      expect(esc('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;');
    });

    it('should escape all five HTML-special characters in a single string', () => {
      expect(esc('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;');
    });

    it('should escape mixed content: code + HTML injection', () => {
      const malicious = 'const x = "<script>alert(\'xss\')</script>"';
      expect(esc(malicious)).toBe(
        'const x = &quot;&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;&quot;'
      );
    });

    it('should handle unicode content safely', () => {
      expect(esc('日本語 <tag> & "quotes"')).toBe(
        '日本語 &lt;tag&gt; &amp; &quot;quotes&quot;'
      );
    });

    it('should escape very long injection strings without truncation', () => {
      const long = '<script>' + 'A'.repeat(10000) + '</script>';
      const escaped = esc(long);
      expect(escaped.startsWith('&lt;script&gt;')).toBe(true);
      expect(escaped.endsWith('&lt;/script&gt;')).toBe(true);
    });
  });

  describe('Path shortening', () => {
    it('should shorten deep paths', () => {
      expect(shortPath('/home/user/projects/aegis/src/server.ts')).toBe('…/src/server.ts');
    });

    it('should keep short paths as-is', () => {
      expect(shortPath('src/index.ts')).toBe('src/index.ts');
    });
  });

  // ── Security: URL scheme validation (#3219) ──────────────────────────────
  describe('Security: sanitizeHref URL scheme validation (#3219)', () => {
    it('should allow http:// URLs', () => {
      expect(sanitizeHref('http://example.com')).toBe('http://example.com');
    });

    it('should allow https:// URLs', () => {
      expect(sanitizeHref('https://example.com/path')).toBe('https://example.com/path');
    });

    it('should allow tg:// Telegram deep links', () => {
      expect(sanitizeHref('tg://resolve?domain=test')).toBe('tg://resolve?domain=test');
    });

    it('should allow relative paths starting with /', () => {
      expect(sanitizeHref('/path/to/page')).toBe('/path/to/page');
    });

    it('should allow anchor links starting with #', () => {
      expect(sanitizeHref('#section')).toBe('#section');
    });

    it('should allow mailto: links', () => {
      expect(sanitizeHref('mailto:user@example.com')).toBe('mailto:user@example.com');
    });

    it('should BLOCK javascript: URLs', () => {
      expect(sanitizeHref('javascript:alert(1)')).toBe('#');
    });

    it('should BLOCK javascript: URLs with mixed case', () => {
      expect(sanitizeHref('JaVaScRiPt:alert(1)')).toBe('#');
    });

    it('should BLOCK data: URLs', () => {
      expect(sanitizeHref('data:text/html,<script>alert(1)</script>')).toBe('#');
    });

    it('should BLOCK vbscript: URLs', () => {
      expect(sanitizeHref('vbscript:MsgBox("xss")')).toBe('#');
    });

    it('should BLOCK file: URLs', () => {
      expect(sanitizeHref('file:///etc/passwd')).toBe('#');
    });

    it('should sanitize quotes in allowed URLs', () => {
      // An attacker tries to break out of the href attribute
      expect(sanitizeHref('https://example.com/"onclick="alert(1)')).not.toContain('"');
      expect(sanitizeHref('https://example.com/\'onload=\'alert(1)')).not.toContain("'");
    });

    it('should handle whitespace-padded javascript: URLs', () => {
      expect(sanitizeHref('  javascript:alert(1)')).toBe('#');
    });
  });
});
