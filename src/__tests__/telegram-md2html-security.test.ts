/**
 * telegram-md2html-security.test.ts — Security tests for Issue #3173.
 *
 * Tests URI scheme allowlist (sanitizeHref), topic name sanitization
 * (sanitizeTopicName), and callback_data length guard (safeCallbackData).
 *
 * Helpers are imported from the production module to ensure tests validate
 * the actual implementation (not inline copies that could drift).
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeHref,
  sanitizeTopicName,
  safeCallbackData,
} from '../channels/telegram.js';

// ── Tests ──

describe('Security: md2html URI scheme allowlist (#3173)', () => {
  describe('sanitizeHref', () => {
    it('should allow http:// links', () => {
      expect(sanitizeHref('http://example.com')).toBe('http://example.com');
    });

    it('should allow https:// links', () => {
      expect(sanitizeHref('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
    });

    it('should allow mailto: links', () => {
      expect(sanitizeHref('mailto:user@example.com')).toBe('mailto:user@example.com');
    });

    it('should allow anchor links (#)', () => {
      expect(sanitizeHref('#section')).toBe('#section');
    });

    it('should allow relative links (/)', () => {
      expect(sanitizeHref('/path/to/page')).toBe('/path/to/page');
    });

    it('should allow tg:// deep links (Telegram native scheme)', () => {
      expect(sanitizeHref('tg://resolve?domain=attacker_bot')).toBe('tg://resolve?domain=attacker_bot'); // tg: is Telegram deep link, allowed
    });

    it('should block javascript: URIs', () => {
      expect(sanitizeHref('javascript:alert(1)')).toBe('#');
    });

    it('should block data: URIs', () => {
      expect(sanitizeHref('data:text/html,<script>alert(1)</script>')).toBe('#');
    });

    it('should block file: URIs', () => {
      expect(sanitizeHref('file:///etc/passwd')).toBe('#');
    });

    it('should block ftp:// URIs', () => {
      expect(sanitizeHref('ftp://evil.com/malware')).toBe('#');
    });

    it('should block viber:// URIs', () => {
      expect(sanitizeHref('viber://chat?number=123')).toBe('#');
    });

    it('should be case-insensitive for scheme check', () => {
      expect(sanitizeHref('TG://resolve?domain=bot')).toBe('TG://resolve?domain=bot'); // tg: allowed, case preserved in output
      expect(sanitizeHref('JavaScript:alert(1)')).toBe('#');
    });

    it('should handle empty href', () => {
      expect(sanitizeHref('')).toBe('#');
    });

    it('should handle whitespace-padded hrefs', () => {
      expect(sanitizeHref('  https://example.com  ')).toBe('https://example.com');
      expect(sanitizeHref('  tg://evil  ')).toBe('tg://evil'); // tg: allowed, trimmed
    });
  });
});

describe('Security: topic name sanitization (#3173)', () => {
  describe('sanitizeTopicName', () => {
    it('should preserve normal text', () => {
      expect(sanitizeTopicName('🤖 My Session')).toBe('🤖 My Session');
    });

    it('should strip null bytes', () => {
      expect(sanitizeTopicName('ses\u0000sion')).toBe('session');
    });

    it('should strip control characters', () => {
      expect(sanitizeTopicName('ses\u001Fsion')).toBe('session');
    });

    it('should strip RTL override (U+202E)', () => {
      expect(sanitizeTopicName('hello\u202Eworld')).toBe('helloworld');
    });

    it('should strip LRE/RLE/LRO/RLO/PDF', () => {
      const name = 'test\u202A\u202B\u202C\u202D\u202Ename';
      expect(sanitizeTopicName(name)).toBe('testname');
    });

    it('should collapse multiple whitespace', () => {
      expect(sanitizeTopicName('hello   world')).toBe('hello world');
    });

    it('should trim leading/trailing whitespace', () => {
      expect(sanitizeTopicName('  session  ')).toBe('session');
    });

    it('should truncate to 64 characters', () => {
      const long = '🤖 ' + 'x'.repeat(100);
      expect(sanitizeTopicName(long).length).toBeLessThanOrEqual(64);
    });

    it('should handle empty string', () => {
      expect(sanitizeTopicName('')).toBe('');
    });

    it('should handle string that is only control chars', () => {
      expect(sanitizeTopicName('\u0000\u0001\u001F')).toBe('');
    });
  });
});

describe('Security: callback_data length guard (#3173)', () => {
  describe('safeCallbackData', () => {
    it('should pass through short data unchanged', () => {
      const sid = '12345678-1234-1234-1234-123456789012';
      expect(safeCallbackData(`perm_approve:${sid}`)).toBe(`perm_approve:${sid}`);
    });

    it('should truncate long option values', () => {
      const sid = '12345678-1234-1234-1234-123456789012';
      const longValue = 'a'.repeat(100);
      const result = safeCallbackData(`cb_option:${sid}:${longValue}`);
      expect(Buffer.byteLength(result, 'utf-8')).toBeLessThanOrEqual(64);
    });

    it('should preserve prefix when truncating', () => {
      const sid = '12345678-1234-1234-1234-123456789012';
      const longValue = 'a'.repeat(100);
      const result = safeCallbackData(`cb_option:${sid}:${longValue}`);
      expect(result).toMatch(/^cb_option:/);
    });

    it('should handle exactly 64-byte data', () => {
      const data = 'x'.repeat(64);
      expect(safeCallbackData(data)).toBe(data);
    });

    it('should handle 65-byte data', () => {
      const data = 'x'.repeat(65);
      const result = safeCallbackData(data);
      expect(Buffer.byteLength(result, 'utf-8')).toBeLessThanOrEqual(64);
    });

    it('should handle multi-byte UTF-8 characters', () => {
      const sid = '12345678-1234-1234-1234-123456789012';
      const emojiValue = '🎉'.repeat(30); // each emoji is 4 bytes
      const result = safeCallbackData(`cb_option:${sid}:${emojiValue}`);
      expect(Buffer.byteLength(result, 'utf-8')).toBeLessThanOrEqual(64);
    });
  });
});
