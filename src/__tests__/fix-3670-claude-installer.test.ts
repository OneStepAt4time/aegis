/** aegis:allow-credential-scan */
/**
 * Issue #3670: Clean-env setup broken without claude CLI.
 *
 * Tests the claude-installer utility functions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Issue #3670: Claude installer utilities', () => {
  describe('hasAnthropicCredentials', () => {
    let originalApiKey: string | undefined;
    let originalAuthToken: string | undefined;

    beforeEach(() => {
      originalApiKey = process.env.ANTHROPIC_API_KEY;
      originalAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_AUTH_TOKEN;
    });

    afterEach(() => {
      if (originalApiKey !== undefined) process.env.ANTHROPIC_API_KEY = originalApiKey;
      else delete process.env.ANTHROPIC_API_KEY;
      if (originalAuthToken !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = originalAuthToken;
      else delete process.env.ANTHROPIC_AUTH_TOKEN;
    });

    it('returns false when no ANTHROPIC env vars set', async () => {
      const { hasAnthropicCredentials } = await import('../utils/claude-installer.js');
      expect(hasAnthropicCredentials()).toBe(false);
    });

    it('returns true when ANTHROPIC_API_KEY is set', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test-123';
      const { hasAnthropicCredentials } = await import('../utils/claude-installer.js');
      expect(hasAnthropicCredentials()).toBe(true);
    });

    it('returns true when ANTHROPIC_AUTH_TOKEN is set', async () => {
      process.env.ANTHROPIC_AUTH_TOKEN = 'tok-test-456';
      const { hasAnthropicCredentials } = await import('../utils/claude-installer.js');
      expect(hasAnthropicCredentials()).toBe(true);
    });

    it('returns true when both are set', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.ANTHROPIC_AUTH_TOKEN = 'tok-test';
      const { hasAnthropicCredentials } = await import('../utils/claude-installer.js');
      expect(hasAnthropicCredentials()).toBe(true);
    });
  });

  describe('checkClaudeInstalled', () => {
    it('returns installed: false when claude is not on PATH', async () => {
      const { checkClaudeInstalled } = await import('../utils/claude-installer.js');
      const result = await checkClaudeInstalled();
      expect(result).toHaveProperty('installed');
      expect(typeof result.installed).toBe('boolean');
      if (!result.installed) {
        expect(result.version).toBeUndefined();
        expect(result.path).toBeUndefined();
      }
    });

    it('returns installed: true with version when claude is on PATH', async () => {
      vi.resetModules();
      let callCount = 0;
      vi.doMock('node:child_process', () => ({
        execFile: (_cmd: string, _args: string[], _opts: any, cb: any) => {
          callCount++;
          if (callCount === 1) {
            cb(null, '/usr/local/bin/claude\n', '');
          } else {
            cb(null, 'Claude Code 1.0.50\n', '');
          }
        },
      }));

      const { checkClaudeInstalled } = await import('../utils/claude-installer.js');
      const result = await checkClaudeInstalled();
      expect(result.installed).toBe(true);
      expect(result.version).toBe('1.0.50');
      expect(result.path).toBe('/usr/local/bin/claude');
    });
  });

  describe('ensureClaudeInstalled', () => {
    it('returns ok:true, installed:true when claude is already installed', async () => {
      vi.resetModules();
      vi.doMock('node:child_process', () => ({
        execFile: (_cmd: string, _args: string[], _opts: any, cb: any) => {
          cb(null, '/usr/local/bin/claude\n', '');
        },
      }));

      const { ensureClaudeInstalled } = await import('../utils/claude-installer.js');
      const io = {
        stdin: process.stdin,
        stdout: { write: vi.fn() } as any,
        stderr: { write: vi.fn() } as any,
      };

      const result = await ensureClaudeInstalled([], io);
      expect(result.installed).toBe(true);
      expect(result.ok).toBe(true);
    });

    it('returns ok:true, skipped:true when ANTHROPIC_API_KEY is set but claude missing', async () => {
      vi.resetModules();
      const origKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-test-123';

      vi.doMock('node:child_process', () => ({
        execFile: (_cmd: string, _args: string[], _opts: any, cb: any) => {
          const err = new Error('not found') as any;
          err.code = 'ENOENT';
          cb(err, '', '');
        },
      }));

      const { ensureClaudeInstalled } = await import('../utils/claude-installer.js');
      const io = {
        stdin: process.stdin,
        stdout: { write: vi.fn() } as any,
        stderr: { write: vi.fn() } as any,
      };

      const result = await ensureClaudeInstalled([], io);
      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(true);

      if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey;
      else delete process.env.ANTHROPIC_API_KEY;
    });
  });
});
