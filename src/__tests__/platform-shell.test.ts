/**
 * platform-shell.test.ts — Tests for src/platform/shell.ts
 *
 * Issue #1694 / ARC-1: Platform abstraction layer.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  shellEscape,
  powerShellSingleQuote,
  quoteShellArg,
  buildClaudeLaunchCommand,
  isPidAlive,
} from '../platform/shell.js';

describe('platform/shell', () => {
  describe('shellEscape', () => {
    it('wraps value in single quotes', () => {
      expect(shellEscape('hello')).toBe("'hello'");
    });

    it('escapes embedded single quotes', () => {
      expect(shellEscape("it's")).toBe("'it'\\''s'");
    });

    it('handles empty string', () => {
      expect(shellEscape('')).toBe("''");
    });
  });

  describe('powerShellSingleQuote', () => {
    it('wraps value in single quotes', () => {
      expect(powerShellSingleQuote('hello')).toBe("'hello'");
    });

    it('doubles embedded single quotes', () => {
      expect(powerShellSingleQuote("it's")).toBe("'it''s'");
    });

    it('handles empty string', () => {
      expect(powerShellSingleQuote('')).toBe("''");
    });
  });

  describe('quoteShellArg', () => {
    it('uses shellEscape on non-win32', () => {
      expect(quoteShellArg("it's", 'linux')).toBe("'it'\\''s'");
    });

    it('uses powerShellSingleQuote on win32', () => {
      expect(quoteShellArg("it's", 'win32')).toBe("'it''s'");
    });
  });

  describe('buildClaudeLaunchCommand', () => {
    it('wraps with unset on POSIX', () => {
      const result = buildClaudeLaunchCommand('claude --flag', 'linux');
      expect(result).toContain('unset TMUX TMUX_PANE');
      expect(result).toContain('exec claude --flag');
    });

    it('wraps with Remove-Item on win32', () => {
      const result = buildClaudeLaunchCommand('claude --flag', 'win32');
      expect(result).toContain('Remove-Item Env:TMUX');
      expect(result).toContain('claude --flag');
    });
  });

  describe('isPidAlive', () => {
    it('returns true for current process PID', () => {
      expect(isPidAlive(process.pid)).toBe(true);
    });

    it('returns false for non-existent PID', () => {
      // Use a very high PID that almost certainly doesn't exist
      expect(isPidAlive(999999999)).toBe(false);
    });

    it('accepts platform parameter for testability', () => {
      // Should still work — just changes internal branch logic
      expect(isPidAlive(process.pid, 'win32')).toBe(true);
      expect(isPidAlive(process.pid, 'linux')).toBe(true);
    });
  });
});
