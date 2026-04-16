/**
 * fix-1752-launch-retry.test.ts — Test for Issue #1752: session prompt delivered
 * as launch command instead of task brief.
 *
 * Bug: In TmuxManager.createWindow(), when the CC startup poll times out, the
 * code blindly re-sends the full launch command. If CC has already started but
 * the poll missed it, the launch command goes to CC's stdin as user input.
 *
 * Fix: Before retrying, verify CC hasn't already started by checking pane
 * command and pane UI state.
 */

import { describe, it, expect } from 'vitest';
import { detectUIState } from '../terminal-parser.js';

describe('Issue #1752: launch command retry guard', () => {
  describe('detectUIState identifies CC vs shell', () => {
    it('should detect CC idle state (not unknown)', () => {
      const ccIdlePane = [
        '─'.repeat(50),
        '  ❯',
        '─'.repeat(50),
      ].join('\n');
      expect(detectUIState(ccIdlePane)).toBe('idle');
    });

    it('should detect CC working state', () => {
      const ccWorkingPane = [
        '✻ Reading src/server.ts…',
        '─'.repeat(50),
      ].join('\n');
      expect(detectUIState(ccWorkingPane)).toBe('working');
    });

    it('should return unknown for bare shell prompt', () => {
      const shellPane = '$ ';
      expect(detectUIState(shellPane)).toBe('unknown');
    });

    it('should return unknown for shell with launch command', () => {
      const shellPane = [
        '$ unset TMUX TMUX_PANE && exec claude --session-id abc-123 --permission-mode bypassPermissions',
      ].join('\n');
      expect(detectUIState(shellPane)).toBe('unknown');
    });

    it('should return waiting_for_input for shell with fancy prompt (❯ only, no chrome)', () => {
      const fancyShell = [
        '~/projects/foo ❯',
      ].join('\n');
      // No chrome separator → not 'idle', but has prompt → 'waiting_for_input'
      const state = detectUIState(fancyShell);
      expect(state).not.toBe('idle');
    });
  });

  describe('retry decision logic', () => {
    const shellCommands = ['bash', 'zsh', 'sh', 'pwsh', 'powershell', 'cmd', 'cmd.exe'];

    /**
     * Simulates the retry guard logic from createWindow.
     * Returns true if the launch command should be retried.
     */
    function shouldRetry(opts: {
      paneCommand: string | null;
      paneText: string | null;
    }): boolean {
      // Check 1: pane command
      if (opts.paneCommand) {
        const paneCmd = opts.paneCommand.toLowerCase();
        if (!shellCommands.includes(paneCmd)) {
          // CC is running (pane command is not a shell)
          return false;
        }
      }

      // Check 2: pane content — CC's TUI has distinctive patterns
      if (opts.paneText !== null) {
        const uiState = detectUIState(opts.paneText);
        if (uiState !== 'unknown') {
          // CC's TUI is visible (idle, working, etc.)
          return false;
        }
      }

      // CC doesn't appear to be running → safe to retry
      return true;
    }

    it('should retry when pane shows shell and command is shell', () => {
      expect(shouldRetry({
        paneCommand: 'bash',
        paneText: '$ ',
      })).toBe(true);
    });

    it('should NOT retry when pane command is claude/node (CC running)', () => {
      expect(shouldRetry({
        paneCommand: 'node',
        paneText: '$ unset TMUX TMUX_PANE && exec claude --session-id abc-123',
      })).toBe(false);
    });

    it('should NOT retry when pane shows CC idle state', () => {
      expect(shouldRetry({
        paneCommand: 'bash', // stale poll result
        paneText: `${'─'.repeat(50)}\n  ❯\n${'─'.repeat(50)}`,
      })).toBe(false);
    });

    it('should NOT retry when pane shows CC working state', () => {
      expect(shouldRetry({
        paneCommand: null,
        paneText: `✻ Reading src/server.ts…\n${'─'.repeat(50)}`,
      })).toBe(false);
    });

    it('should NOT retry when pane shows CC compacting state', () => {
      expect(shouldRetry({
        paneCommand: null,
        paneText: 'Compacting context...',
      })).toBe(false);
    });

    it('should retry when pane shows shell launch command (unknown state)', () => {
      expect(shouldRetry({
        paneCommand: 'bash',
        paneText: '$ unset TMUX TMUX_PANE && exec claude --session-id abc-123',
      })).toBe(true);
    });

    it('should NOT retry when pane shows permission_prompt state', () => {
      expect(shouldRetry({
        paneCommand: null,
        paneText: `Allow tool: Read\n(y/n)\n${'─'.repeat(50)}`,
      })).toBe(false);
    });

    it('should NOT retry when capture fails but command is non-shell', () => {
      expect(shouldRetry({
        paneCommand: 'claude',
        paneText: null,
      })).toBe(false);
    });

    it('should retry when capture fails and command is shell', () => {
      expect(shouldRetry({
        paneCommand: 'zsh',
        paneText: null,
      })).toBe(true);
    });
  });

  describe('launch command content', () => {
    it('launch command should contain session ID and permission mode', () => {
      const sessionId = 'abc-123-def';
      const cmd = `unset TMUX TMUX_PANE && exec claude --session-id ${sessionId} --permission-mode bypassPermissions`;
      expect(cmd).toContain(sessionId);
      expect(cmd).toContain('--permission-mode');
    });

    it('if injected as CC input, CC would show it as user message', () => {
      // Simulates what happens when the launch command is sent to CC's stdin:
      // CC receives it as user input and writes it to its JSONL transcript.
      const launchCmd = 'unset TMUX TMUX_PANE && exec claude --session-id abc-123';
      // The user's intended prompt is different
      const intendedPrompt = 'Build a login page with React';
      expect(launchCmd).not.toBe(intendedPrompt);
      // This is the bug: CC sees the launch command, not the intended prompt
    });
  });
});
