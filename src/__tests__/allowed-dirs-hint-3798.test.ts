/**
 * allowed-dirs-hint-3798.test.ts — Tests for Issue #3798.
 *
 * When workDir is rejected, the error message must include
 * the list of allowed directories so the user knows what's permitted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateWorkDir } from '../validation.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const tmpBase = path.join(os.tmpdir(), `aegis-test-3798-${process.pid}`);

beforeEach(async () => {
  await fs.mkdir(tmpBase, { recursive: true });
});

describe('Issue #3798: error message includes allowed directories', () => {
  it('includes allowed dirs in rejection message (default safe dirs)', async () => {
    // /tmp is not in default safe dirs (homedir + cwd)
    const result = await validateWorkDir('/tmp');
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.code).toBe('INVALID_WORKDIR');
      // Must mention "Allowed:" with at least homedir
      expect(result.error).toContain('Allowed:');
      expect(result.error).toContain(os.homedir());
    }
  });

  it('includes custom allowed dirs in rejection message', async () => {
    const allowedDir = path.join(tmpBase, 'project-a');
    const rejectedDir = path.join(tmpBase, 'project-b');
    await fs.mkdir(allowedDir, { recursive: true });
    await fs.mkdir(rejectedDir, { recursive: true });

    const result = await validateWorkDir(rejectedDir, [allowedDir]);
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.code).toBe('INVALID_WORKDIR');
      expect(result.error).toContain('Allowed:');
      expect(result.error).toContain(allowedDir);
    }
  });

  it('includes multiple allowed dirs when configured', async () => {
    const dir1 = path.join(tmpBase, 'alpha');
    const dir2 = path.join(tmpBase, 'beta');
    const rejectedDir = path.join(tmpBase, 'gamma');
    await fs.mkdir(dir1, { recursive: true });
    await fs.mkdir(dir2, { recursive: true });
    await fs.mkdir(rejectedDir, { recursive: true });

    const result = await validateWorkDir(rejectedDir, [dir1, dir2]);
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.code).toBe('INVALID_WORKDIR');
      expect(result.error).toContain('Allowed:');
      expect(result.error).toContain(dir1);
      expect(result.error).toContain(dir2);
    }
  });
});

describe('Issue #4126: error message includes docs link for troubleshooting', () => {
  it('includes docs link in rejection message for non-allowed dir', async () => {
    const result = await validateWorkDir('/tmp');
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.code).toBe('INVALID_WORKDIR');
      expect(result.error).toContain('five-minute-setup.md');
      expect(result.error).toContain('troubleshooting');
    }
  });

  it('includes docs link when path does not exist', async () => {
    // Use a path under homedir (allowed prefix) but that doesn't exist
    const nonexistent = path.join(os.homedir(), 'nonexistent-dir-for-test-4126');
    const result = await validateWorkDir(nonexistent);
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.code).toBe('INVALID_WORKDIR');
      expect(result.error).toContain('five-minute-setup.md');
      expect(result.error).toContain('troubleshooting');
    }
  });
});
