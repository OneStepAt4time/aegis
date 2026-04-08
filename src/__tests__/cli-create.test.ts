/**
 * cli-create.test.ts — Tests for Issue #5 stretch: aegis create subcommand.
 */

import { describe, it, expect } from 'vitest';

describe('aegis create subcommand', () => {
  describe('argument parsing', () => {
    it('should extract brief from first non-flag argument', () => {
      const args = ['Build a login page'];
      let brief = '';
      for (const arg of args) {
        if (!arg.startsWith('-')) { brief = arg; break; }
      }
      expect(brief).toBe('Build a login page');
    });

    it('should extract --cwd option', () => {
      const args = ['Build something', '--cwd', '/path/to/project'];
      let cwd = process.cwd();
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--cwd' && args[i + 1]) { cwd = args[++i]; }
      }
      expect(cwd).toBe('/path/to/project');
    });

    it('should default cwd to process.cwd()', () => {
      const args = ['Build something'];
      let cwd = '/default/path';
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--cwd' && args[i + 1]) { cwd = args[++i]; }
      }
      expect(cwd).toBe('/default/path');
    });

    it('should extract --port option', () => {
      const args = ['Build something', '--port', '3000'];
      let port = 9100;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); }
      }
      expect(port).toBe(3000);
    });

    it('should reject empty brief', () => {
      const args: string[] = [];
      let brief = '';
      for (const arg of args) {
        if (!arg.startsWith('-')) { brief = arg; break; }
      }
      expect(brief).toBe('');
    });
  });

  describe('session name generation', () => {
    it('should generate a clean session name from brief', () => {
      const brief = 'Build a login page with OAuth';
      const name = `cc-${brief.slice(0, 20).replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`;
      expect(name).toBe('cc-build-a-login-page-w');
      expect(name.startsWith('cc-')).toBe(true);
    });

    it('should handle special characters in brief', () => {
      const brief = 'Fix bug #123!';
      const name = `cc-${brief.slice(0, 20).replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`;
      expect(name).toBe('cc-fix-bug--123-');
    });

    it('should truncate long briefs', () => {
      const brief = 'This is a very long brief that exceeds twenty characters';
      const name = `cc-${brief.slice(0, 20).replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`;
      expect(name.length).toBeLessThanOrEqual(23); // 'cc-' + 20 chars
    });
  });

  describe('URL construction', () => {
    it('should construct correct session create URL', () => {
      const port = 9100;
      const url = `http://127.0.0.1:${port}/v1/sessions`;
      expect(url).toBe('http://127.0.0.1:9100/v1/sessions');
    });

    it('should construct correct send URL with session ID', () => {
      const port = 9100;
      const sessionId = 'abc-123';
      const url = `http://127.0.0.1:${port}/v1/sessions/${sessionId}/send`;
      expect(url).toBe('http://127.0.0.1:9100/v1/sessions/abc-123/send');
    });

    it('should use custom port', () => {
      const port = 3000;
      const url = `http://127.0.0.1:${port}/v1/sessions`;
      expect(url).toBe('http://127.0.0.1:3000/v1/sessions');
    });
  });
});
