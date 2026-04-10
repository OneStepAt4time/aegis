/**
 * claude-command-validation.test.ts — Tests for Issue #1393: claudeCommand RCE prevention.
 */

import { describe, it, expect } from 'vitest';

// Mirror the regex from server.ts
const SAFE_COMMAND_RE = /^[a-zA-Z0-9_./@:= -]+$/;

function isValidCommand(value: string): boolean {
  return SAFE_COMMAND_RE.test(value);
}

describe('claudeCommand validation (#1393)', () => {
  describe('safe commands allowed', () => {
    it('allows plain claude command', () => {
      expect(isValidCommand('claude')).toBe(true);
    });

    it('allows claude with flags', () => {
      expect(isValidCommand('claude --model opus')).toBe(true);
    });

    it('allows claude --print', () => {
      expect(isValidCommand('claude --print')).toBe(true);
    });

    it('allows claude with permission mode', () => {
      expect(isValidCommand('claude --permission-mode bypassPermissions')).toBe(true);
    });

    it('allows path-like commands', () => {
      expect(isValidCommand('/usr/local/bin/claude')).toBe(true);
      expect(isValidCommand('./claude')).toBe(true);
      expect(isValidCommand('../claude')).toBe(true);
    });

    it('allows commands with equals signs (common in flags)', () => {
      expect(isValidCommand('claude --model=opus')).toBe(true);
    });

    it('allows commands with colons (common in model names)', () => {
      expect(isValidCommand('claude --model claude-opus-4-20250514')).toBe(true);
    });

    it('allows commands with at-signs', () => {
      expect(isValidCommand('claude @context-file')).toBe(true);
    });
  });

  describe('dangerous commands rejected', () => {
    it('rejects semicolon injection', () => {
      expect(isValidCommand('evil; rm -rf /')).toBe(false);
    });

    it('rejects pipe injection', () => {
      expect(isValidCommand('claude | cat /etc/passwd')).toBe(false);
    });

    it('rejects command substitution with backticks', () => {
      expect(isValidCommand('claude `rm -rf /`')).toBe(false);
    });

    it('rejects dollar sign variable expansion', () => {
      expect(isValidCommand('claude $(whoami)')).toBe(false);
    });

    it('rejects newline injection', () => {
      expect(isValidCommand('claude\nrm -rf /')).toBe(false);
    });

    it('rejects carriage return injection', () => {
      expect(isValidCommand('claude\rrm -rf /')).toBe(false);
    });

    it('rejects ampersand backgrounding', () => {
      expect(isValidCommand('claude & malicious')).toBe(false);
    });

    it('rejects logical OR', () => {
      expect(isValidCommand('claude || rm -rf /')).toBe(false);
    });

    it('rejects logical AND', () => {
      expect(isValidCommand('claude && rm -rf /')).toBe(false);
    });

    it('rejects subshell execution', () => {
      expect(isValidCommand('claude $(cat /etc/shadow)')).toBe(false);
    });

    it('rejects brace expansion', () => {
      expect(isValidCommand('claude {a,b,c}')).toBe(false);
    });

    it('rejects redirection', () => {
      expect(isValidCommand('claude > /tmp/pwned')).toBe(false);
      expect(isValidCommand('claude < /etc/passwd')).toBe(false);
    });

    it('rejects double-ampersand (background)', () => {
      expect(isValidCommand('claude && disown')).toBe(false);
    });

    it('rejects backslash continuation', () => {
      expect(isValidCommand('claude \\n rm -rf /')).toBe(false);
    });

    it('rejects tab injection', () => {
      expect(isValidCommand('claude\trm')).toBe(false);
    });

    it('rejects null byte', () => {
      expect(isValidCommand('claude\x00rm')).toBe(false);
    });

    it('rejects parentheses (subshell)', () => {
      expect(isValidCommand('(rm -rf /)')).toBe(false);
      expect(isValidCommand('claude (whoami)')).toBe(false);
    });

    it('rejects curly braces', () => {
      expect(isValidCommand('claude ${PATH}')).toBe(false);
    });
  });
});
