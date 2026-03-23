/**
 * dynamic-buttons.test.ts — Tests for parseOptions() and dynamic button generation.
 */

import { describe, it, expect } from 'vitest';

// Re-implement parseOptions for testing (mirrors telegram.ts)
function parseOptions(text: string): Array<{ label: string; value: string }> | null {
  const numberedRegex = /^\s*(\d+)\.\s+(.+)$/gm;
  const numbered: Array<{ label: string; value: string }> = [];
  let m;
  while ((m = numberedRegex.exec(text)) !== null) {
    const num = m[1];
    let label = m[2].trim();
    if (label.length > 30) label = label.slice(0, 28) + '…';
    numbered.push({ label: `${num}. ${label}`, value: num });
  }
  if (numbered.length >= 2) return numbered.slice(0, 4);

  if (/\(?\s*[yY]\s*\/\s*[nN]\s*\)?/.test(text)) {
    return [{ label: '✅ Yes', value: 'y' }, { label: '❌ No', value: 'n' }];
  }

  if (/\b[Yy]es\b.*\b[Nn]o\b/.test(text)) {
    return [{ label: '✅ Yes', value: 'yes' }, { label: '❌ No', value: 'no' }];
  }

  if (/\b[Aa]llow\b/.test(text) || /\b[Dd]eny\b/.test(text)) {
    return [{ label: '✅ Allow', value: 'allow' }, { label: '❌ Deny', value: 'deny' }];
  }

  return null;
}

describe('parseOptions', () => {
  describe('Numbered options', () => {
    it('parses 3 numbered options from CC permission', () => {
      const text = `Do you want to create add-version-endpoint.md?\n1. Yes\n2. Yes, and allow Claude to edit its own settings\n3. No`;
      const opts = parseOptions(text);
      expect(opts).toHaveLength(3);
      expect(opts![0]).toEqual({ label: '1. Yes', value: '1' });
      expect(opts![1]).toEqual({ label: '2. Yes, and allow Claude to edi…', value: '2' });
      expect(opts![2]).toEqual({ label: '3. No', value: '3' });
    });

    it('parses 2 numbered options', () => {
      const text = 'Which approach?\n1. Incremental refactor\n2. Full rewrite';
      const opts = parseOptions(text);
      expect(opts).toHaveLength(2);
      expect(opts![0].value).toBe('1');
      expect(opts![1].value).toBe('2');
    });

    it('returns null for single numbered option (need ≥2)', () => {
      const text = '1. Only one option';
      const opts = parseOptions(text);
      expect(opts).toBeNull();
    });

    it('caps at 4 options', () => {
      const text = '1. A\n2. B\n3. C\n4. D\n5. E';
      const opts = parseOptions(text);
      expect(opts).toHaveLength(4);
    });

    it('truncates long option labels to 30 chars', () => {
      const text = `Choose:\n1. This is a very long option label that should be truncated\n2. Short`;
      const opts = parseOptions(text);
      expect(opts![0].label.length).toBeLessThanOrEqual(32);
      expect(opts![0].label).toContain('…');
    });
  });

  describe('y/n shorthand', () => {
    it('parses (y/n)', () => {
      const opts = parseOptions('Allow? (y/n)');
      expect(opts).toEqual([{ label: '✅ Yes', value: 'y' }, { label: '❌ No', value: 'n' }]);
    });

    it('parses y/n without parens', () => {
      const opts = parseOptions('Continue? y/n');
      expect(opts).toHaveLength(2);
    });

    it('parses Y/N uppercase', () => {
      const opts = parseOptions('Confirm Y/N');
      expect(opts).toHaveLength(2);
    });
  });

  describe('Yes/No explicit', () => {
    it('parses Yes and No in text', () => {
      const opts = parseOptions('Do you want to proceed? Yes or No?');
      expect(opts).toEqual([{ label: '✅ Yes', value: 'yes' }, { label: '❌ No', value: 'no' }]);
    });
  });

  describe('Allow/Deny', () => {
    it('parses Allow/Deny', () => {
      const opts = parseOptions('Allow write access to this file? Deny to block.');
      expect(opts).toEqual([{ label: '✅ Allow', value: 'allow' }, { label: '❌ Deny', value: 'deny' }]);
    });
  });

  describe('Fallback (null)', () => {
    it('returns null for generic text with no options', () => {
      const opts = parseOptions('This is a regular message with no options.');
      expect(opts).toBeNull();
    });

    it('returns null for empty string', () => {
      const opts = parseOptions('');
      expect(opts).toBeNull();
    });
  });
});
