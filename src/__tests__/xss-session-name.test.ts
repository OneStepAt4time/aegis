/**
 * xss-session-name.test.ts — Session name sanitization (Issue #2064).
 *
 * Tests that sanitizeWindowName() strips shell metacharacters that crash tmux.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeWindowName } from '../validation.js';

describe('sanitizeWindowName', () => {
  it('passes through alphanumeric, hyphen, underscore', () => {
    expect(sanitizeWindowName('my-session')).toBe('my-session');
    expect(sanitizeWindowName('session_123')).toBe('session_123');
    expect(sanitizeWindowName('Session-ABC')).toBe('Session-ABC');
  });

  it('strips backticks', () => {
    expect(sanitizeWindowName('session`echo pwned`name')).toBe('sessionecho pwnedname');
  });

  it('strips dollar sign', () => {
    expect(sanitizeWindowName('session$HOME')).toBe('sessionHOME');
  });

  it('strips semicolon', () => {
    expect(sanitizeWindowName('session;rm -rf')).toBe('sessionrm -rf');
  });

  it('strips pipe', () => {
    expect(sanitizeWindowName('session|cat /etc/passwd')).toBe('sessioncat /etc/passwd');
  });

  it('strips ampersand', () => {
    expect(sanitizeWindowName('session&whoami')).toBe('sessionwhoami');
  });

  it('strips angle brackets', () => {
    expect(sanitizeWindowName('<script>alert(1)</script>')).toBe('scriptalert1/script');
  });

  it('strips parentheses', () => {
    expect(sanitizeWindowName('session(echo pwned)')).toBe('sessionecho pwned');
  });

  it('strips curly braces', () => {
    expect(sanitizeWindowName('session${HOME}')).toBe('sessionHOME');
  });

  it('strips square brackets', () => {
    expect(sanitizeWindowName('session[0]')).toBe('session0');
  });

  it('strips single and double quotes', () => {
    expect(sanitizeWindowName("session'name")).toBe('sessionname');
    expect(sanitizeWindowName('session"name')).toBe('sessionname');
  });

  it('strips backslash', () => {
    expect(sanitizeWindowName('session\\nname')).toBe('sessionnname');
  });

  it('strips control characters', () => {
    expect(sanitizeWindowName('session\x00\x07name')).toBe('sessionname');
    expect(sanitizeWindowName('session\x1Fname')).toBe('sessionname');
  });

  it('strips mixed XSS payload', () => {
    expect(sanitizeWindowName('<script>alert(1)</script>')).toBe('scriptalert1/script');
  });

  it('strips shell injection attempt', () => {
    expect(sanitizeWindowName('$(whoami)')).toBe('whoami');
    expect(sanitizeWindowName('`id`')).toBe('id');
  });

  it('handles empty string', () => {
    expect(sanitizeWindowName('')).toBe('');
  });

  it('preserves spaces (allowed in tmux names)', () => {
    expect(sanitizeWindowName('my session name')).toBe('my session name');
  });

  it('handles already-clean name unchanged', () => {
    expect(sanitizeWindowName('cc-abc123-def')).toBe('cc-abc123-def');
  });
});
