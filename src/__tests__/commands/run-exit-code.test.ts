/**
 * Issue #3838: ag run exits 0 on error (empty prompt, missing args)
 *
 * Validates that handleRun returns non-zero exit codes for all validation failures.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRun } from '../../commands/run.js';
import type { CliIO } from '../../cli-http.js';

function createMockIO(): CliIO {
  return {
    stdin: { on: vi.fn(), pipe: vi.fn() } as unknown as NodeJS.ReadableStream,
    stdout: { write: vi.fn() } as unknown as NodeJS.WritableStream,
    stderr: { write: vi.fn() } as unknown as NodeJS.WritableStream,
  };
}

describe('handleRun validation exit codes (#3838)', () => {
  let io: CliIO;

  beforeEach(() => {
    io = createMockIO();
  });

  it('returns 1 for empty prompt ""', async () => {
    const code = await handleRun([''], io);
    expect(code).toBe(1);
  });

  it('returns 1 for no prompt (no args)', async () => {
    const code = await handleRun([], io);
    expect(code).toBe(1);
  });

  it('returns 1 for --model with no value (flag is last arg)', async () => {
    const code = await handleRun(['--model'], io);
    expect(code).toBe(1);
  });

  it('returns 1 for --model with flag-like value', async () => {
    const code = await handleRun(['--model', '--other', 'build'], io);
    expect(code).toBe(1);
  });

  it('returns 0 for --help', async () => {
    const code = await handleRun(['--help'], io);
    expect(code).toBe(0);
  });

  it('returns 0 for -h', async () => {
    const code = await handleRun(['-h'], io);
    expect(code).toBe(0);
  });
});
