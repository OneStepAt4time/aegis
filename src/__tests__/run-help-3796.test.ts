/**
 * run-help-3796.test.ts — Tests for Issue #3796.
 *
 * `ag run --help` should show run-specific help, not generic ag help.
 */
import { describe, it, expect } from 'vitest';
import { runCli, CliIO } from '../cli.js';

function makeIo(lines: string[]): CliIO {
  return {
    stdin: process.stdin,
    stdout: { write: (s: string) => { lines.push(s); }, end: () => {} } as any,
    stderr: { write: () => {}, end: () => {} } as any,
  };
}

describe('Issue #3796: ag run --help shows run-specific flags', () => {
  it('shows run-specific help for "ag run --help"', async () => {
    const lines: string[] = [];
    const exitCode = await runCli(['run', '--help'], makeIo(lines));
    const output = lines.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('ag run');
    expect(output).toContain('--cwd');
    expect(output).toContain('--model');
    expect(output).toContain('--no-stream');
    // Should NOT contain generic ag commands like 'ag init' or 'ag list'
    expect(output).not.toContain('ag init');
    expect(output).not.toContain('ag list');
  });

  it('shows run-specific help for "ag run -h"', async () => {
    const lines: string[] = [];
    const exitCode = await runCli(['run', '-h'], makeIo(lines));
    const output = lines.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('ag run');
    expect(output).toContain('--cwd');
  });

  it('shows generic help for "ag --help" (no subcommand)', async () => {
    const lines: string[] = [];
    const exitCode = await runCli(['--help'], makeIo(lines));
    const output = lines.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('Usage:');
    expect(output).toContain('ag run');
  });
});
