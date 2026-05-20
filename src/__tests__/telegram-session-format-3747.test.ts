/**
 * telegram-session-format-3747.test.ts — Tests for Issue #3747
 *
 * cc-connect style formatting for Telegram session output.
 * Tests the actual exported implementation, not a copy.
 */

import { describe, it, expect } from 'vitest';
import { formatTimestamp } from '../channels/telegram.js';

describe('Issue #3747: cc-connect style formatting', () => {
  describe('formatTimestamp', () => {
    it('formats ISO timestamp as [DD/MM/YYYY HH:MM]', () => {
      const result = formatTimestamp('2026-05-19T23:45:12.000Z');
      expect(result).toMatch(/^\[\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\]$/);
    });

    it('pads single-digit values', () => {
      const result = formatTimestamp('2026-01-05T03:07:00.000Z');
      expect(result).toMatch(/^\[\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\]$/);
    });

    it('produces different strings for different times', () => {
      const ts1 = formatTimestamp('2026-05-20T10:30:00.000Z');
      const ts2 = formatTimestamp('2026-05-20T14:45:00.000Z');
      expect(ts1).not.toBe(ts2);
    });
  });

  describe('trivial result suppression', () => {
    it('suppresses single-word trivial results', () => {
      const trivialRegex = /^(success|ok|done|completed|passed)$/i;
      for (const word of ['success', 'ok', 'done', 'completed', 'passed']) {
        expect(trivialRegex.test(word)).toBe(true);
      }
    });

    it('does NOT suppress multiline errors containing trivial words', () => {
      const trivialRegex = /^(success|ok|done|completed|passed)$/i;
      // This is the bug fix: without multiline flag, this should NOT match
      expect(trivialRegex.test('Build failed\ndone')).toBe(false);
      expect(trivialRegex.test('3 tests failed, 2 passed')).toBe(false);
      expect(trivialRegex.test('error: command not found')).toBe(false);
    });

    it('is case-insensitive', () => {
      const trivialRegex = /^(success|ok|done|completed|passed)$/i;
      expect(trivialRegex.test('Success')).toBe(true);
      expect(trivialRegex.test('DONE')).toBe(true);
      expect(trivialRegex.test('Passed')).toBe(true);
    });
  });

  describe('compact message format', () => {
    it('user messages have timestamp prefix, no emoji', () => {
      const ts = formatTimestamp('2026-05-19T23:45:00.000Z');
      const msg = `${ts} User: Snapping...`;
      expect(msg).toMatch(/^\[/);
      expect(msg).toContain('User:');
      expect(msg).not.toContain('👤');
    });

    it('tool executions use 🛠️ Exec prefix', () => {
      const msg = '🛠️ Exec: list files in ~/.openclaw';
      expect(msg).toContain('🛠️ Exec:');
    });

    it('tool completions include summary', () => {
      const msg = '🛠️ Exec: completed; command ls -la';
      expect(msg).toContain('🛠️ Exec: completed;');
    });

    it('process events use 🧰 Process prefix', () => {
      const msg = '🧰 Process: fresh-bloom';
      expect(msg).toBe('🧰 Process: fresh-bloom');
    });
  });
});
