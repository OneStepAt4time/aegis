/**
 * cli-unknown-command-3079.test.ts — Tests for Issue #3079:
 * Unknown CLI commands should error instead of silently creating sessions.
 *
 * Updated for #3499: `status` and `list` are now valid subcommands.
 */

import { describe, it, expect, vi } from 'vitest';
import { runCli } from '../cli.js';

function mockIO() {
  return {
    stdin: { pipe: vi.fn() } as unknown as NodeJS.ReadableStream,
    stdout: { write: vi.fn() } as unknown as NodeJS.WritableStream,
    stderr: { write: vi.fn() } as unknown as NodeJS.WritableStream,
  };
}

describe('CLI unknown command rejection (#3079)', () => {
  it('should reject unknown single-word commands', async () => {
    const io = mockIO();
    const code = await runCli(['health'], io);
    expect(code).toBe(1);
    const stderrWrite = io.stderr.write as unknown as ReturnType<typeof vi.fn>;
    const stderr = stderrWrite.mock.calls.map((c: string[]) => c.join('')).join('');
    expect(stderr).toContain('Unknown command: "health"');
  });

  it('should reject "ag version"', async () => {
    const io = mockIO();
    const code = await runCli(['version'], io);
    expect(code).toBe(1);
  });

  it('should reject "ag sessions"', async () => {
    const io = mockIO();
    const code = await runCli(['sessions'], io);
    expect(code).toBe(1);
  });

  it('should reject "ag auth"', async () => {
    const io = mockIO();
    const code = await runCli(['auth'], io);
    expect(code).toBe(1);
  });

  it('should accept --help flag without error', async () => {
    const io = mockIO();
    const code = await runCli(['--help'], io);
    expect(code).toBe(0);
  });

  it('should accept --version flag without error', async () => {
    const io = mockIO();
    const code = await runCli(['--version'], io);
    expect(code).toBe(0);
  });

  // #3499: status and list are now valid subcommands
  it('should route "ag status" to handleStatus (not reject)', async () => {
    const io = mockIO();
    const code = await runCli(['status'], io);
    const stderrWrite = io.stderr.write as unknown as ReturnType<typeof vi.fn>;
    const stderr = stderrWrite.mock.calls.map((c: string[]) => c.join('')).join('');
    expect(stderr).not.toContain('Unknown command: "status"');
    expect([0, 1]).toContain(code);
  });

  it('should route "ag list" to handleList (not reject)', async () => {
    const io = mockIO();
    const code = await runCli(['list'], io);
    const stderrWrite = io.stderr.write as unknown as ReturnType<typeof vi.fn>;
    const stderr = stderrWrite.mock.calls.map((c: string[]) => c.join('')).join('');
    expect(stderr).not.toContain('Unknown command: "list"');
    expect([0, 1]).toContain(code);
  });
});
