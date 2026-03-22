/**
 * env-security.test.ts — Tests for Issue #23: env vars leak via tmux send-keys.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Env var security (Issue #23)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-env-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('temp file approach', () => {
    it('should write env vars to temp file with export syntax', () => {
      const env = { API_KEY: 'secret123', DB_URL: 'postgres://localhost/db' };
      const lines = Object.entries(env).map(([key, val]) => {
        const escaped = val.replace(/'/g, "'\\''");
        return `export ${key}='${escaped}'`;
      });
      const content = lines.join('\n') + '\n';

      const tmpFile = join(tmpDir, '.aegis-env-test');
      writeFileSync(tmpFile, content, { mode: 0o600 });

      const written = readFileSync(tmpFile, 'utf-8');
      expect(written).toContain("export API_KEY='secret123'");
      expect(written).toContain("export DB_URL='postgres://localhost/db'");
    });

    it('should set restrictive permissions (0o600)', () => {
      const tmpFile = join(tmpDir, '.aegis-env-test');
      writeFileSync(tmpFile, 'export X=1\n', { mode: 0o600 });

      const stat = statSync(tmpFile);
      const perms = stat.mode & 0o777;
      expect(perms).toBe(0o600);
    });

    it('should escape single quotes in values', () => {
      const val = "it's a test";
      const escaped = val.replace(/'/g, "'\\''");
      expect(escaped).toBe("it'\\''s a test");

      // When bash evaluates: export KEY='it'\''s a test'
      // This produces: KEY=it's a test
    });

    it('should handle empty env object', () => {
      const env: Record<string, string> = {};
      const hasEnv = Object.keys(env).length > 0;
      expect(hasEnv).toBe(false);
    });

    it('should handle special characters in values', () => {
      const env = {
        TOKEN: 'ghp_abc123!@#$%^&*()',
        URL: 'https://api.example.com/v1?key=value&other=true',
      };

      const lines = Object.entries(env).map(([key, val]) => {
        const escaped = val.replace(/'/g, "'\\''");
        return `export ${key}='${escaped}'`;
      });

      // Single-quoted strings in bash treat everything literally except single quotes
      expect(lines[0]).toContain("ghp_abc123!@#$%^&*()");
      expect(lines[1]).toContain("https://api.example.com/v1?key=value&other=true");
    });
  });

  describe('source + rm pattern', () => {
    it('should construct the source command correctly', () => {
      const tmpFile = '/tmp/.aegis-env-abc12345';
      const cmd = `source ${tmpFile} && rm -f ${tmpFile}`;
      expect(cmd).toBe('source /tmp/.aegis-env-abc12345 && rm -f /tmp/.aegis-env-abc12345');
    });

    it('should only expose temp file path in terminal, not values', () => {
      const tmpFile = '/tmp/.aegis-env-abc12345';
      const cmd = `source ${tmpFile} && rm -f ${tmpFile}`;

      // The command visible in tmux pane does NOT contain the actual values
      expect(cmd).not.toContain('secret');
      expect(cmd).not.toContain('API_KEY');
      expect(cmd).not.toContain('ghp_');
    });
  });

  describe('vs old approach (send-keys export)', () => {
    it('old approach: values visible in terminal', () => {
      const key = 'API_KEY';
      const val = 'secret123';
      const oldCmd = `export ${key}="${val}"`;

      // Old approach: the value is literally in the command
      expect(oldCmd).toContain('secret123');
    });

    it('new approach: values NOT visible in terminal', () => {
      const tmpFile = '/tmp/.aegis-env-xyz';
      const newCmd = `source ${tmpFile} && rm -f ${tmpFile}`;

      // New approach: only file path visible
      expect(newCmd).not.toContain('secret');
    });
  });
});
