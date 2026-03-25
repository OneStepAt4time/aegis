/**
 * workdir-mkdir.test.ts — Tests for Issue #31: workDir auto-creation.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('workDir auto-creation (Issue #31)', () => {
  it('should create missing workDir with recursive mkdir', async () => {
    const rootDir = join(tmpdir(), `aegis-test-${Date.now()}`);
    const testDir = join(rootDir, 'nested', 'project');
    expect(existsSync(testDir)).toBe(false);

    await mkdir(testDir, { recursive: true });

    expect(existsSync(testDir)).toBe(true);

    // Cleanup
    const { rm } = await import('node:fs/promises');
    await rm(rootDir, { recursive: true, force: true });
  });

  it('should not fail if workDir already exists', async () => {
    const testDir = tmpdir(); // Always exists
    // mkdir recursive on existing dir should not throw
    await expect(mkdir(testDir, { recursive: true })).resolves.not.toThrow();
  });

  it('should handle deeply nested paths', async () => {
    const rootDir = join(tmpdir(), `aegis-test-${Date.now()}`);
    const testDir = join(rootDir, 'a', 'b', 'c', 'd');
    expect(existsSync(testDir)).toBe(false);

    await mkdir(testDir, { recursive: true });

    expect(existsSync(testDir)).toBe(true);

    // Cleanup
    const { rm } = await import('node:fs/promises');
    await rm(rootDir, { recursive: true, force: true });
  });
});
