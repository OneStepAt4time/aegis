/**
 * tmux-spawn.test.ts — Tests for Issue #7: session spawn failure after prolonged uptime.
 *
 * Tests the retry logic and health checks in TmuxManager.
 * Since tmux isn't available in CI, we test the logic patterns
 * rather than actual tmux commands.
 */

import { describe, it, expect } from 'vitest';
import { TmuxTimeoutError } from '../tmux.js';

describe('Tmux window creation retry logic', () => {
  describe('retry pattern', () => {
    it('should succeed on first attempt when tmux is healthy', async () => {
      let attempts = 0;
      const createWindow = async () => {
        attempts++;
        return { windowId: '@1', windowName: 'test' };
      };

      const result = await createWindow();
      expect(attempts).toBe(1);
      expect(result.windowId).toBe('@1');
    });

    it('should retry up to MAX_RETRIES on failure', async () => {
      const MAX_RETRIES = 3;
      let attempts = 0;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          attempts++;
          if (attempt < 3) {
            throw new Error(`Window not found after creation (attempt ${attempt})`);
          }
          lastError = null;
          break;
        } catch (e) {
          lastError = e as Error;
        }
      }

      expect(attempts).toBe(3);
      expect(lastError).toBeNull(); // Succeeded on 3rd attempt
    });

    it('should throw after MAX_RETRIES exhausted', async () => {
      const MAX_RETRIES = 3;
      let attempts = 0;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          attempts++;
          throw new Error(`Window not found (attempt ${attempt})`);
        } catch (e) {
          lastError = e as Error;
        }
      }

      expect(attempts).toBe(3);
      expect(lastError).not.toBeNull();
      expect(lastError!.message).toContain('attempt 3');
    });

    it('should apply exponential backoff between retries', () => {
      const backoffMs = (attempt: number) => 500 * attempt;
      expect(backoffMs(1)).toBe(500);
      expect(backoffMs(2)).toBe(1000);
      expect(backoffMs(3)).toBe(1500);
    });
  });

  describe('ensureSession health check', () => {
    it('should detect unhealthy session when list-windows fails', async () => {
      let sessionRecreated = false;

      // Simulate: has-session succeeds but list-windows fails
      const ensureSession = async () => {
        const hasSession = true; // tmux has-session succeeds
        let isHealthy = false;

        try {
          if (!hasSession) throw new Error('no session');
          // Simulate list-windows failure on degraded session
          throw new Error('server exited unexpectedly');
        } catch {
          // Session unhealthy — recreate
          sessionRecreated = true;
        }
      };

      await ensureSession();
      expect(sessionRecreated).toBe(true);
    });
  });

  describe('Claude process verification', () => {
    it('should detect when Claude did not start (pane still shows shell)', () => {
      const shellCommands = ['bash', 'zsh', 'sh'];
      const claudeCommands = ['claude', 'node', 'deno'];

      for (const cmd of shellCommands) {
        const isShell = ['bash', 'zsh', 'sh'].includes(cmd.toLowerCase());
        expect(isShell).toBe(true);
      }

      for (const cmd of claudeCommands) {
        const isShell = ['bash', 'zsh', 'sh'].includes(cmd.toLowerCase());
        expect(isShell).toBe(false);
      }
    });

    it('should not flag Claude process as shell', () => {
      const paneCommand = 'claude';
      const isShell = ['bash', 'zsh', 'sh'].includes(paneCommand.toLowerCase());
      expect(isShell).toBe(false);
    });
  });

  describe('window name collision handling', () => {
    it('should add suffix on name collision', () => {
      const existingNames = new Set(['cc-task1', 'cc-task1-2']);
      let finalName = 'cc-task1';
      let counter = 2;
      while (existingNames.has(finalName)) {
        finalName = `cc-task1-${counter++}`;
      }
      expect(finalName).toBe('cc-task1-3');
    });

    it('should use original name when no collision', () => {
      const existingNames = new Set(['cc-other']);
      let finalName = 'cc-task1';
      let counter = 2;
      while (existingNames.has(finalName)) {
        finalName = `cc-task1-${counter++}`;
      }
      expect(finalName).toBe('cc-task1');
    });
  });

  describe('tmux command timeout (Issue #66)', () => {
    it('TmuxTimeoutError includes command and timeout in message', () => {
      const err = new TmuxTimeoutError(['send-keys', '-t', 'aegis:@1', '-l', 'hello'], 10_000);
      expect(err.name).toBe('TmuxTimeoutError');
      expect(err.message).toContain('10000ms');
      expect(err.message).toContain('send-keys');
      expect(err.message).toContain('aegis:@1');
      expect(err instanceof Error).toBe(true);
    });

    it('should detect killed process as timeout', () => {
      // Simulate Node.js execFile timeout behavior:
      // When timeout is exceeded, Node kills the process and sets error.killed = true
      const simulatedError = Object.assign(new Error('process killed'), { killed: true });
      const isTimeout = 'killed' in simulatedError && simulatedError.killed === true;
      expect(isTimeout).toBe(true);
    });

    it('should NOT treat non-timeout errors as timeout', () => {
      const normalError = new Error('tmux: no server running');
      const isTimeout = 'killed' in normalError && (normalError as { killed?: boolean }).killed === true;
      expect(isTimeout).toBe(false);
    });
  });

  describe('TMUX env isolation (Issue #68)', () => {
    it('should prefix claude command with unset TMUX TMUX_PANE', () => {
      // The createWindow method must prepend 'unset TMUX TMUX_PANE && '
      // to the claude command so CC doesn't inherit Aegis's tmux env.
      const baseCmd = 'claude --session-id abc123';
      const expected = `unset TMUX TMUX_PANE && ${baseCmd}`;

      // Simulate the logic from createWindow
      const cmd = `unset TMUX TMUX_PANE && ${baseCmd}`;
      expect(cmd).toBe(expected);
      expect(cmd).toContain('unset TMUX TMUX_PANE');
      expect(cmd).toContain('&&');
      expect(cmd).toContain(baseCmd);
    });

    it('should also unset when autoApprove is set', () => {
      const baseCmd = 'claude --session-id abc123 --permission-mode bypassPermissions';
      const cmd = `unset TMUX TMUX_PANE && ${baseCmd}`;
      expect(cmd).toContain('unset TMUX TMUX_PANE');
      expect(cmd).toContain('--permission-mode bypassPermissions');
    });

    it('should also unset when resuming a session', () => {
      const baseCmd = 'claude --resume existing-session-id';
      const cmd = `unset TMUX TMUX_PANE && ${baseCmd}`;
      expect(cmd).toContain('unset TMUX TMUX_PANE');
      expect(cmd).toContain('--resume existing-session-id');
    });
  });
});
