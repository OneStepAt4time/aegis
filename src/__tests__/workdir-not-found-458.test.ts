/**
 * workdir-not-found-458.test.ts — Issue #458
 *
 * POST /v1/sessions should return 400 with a clear error when workDir
 * does not exist on disk, not 200 with id: null.
 *
 * Tests the validateWorkDir logic by exercising the same fs.realpath
 * check that the server route uses.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { testPath, testTmpDir } from './helpers/platform.js';

async function sameCanonicalPath(a: string, b: string): Promise<boolean> {
  const leftReal = await realpath(a);
  const rightReal = await realpath(b);
  const left = path.normalize(leftReal);
  const right = path.normalize(rightReal);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/**
 * Mirrors the core of validateWorkDir from server.ts.
 * We duplicate the logic here because it's a private function.
 * If the server logic changes, this test should be updated too.
 */
async function validateWorkDir(workDir: string): Promise<string | { error: string; code: string }> {
  if (typeof workDir !== 'string') return { error: 'workDir must be a string', code: 'INVALID_WORKDIR' };
  if (workDir.includes('..')) {
    return { error: 'workDir must not contain path traversal components (..)', code: 'INVALID_WORKDIR' };
  }
  const resolved = path.resolve(workDir);
  let realPath: string;
  try {
    realPath = await realpath(resolved);
  } catch {
    return { error: `workDir does not exist: ${resolved}`, code: 'INVALID_WORKDIR' };
  }
  return realPath;
}

describe('Issue #458: validateWorkDir rejects non-existent paths', () => {
  it('returns INVALID_WORKDIR for a path that does not exist', async () => {
    const missingPath = testPath('/path/that/does/not/exist/at/all');
    const result = await validateWorkDir(missingPath);
    expect(typeof result).toBe('object');
    expect(result).toEqual({
      error: `workDir does not exist: ${path.resolve(missingPath)}`,
      code: 'INVALID_WORKDIR',
    });
  });

  it('includes the resolved path in the error message', async () => {
    const result = await validateWorkDir('no/such/relative/dir');
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.error).toContain('workDir does not exist:');
      expect(result.code).toBe('INVALID_WORKDIR');
      // Verify it resolves to an absolute path
      expect(result.error).toContain(path.resolve('no/such/relative/dir'));
    }
  });

  it('returns INVALID_WORKDIR for path traversal', async () => {
    const result = await validateWorkDir('/tmp/../etc/passwd');
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.error).toContain('path traversal');
      expect(result.code).toBe('INVALID_WORKDIR');
    }
  });

  it('returns a valid path for an existing directory', async () => {
    const expectedTmp = testTmpDir();
    const result = await validateWorkDir(expectedTmp);
    expect(typeof result).toBe('string');
    expect(await sameCanonicalPath(result as string, expectedTmp)).toBe(true);
  });

  it('returns INVALID_WORKDIR for non-string input', async () => {
    const result = await validateWorkDir(undefined as unknown as string);
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.code).toBe('INVALID_WORKDIR');
    }
  });
});
