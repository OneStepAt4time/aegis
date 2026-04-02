/**
 * pipeline-stage-workdir-traversal-631.test.ts — Tests for Issue #631.
 *
 * Verifies that validateWorkDir rejects path traversal patterns
 * that could appear in per-stage workDir overrides.
 * The server route applies validateWorkDir to each stage's workDir
 * the same way it validates the pipeline-level workDir.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { validateWorkDir } from '../validation.js';

/** Helper: check result is an error with given code. */
function isError(result: string | { error: string; code: string }, code: string): boolean {
  return typeof result === 'object' && result.code === code;
}

const tmpBase = path.join(os.tmpdir(), 'aegis-test-631');

describe('Pipeline stage workDir path traversal — Issue #631', () => {
  beforeEach(async () => {
    await fs.mkdir(tmpBase, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  });

  it('rejects stage workDir with ".." traversing out of /tmp', async () => {
    const result = await validateWorkDir('/tmp/../../etc/passwd');
    expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
  });

  it('rejects stage workDir with ".." appended to a valid path', async () => {
    const validDir = await fs.mkdtemp(path.join(tmpBase, 'safe-'));
    const result = await validateWorkDir(validDir + '/../../etc');
    expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
  });

  it('rejects stage workDir that is just ".."', async () => {
    const result = await validateWorkDir('..');
    expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
  });

  it('accepts a valid stage workDir under tmp', async () => {
    const stageDir = await fs.mkdtemp(path.join(tmpBase, 'stage-'));
    const result = await validateWorkDir(stageDir);
    expect(typeof result).toBe('string');
    expect(result).toBe(stageDir);
  });

  it('accepts a valid stage workDir nested under home', async () => {
    const stageDir = await fs.mkdtemp(path.join(os.homedir(), '.aegis-test-631-'));
    const result = await validateWorkDir(stageDir);
    expect(typeof result).toBe('string');
    await fs.rm(stageDir, { recursive: true, force: true });
  });
});
