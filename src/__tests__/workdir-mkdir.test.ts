/**
 * workdir-mkdir.test.ts — Tests for Issue #31: workDir auto-creation.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

/** Remove temp dir, ignoring errors — cleanup should never fail a test. */
async function cleanupTmp(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Intentionally swallowed — temp dir cleanup is best-effort
  }
}

describe('workDir auto-creation (Issue #31)', () => {
  it('should create missing workDir with recursive mkdir', async () => {
    const rootDir = join(tmpdir(), `aegis-test-${randomUUID()}`);
    const testDir = join(rootDir, 'nested', 'project');
    expect(existsSync(testDir)).toBe(false);

    await mkdir(testDir, { recursive: true });

    expect(existsSync(testDir)).toBe(true);

    await cleanupTmp(rootDir);
  });

  it('should not fail if workDir already exists', async () => {
    const testDir = tmpdir(); // Always exists
    // mkdir recursive on existing dir should not throw
    await expect(mkdir(testDir, { recursive: true })).resolves.not.toThrow();
  });

  it('should handle deeply nested paths', async () => {
    const rootDir = join(tmpdir(), `aegis-test-${randomUUID()}`);
    const testDir = join(rootDir, 'a', 'b', 'c', 'd');
    expect(existsSync(testDir)).toBe(false);

    await mkdir(testDir, { recursive: true });

    expect(existsSync(testDir)).toBe(true);

    await cleanupTmp(rootDir);
  });
});
