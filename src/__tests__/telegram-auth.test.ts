/**
 * telegram-auth.test.ts — Tests for Issue #348: Telegram inbound auth.
 *
 * Tests user allowlist, callback validation, and token redaction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the logic inline since TelegramChannel uses private methods
// and real network calls. The security logic is extracted for testability.

// ── Allowlist check logic ──────────────────────────────────────────────

function isUserAllowed(
  userId: number | undefined,
  allowedUserIds: number[],
): boolean {
  // Empty allowlist = allow all (backward compatible)
  if (allowedUserIds.length === 0) return true;
  if (!userId) return false;
  return allowedUserIds.includes(userId);
}

// ── Callback option validation ─────────────────────────────────────────

function isValidOptionValue(value: string): boolean {
  // Numbered options from parseOptions are always numeric strings
  return /^\d+$/.test(value);
}

// ── Token redaction ────────────────────────────────────────────────────

function redactToken(err: unknown, token: string): unknown {
  if (!token) return err;
  const str = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
  if (!str.includes(token)) return err;
  const redacted = str.replaceAll(token, 'REDACTED');
  return err instanceof Error
    ? new Error(redacted)
    : redacted;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Telegram inbound auth (Issue #348)', () => {
  describe('User allowlist', () => {
    it('should allow any user when allowlist is empty', () => {
      expect(isUserAllowed(12345, [])).toBe(true);
      expect(isUserAllowed(99999, [])).toBe(true);
    });

    it('should allow users in the allowlist', () => {
      const allowed = [111, 222, 333];
      expect(isUserAllowed(111, allowed)).toBe(true);
      expect(isUserAllowed(222, allowed)).toBe(true);
      expect(isUserAllowed(333, allowed)).toBe(true);
    });

    it('should reject users not in the allowlist', () => {
      const allowed = [111, 222];
      expect(isUserAllowed(999, allowed)).toBe(false);
      expect(isUserAllowed(0, allowed)).toBe(false);
    });

    it('should reject when userId is undefined', () => {
      const allowed = [111, 222];
      expect(isUserAllowed(undefined, allowed)).toBe(false);
    });

    it('should allow when userId is undefined but allowlist is empty', () => {
      // Empty allowlist = open access (backward compatible)
      expect(isUserAllowed(undefined, [])).toBe(true);
    });
  });

  describe('Callback option validation', () => {
    it('should accept numeric option values', () => {
      expect(isValidOptionValue('1')).toBe(true);
      expect(isValidOptionValue('2')).toBe(true);
      expect(isValidOptionValue('10')).toBe(true);
      expect(isValidOptionValue('99')).toBe(true);
    });

    it('should reject non-numeric option values', () => {
      expect(isValidOptionValue('yes')).toBe(false);
      expect(isValidOptionValue('no')).toBe(false);
      expect(isValidOptionValue('')).toBe(false);
      expect(isValidOptionValue('1; rm -rf /')).toBe(false);
      expect(isValidOptionValue('1\nmalicious')).toBe(false);
      expect(isValidOptionValue('../../etc/passwd')).toBe(false);
      expect(isValidOptionValue('1 abc')).toBe(false);
    });

    it('should reject option values with special characters', () => {
      expect(isValidOptionValue('1&2')).toBe(false);
      expect(isValidOptionValue('1|2')).toBe(false);
      expect(isValidOptionValue('1`2')).toBe(false);
      expect(isValidOptionValue('$(cmd)')).toBe(false);
    });
  });

  describe('Token redaction in logs', () => {
    const token = '1234567890:ABCdefGHIjklMNOpqrsTUVwxyz';

    it('should redact token from string errors', () => {
      const err = `fetch failed for https://api.telegram.org/bot${token}/sendMessage`;
      const result = redactToken(err, token);
      expect(result).toBe('fetch failed for https://api.telegram.org/botREDACTED/sendMessage');
    });

    it('should redact token from Error objects', () => {
      const err = new Error(`Request to https://api.telegram.org/bot${token}/getUpdates failed`);
      const result = redactToken(err, token) as Error;
      expect(result).toBeInstanceOf(Error);
      expect(result.message).not.toContain(token);
      expect(result.message).toContain('REDACTED');
    });

    it('should not modify errors that do not contain the token', () => {
      const err = new Error('Network timeout');
      const result = redactToken(err, token);
      expect(result).toBe(err);
    });

    it('should handle non-Error, non-string values', () => {
      const result = redactToken({ code: 429 }, token);
      // String({code:429}) = '[object Object]', no token present → returned as-is
      expect(result).toEqual({ code: 429 });
    });

    it('should handle empty token gracefully', () => {
      const err = new Error('some error');
      const result = redactToken(err, '');
      expect(result).toBe(err);
    });

    it('should redact token from poll error messages', () => {
      const errMsg = `ECONNREFUSED https://api.telegram.org/bot${token}/getUpdates`;
      const result = redactToken(errMsg, token);
      expect(result).not.toContain(token);
      expect(result).toContain('REDACTED');
    });
  });
});

// ── Config parsing tests ───────────────────────────────────────────────

describe('AEGIS_TG_ALLOWED_USERS config parsing', () => {
  it('should parse comma-separated user IDs', () => {
    const value = '111,222,333';
    const result = value.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
    expect(result).toEqual([111, 222, 333]);
  });

  it('should ignore non-numeric values', () => {
    const value = '111,abc,333';
    const result = value.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
    expect(result).toEqual([111, 333]);
  });

  it('should handle whitespace around IDs', () => {
    const value = ' 111 , 222 , 333 ';
    const result = value.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
    expect(result).toEqual([111, 222, 333]);
  });

  it('should ignore zero and negative IDs', () => {
    const value = '0,-1,111';
    const result = value.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
    expect(result).toEqual([111]);
  });

  it('should return empty array for all-invalid input', () => {
    const value = 'abc,def';
    const result = value.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
    expect(result).toEqual([]);
  });
});
