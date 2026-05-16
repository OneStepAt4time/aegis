/**
 * __tests__/formatSessionName.test.ts
 */

import { describe, it, expect } from 'vitest';
import { formatSessionName, getFullSessionName } from '../formatSessionName';

describe('formatSessionName', () => {
  it('returns fallback for null', () => {
    expect(formatSessionName(null)).toBe('Untitled Session');
  });

  it('returns fallback for undefined', () => {
    expect(formatSessionName(undefined)).toBe('Untitled Session');
  });

  it('returns fallback for empty string', () => {
    expect(formatSessionName('')).toBe('Untitled Session');
  });

  it('strips cc- prefix', () => {
    expect(formatSessionName('cc-say-pong')).toBe('Say Pong');
  });

  it('replaces dashes with spaces', () => {
    expect(formatSessionName('fix-the-login-bug')).toBe('Fix The Login Bug');
  });

  it('replaces underscores with spaces', () => {
    expect(formatSessionName('fix_the_login_bug')).toBe('Fix The Login Bug');
  });

  it('collapses multiple dashes into single space', () => {
    expect(formatSessionName('cc-say-pong--nothing-else')).toBe('Say Pong Nothing Else');
  });

  it('title cases the result', () => {
    expect(formatSessionName('cc-summarize-this-folder')).toBe('Summarize This Folder');
  });

  it('truncates long names with ellipsis', () => {
    const long = 'cc-implement-a-comprehensive-solution-for-handling-user-authentication-and-session-management-across-all-platforms';
    const result = formatSessionName(long);
    expect(result.length).toBeLessThanOrEqual(53);
    expect(result.endsWith('…')).toBe(true);
  });

  it('preserves names under max length', () => {
    expect(formatSessionName('cc-fix-the-bug')).toBe('Fix The Bug');
  });

  it('returns fallback for single-char names', () => {
    expect(formatSessionName('a')).toBe('Untitled Session');
  });

  it('uses custom fallback', () => {
    expect(formatSessionName(null, 'New Session')).toBe('New Session');
  });

  it('handles the exact example from the issue', () => {
    expect(formatSessionName('cc-say-pong--nothing-el')).toBe('Say Pong Nothing El');
  });

  it('handles mixed separators', () => {
    expect(formatSessionName('cc-fix_login-bug')).toBe('Fix Login Bug');
  });

  it('handles trailing dashes', () => {
    expect(formatSessionName('cc-do-stuff-')).toBe('Do Stuff');
  });
});

describe('getFullSessionName', () => {
  it('returns full name without truncation', () => {
    const long = 'cc-implement-a-comprehensive-solution-for-handling-user-authentication';
    const result = getFullSessionName(long);
    expect(result).not.toContain('…');
    expect(result.length).toBeGreaterThan(50);
  });

  it('returns fallback for null', () => {
    expect(getFullSessionName(null)).toBe('Untitled Session');
  });

  it('strips cc- prefix and replaces dashes', () => {
    expect(getFullSessionName('cc-say-pong')).toBe('say pong');
  });
});
