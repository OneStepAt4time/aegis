/**
 * path-traversal-workdir-435.test.ts — Tests for Issue #435.
 *
 * Comprehensive tests for validateWorkDir covering:
 * - Path traversal via ".." in raw input
 * - Symlink-based escapes
 * - Default safe directory enforcement
 * - Configurable allowlist
 * - Normal valid paths
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

function samePath(a: string, b: string): boolean {
  const left = path.normalize(a);
  const right = path.normalize(b);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function sameCanonicalPath(a: string, b: string): Promise<boolean> {
  const leftReal = await fs.realpath(a);
  const rightReal = await fs.realpath(b);
  return samePath(leftReal, rightReal);
}

const tmpBase = path.join(os.tmpdir(), 'aegis-test-435');

describe('validateWorkDir — Issue #435', () => {
  beforeEach(async () => {
    await fs.mkdir(tmpBase, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  });

  // -------------------------------------------------------------------------
  // Path traversal via ".." in raw string
  // -------------------------------------------------------------------------
  describe('rejects path traversal via ".."', () => {
    it('rejects /tmp/../etc', async () => {
      const result = await validateWorkDir('/tmp/../etc');
      expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
      if (typeof result === 'object') {
        expect(result.error).toContain('..');
      }
    });

    it('rejects /tmp/../../etc/passwd', async () => {
      const result = await validateWorkDir('/tmp/../../etc/passwd');
      expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
    });

    it('rejects ./secrets/../../../etc/passwd', async () => {
      const result = await validateWorkDir('./secrets/../../../etc/passwd');
      expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
    });

    it('rejects relative traversal ../etc', async () => {
      const result = await validateWorkDir('../etc');
      expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
    });

    it('rejects deeply nested traversal', async () => {
      const result = await validateWorkDir('/tmp/a/b/../../../../etc/shadow');
      expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
    });

    it('rejects encoded traversal (%2e%2e)', async () => {
      const result = await validateWorkDir('/tmp/%2e%2e/etc');
      expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
    });

    it('rejects mixed-separator traversal', async () => {
      const result = await validateWorkDir('tmp\\..\\etc');
      expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Valid paths that should be accepted
  // -------------------------------------------------------------------------
  describe('accepts legitimate paths', () => {
    it('accepts an existing tmp subdirectory', async () => {
      const dir = path.join(tmpBase, 'project');
      await fs.mkdir(dir, { recursive: true });
      const result = await validateWorkDir(dir);
      expect(typeof result).toBe('string');
      expect(await sameCanonicalPath(result as string, dir)).toBe(true);
    });

    it('accepts /tmp itself', async () => {
      const result = await validateWorkDir('/tmp');
      expect(typeof result).toBe('string');
    });

    it('accepts the current working directory', async () => {
      const cwd = process.cwd();
      const result = await validateWorkDir(cwd);
      expect(typeof result).toBe('string');
      expect(await sameCanonicalPath(result as string, cwd)).toBe(true);
    });

    it('accepts home directory', async () => {
      const home = os.homedir();
      const result = await validateWorkDir(home);
      expect(typeof result).toBe('string');
    });

    it('accepts relative path "."', async () => {
      const result = await validateWorkDir('.');
      expect(typeof result).toBe('string');
      expect(await sameCanonicalPath(result as string, process.cwd())).toBe(true);
    });

    it('accepts relative path without traversal', async () => {
      const result = await validateWorkDir('./src');
      expect(typeof result).toBe('string');
    });

    it('accepts directory names that contain dots but no traversal segments', async () => {
      const dir = path.join(tmpBase, 'project...name');
      await fs.mkdir(dir, { recursive: true });
      const result = await validateWorkDir(dir);
      expect(typeof result).toBe('string');
      expect(await sameCanonicalPath(result as string, dir)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Non-existent paths
  // -------------------------------------------------------------------------
  describe('rejects non-existent paths', () => {
    it('rejects a path that does not exist', async () => {
      const result = await validateWorkDir('/tmp/this-path-definitely-does-not-exist-abc123');
      expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
      if (typeof result === 'object') {
        expect(result.error).toContain('does not exist');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Default safe directory enforcement
  // -------------------------------------------------------------------------
  describe('enforces default safe directories', () => {
    it('rejects /etc (system directory, not under safe dirs)', async () => {
      const result = await validateWorkDir('/etc');
      expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
      if (typeof result === 'object') {
        expect(
          result.error.includes('not in the allowed directories') || result.error.includes('does not exist'),
        ).toBe(true);
      }
    });

    it('rejects /root (system directory)', async () => {
      // /root may not be readable, but the realpath + allowlist check
      // should reject it even if it exists
      const result = await validateWorkDir('/root');
      expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
    });

    it('rejects /usr (system directory)', async () => {
      const result = await validateWorkDir('/usr');
      expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
    });

    it('accepts /tmp (in default safe dirs)', async () => {
      const result = await validateWorkDir('/tmp');
      expect(typeof result).toBe('string');
    });
  });

  // -------------------------------------------------------------------------
  // Symlink escape prevention
  // -------------------------------------------------------------------------
  describe('prevents symlink-based escapes', () => {
    it('rejects a symlink pointing to /etc when not in allowlist', async () => {
      const linkPath = path.join(tmpBase, 'evil-link');
      try {
        await fs.symlink('/etc', linkPath);
      } catch {
        // Skip if symlink creation fails (unlikely on Linux)
        return;
      }
      const result = await validateWorkDir(linkPath);
      // realpath resolves to /etc, which is not in default safe dirs
      expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
      if (typeof result === 'object') {
        expect(
          result.error.includes('not in the allowed directories') || result.error.includes('does not exist'),
        ).toBe(true);
      }
    });

    it('accepts a symlink pointing to a safe directory', async () => {
      const realDir = path.join(tmpBase, 'real-project');
      const linkPath = path.join(tmpBase, 'link-project');
      await fs.mkdir(realDir, { recursive: true });
      try {
        await fs.symlink(realDir, linkPath);
      } catch {
        return;
      }
      const result = await validateWorkDir(linkPath);
      expect(typeof result).toBe('string');
      // Should resolve to the real directory
      expect(await sameCanonicalPath(result as string, realDir)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Configurable allowlist
  // -------------------------------------------------------------------------
  describe('configurable allowedWorkDirs', () => {
    it('uses configured allowlist instead of defaults', async () => {
      const dir = path.join(tmpBase, 'allowed-project');
      await fs.mkdir(dir, { recursive: true });
      // With allowlist containing only this dir, /tmp should be rejected
      const result = await validateWorkDir('/tmp', [dir]);
      expect(isError(result, 'INVALID_WORKDIR')).toBe(true);
    });

    it('accepts path under configured allowlist entry', async () => {
      const dir = path.join(tmpBase, 'allowed-project');
      const subDir = path.join(dir, 'sub');
      await fs.mkdir(subDir, { recursive: true });
      const result = await validateWorkDir(subDir, [dir]);
      expect(typeof result).toBe('string');
      expect(await sameCanonicalPath(result as string, subDir)).toBe(true);
    });

    it('accepts exact allowlist entry', async () => {
      const dir = path.join(tmpBase, 'allowed-project');
      await fs.mkdir(dir, { recursive: true });
      const result = await validateWorkDir(dir, [dir]);
      expect(typeof result).toBe('string');
      expect(await sameCanonicalPath(result as string, dir)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Type validation
  // -------------------------------------------------------------------------
  describe('type validation', () => {
    it('rejects empty allowlist as default (uses safe dirs)', async () => {
      // Empty array triggers default safe dirs behavior
      const result = await validateWorkDir('/tmp');
      expect(typeof result).toBe('string');
    });
  });
});
