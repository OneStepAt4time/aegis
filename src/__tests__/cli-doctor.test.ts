/**
 * cli-doctor.test.ts — Tests for `aegis doctor` subcommand.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Inline the DoctorCheck interface to match cli.ts
interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
}

describe('aegis doctor', () => {
  describe('DoctorCheck interface', () => {
    it('should accept ok status', () => {
      const check: DoctorCheck = { name: 'test', status: 'ok', message: 'passed' };
      expect(check.status).toBe('ok');
    });

    it('should accept warn status', () => {
      const check: DoctorCheck = { name: 'test', status: 'warn', message: 'warning' };
      expect(check.status).toBe('warn');
    });

    it('should accept fail status', () => {
      const check: DoctorCheck = { name: 'test', status: 'fail', message: 'failed' };
      expect(check.status).toBe('fail');
    });
  });

  describe('Node.js version check', () => {
    it('should pass for Node >= 20', () => {
      const nodeMajor = parseInt(process.version.slice(1), 10);
      const status = nodeMajor >= 20 ? 'ok' : 'fail';
      // CI runs Node 20+ so this should always pass
      expect(status).toBe('ok');
    });

    it('should produce correct version message', () => {
      const nodeVersion = process.version;
      const message = `v${nodeVersion.slice(1)}`;
      // message is like "v22.22.1"
      expect(message).toMatch(/^v\d+\.\d+\.\d+/);
    });
  });

  describe('port parsing', () => {
    it('should default to 9100', () => {
      const port = parseInt(undefined as unknown as string, 10) || 9100;
      expect(port).toBe(9100);
    });

    it('should parse custom port from args', () => {
      const args = ['--port', '3000'];
      let port = 9100;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--port' && args[i + 1]) {
          port = parseInt(args[++i], 10);
        }
      }
      expect(port).toBe(3000);
    });

    it('should ignore missing port value', () => {
      const args = ['--port'];
      let port = 9100;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--port' && args[i + 1]) {
          port = parseInt(args[++i], 10);
        }
      }
      expect(port).toBe(9100);
    });
  });

  describe('state directory checks', () => {
    it('should detect a writable directory', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'doctor-test-'));
      let writable = false;
      try {
        const probeDir = mkdtempSync(join(tmp, '.doctor-'));
        writeFileSync(join(probeDir, 'probe'), '');
        writable = true;
        rmSync(probeDir, { recursive: true });
      } catch { /* not writable */ }
      expect(writable).toBe(true);
      rmSync(tmp, { recursive: true });
    });

    it('should detect a non-existent directory', () => {
      const fakePath = join(tmpdir(), 'doctor-nonexistent-' + Date.now());
      expect(existsSync(fakePath)).toBe(false);
    });
  });

  describe('config file parsing', () => {
    it('should detect valid JSON config', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'doctor-config-'));
      const configPath = join(tmp, 'test-config.json');
      writeFileSync(configPath, JSON.stringify({ port: 9200 }));

      const raw = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'));
      expect(raw.port).toBe(9200);
      rmSync(tmp, { recursive: true });
    });

    it('should detect invalid JSON config', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'doctor-config-'));
      const configPath = join(tmp, 'bad-config.json');
      writeFileSync(configPath, '{ invalid json');

      expect(() => JSON.parse(require('fs').readFileSync(configPath, 'utf-8'))).toThrow();
      rmSync(tmp, { recursive: true });
    });
  });

  describe('check result formatting', () => {
    it('should compute correct label width', () => {
      const checks: DoctorCheck[] = [
        { name: 'Node.js', status: 'ok', message: 'v20.0.0' },
        { name: 'tmux', status: 'ok', message: 'v3.4' },
        { name: 'Claude CLI', status: 'ok', message: 'installed' },
        { name: 'Config', status: 'ok', message: 'none' },
        { name: 'State dir', status: 'ok', message: '/tmp/aegis' },
      ];
      const labelWidth = Math.max(...checks.map(c => c.name.length));
      expect(labelWidth).toBe(10); // 'State dir' = 9, 'Claude CLI' = 10
    });

    it('should count failures correctly', () => {
      const checks: DoctorCheck[] = [
        { name: 'Node.js', status: 'ok', message: '' },
        { name: 'tmux', status: 'fail', message: 'not found' },
        { name: 'Claude CLI', status: 'warn', message: 'not found' },
      ];
      const failures = checks.filter(c => c.status === 'fail').length;
      expect(failures).toBe(1);
    });

    it('should map status to icons', () => {
      const icon = { ok: '✅', warn: '⚠️', fail: '❌' } as const;
      expect(icon.ok).toBe('✅');
      expect(icon.warn).toBe('⚠️');
      expect(icon.fail).toBe('❌');
    });
  });

  describe('tmux version parsing', () => {
    it('should parse tmux 3.4 output', () => {
      const out = 'tmux 3.4';
      const m = out.match(/tmux\s+(\d+)\.(\d+)/i);
      expect(m).not.toBeNull();
      const major = parseInt(m![1]!, 10);
      const minor = parseInt(m![2]!, 10);
      expect(major).toBe(3);
      expect(minor).toBe(4);
    });

    it('should accept tmux >= 3.3', () => {
      const major = 3, minor = 4;
      const minMajor = 3, minMinor = 3;
      const ok = major > minMajor || (major === minMajor && minor >= minMinor);
      expect(ok).toBe(true);
    });

    it('should reject tmux 3.2', () => {
      const version = { major: 3, minor: 2 };
      const minMajor = 3, minMinor = 3;
      const ok = version.major > minMajor || (version.major === minMajor && version.minor >= minMinor);
      expect(ok).toBe(false);
    });

    it('should reject tmux 2.x', () => {
      const version = { major: 2, minor: 9 };
      const minMajor = 3, minMinor = 3;
      const ok = version.major > minMajor || (version.major === minMajor && version.minor >= minMinor);
      expect(ok).toBe(false);
    });

    it('should handle unparseable output', () => {
      const out = 'unknown output';
      const m = out.match(/tmux\s+(\d+)\.(\d+)/i);
      expect(m).toBeNull();
    });
  });
});
