/**
 * cli-subcommands-3499.test.ts — Tests for Issue #3499:
 * CLI subcommands: ag list, ag read, ag kill, ag status, ag tail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCli } from '../cli.js';

function mockIO() {
  return {
    stdin: { pipe: vi.fn() } as unknown as NodeJS.ReadableStream,
    stdout: { write: vi.fn() } as unknown as NodeJS.WritableStream,
    stderr: { write: vi.fn() } as unknown as NodeJS.WritableStream,
  };
}

function getStdout(io: ReturnType<typeof mockIO>): string {
  const write = io.stdout.write as unknown as ReturnType<typeof vi.fn>;
  return write.mock.calls.map((c: string[]) => c.join('')).join('');
}

function getStderr(io: ReturnType<typeof mockIO>): string {
  const write = io.stderr.write as unknown as ReturnType<typeof vi.fn>;
  return write.mock.calls.map((c: string[]) => c.join('')).join('');
}

describe('CLI subcommands (#3499)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ag read', () => {
    it('should error without session ID', async () => {
      const io = mockIO();
      const code = await runCli(['read'], io);
      expect(code).toBe(1);
      expect(getStderr(io)).toContain('Missing session ID');
    });
  });

  describe('ag kill', () => {
    it('should error without session ID', async () => {
      const io = mockIO();
      const code = await runCli(['kill'], io);
      expect(code).toBe(1);
      expect(getStderr(io)).toContain('Missing session ID');
    });
  });

  describe('ag tail', () => {
    it('should error without session ID', async () => {
      const io = mockIO();
      const code = await runCli(['tail'], io);
      expect(code).toBe(1);
      expect(getStderr(io)).toContain('Missing session ID');
    });
  });

  describe('ag status', () => {
    it('should not reject as unknown command', async () => {
      const io = mockIO();
      const code = await runCli(['status'], io);
      // Server may or may not be running — either way, not "Unknown command"
      const stderr = getStderr(io);
      expect(stderr).not.toContain('Unknown command: "status"');
      // If server is running, should succeed (0); if not, should fail (1)
      expect([0, 1]).toContain(code);
    });
  });

  describe('ag list', () => {
    it('should not reject as unknown command', async () => {
      const io = mockIO();
      const code = await runCli(['list'], io);
      const stderr = getStderr(io);
      expect(stderr).not.toContain('Unknown command: "list"');
      expect([0, 1]).toContain(code);
    });
  });

  describe('--help includes new subcommands', () => {
    it('should list all new subcommands in help output', async () => {
      const io = mockIO();
      await runCli(['--help'], io);
      const help = getStdout(io);
      expect(help).toContain('ag list');
      expect(help).toContain('ag read');
      expect(help).toContain('ag kill');
      expect(help).toContain('ag tail');
      expect(help).toContain('ag status');
    });
  });
});
