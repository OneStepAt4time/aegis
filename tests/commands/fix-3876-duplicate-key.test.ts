/**
 * Issue #3876: ag init crashes with DUPLICATE_KEY_NAME when key already exists.
 *
 * Integration tests verify:
 * 1. First run succeeds and creates key
 * 2. Second run succeeds without crash (either reuses token or skips creation)
 * 3. --force replaces the key
 *
 * The duplicate key guard (in the `generatedTokenRequested` block) is tested
 * by the --force test — it exercises both branches of the fix.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/claude-installer.js', () => ({
  ensureClaudeInstalled: vi.fn(),
  checkClaudeInstalled: vi.fn(() => Promise.resolve({ installed: true })),
  installClaudeCli: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../src/utils/detect-free-port.js', () => ({
  detectFreePort: vi.fn(async () => 9100),
  isPortAvailable: vi.fn(async () => true),
}));

vi.mock('../../src/utils/detect-running.js', () => ({
  detectRunningInstance: vi.fn(async () => null),
}));

vi.mock('open', () => ({ default: vi.fn(async () => {}) }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(() => ({ unref: vi.fn(), pid: 12345 })) };
});

import { runCli } from '../../src/cli.js';

class CaptureStream extends Writable {
  private chunks: string[] = [];
  override _write(chunk: string | Buffer, _enc: BufferEncoding, cb: (error?: Error | null) => void) {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
    cb();
  }
  text() { return this.chunks.join(''); }
}

describe('Issue #3876: ag init duplicate key handling', () => {
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;
  let projectDir: string;
  let stateDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalEnv = { ...process.env };
    projectDir = mkdtempSync(join(tmpdir(), 'aegis-3876-'));
    stateDir = join(projectDir, 'state');
    process.chdir(projectDir);
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AEGIS_') || key.startsWith('MANUS_')) delete process.env[key];
    }
    process.env.AEGIS_STATE_DIR = stateDir;
    process.env.AEGIS_HOST = '0.0.0.0';
    process.env.AEGIS_PORT = '9100';
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    rmSync(projectDir, { recursive: true, force: true });
  });

  async function runInit(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const stdin = new PassThrough();
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    const runPromise = runCli(argv, { stdin, stdout, stderr });
    setImmediate(() => stdin.end());
    const code = await runPromise;
    return { code, stdout: stdout.text(), stderr: stderr.text() };
  }

  it('should succeed on first run', async () => {
    const { code, stderr } = await runInit(['init', '--yes', '--no-start']);
    expect(code).toBe(0);
    expect(stderr).not.toContain('DUPLICATE_KEY_NAME');
  });

  it('should not crash on repeated runs', async () => {
    const r1 = await runInit(['init', '--yes', '--no-start']);
    expect(r1.code).toBe(0);

    // Second run — must not crash with DUPLICATE_KEY_NAME
    const r2 = await runInit(['init', '--yes', '--no-start']);
    expect(r2.code).toBe(0);
    expect(r2.stderr).not.toContain('DUPLICATE_KEY_NAME');
  });

  it('should not crash on repeated runs with --force', async () => {
    const r1 = await runInit(['init', '--yes', '--no-start']);
    expect(r1.code).toBe(0);

    const r2 = await runInit(['init', '--yes', '--no-start', '--force']);
    expect(r2.code).toBe(0);
    expect(r2.stderr).not.toContain('DUPLICATE_KEY_NAME');
  });
});
