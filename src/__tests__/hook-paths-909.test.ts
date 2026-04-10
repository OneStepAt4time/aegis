import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildHookCommand, assertPathNotSymlink, withLockFile } from '../hook.js';
import { buildProjectSettingsPath } from '../hook-settings.js';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Issue #909: hook command path normalization', () => {
  it('quotes and normalizes Unix paths', () => {
    const cmd = buildHookCommand('/tmp/aegis dist/hook.js', '/usr/local/bin/node', 'linux');
    expect(cmd).toBe('"/usr/local/bin/node" "/tmp/aegis dist/hook.js"');
  });

  it('quotes and normalizes Windows paths with spaces', () => {
    const cmd = buildHookCommand('D:/Aegis Work/dist/hook.js', 'C:/Program Files/nodejs/node.exe', 'win32');
    expect(cmd).toBe('"C:\\Program Files\\nodejs\\node.exe" "D:\\Aegis Work\\dist\\hook.js"');
  });
});

describe('Issue #909: hook settings path construction', () => {
  it('builds Unix settings.local.json path', () => {
    const settingsPath = buildProjectSettingsPath('/home/user/my-repo', 'linux');
    expect(settingsPath.replace(/\\/g, '/')).toContain('/home/user/my-repo/.claude/settings.local.json');
  });

  it('builds Windows settings.local.json path from slash input', () => {
    const settingsPath = buildProjectSettingsPath('D:/Users/dev/My Repo', 'win32');
    expect(settingsPath).toContain('D:\\Users\\dev\\My Repo\\.claude\\settings.local.json');
  });
});

describe('Issue #1618: hook symlink and lock hardening', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'aegis-hook-1618-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('acquires and releases lock files around critical sections', () => {
    const lockPath = join(tmpDir, 'map.lock');
    const result = withLockFile(lockPath, () => {
      expect(existsSync(lockPath)).toBe(true);
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('times out if a lock file is already held', async () => {
    const lockPath = join(tmpDir, 'held.lock');
    await writeFile(lockPath, 'held');
    expect(() => withLockFile(lockPath, () => 'never', 1)).toThrow(/Timed out waiting for lock/);
  });

  it('rejects symlink paths when symlink creation is permitted', async () => {
    const targetFile = join(tmpDir, 'target.json');
    const linkFile = join(tmpDir, 'link.json');
    await writeFile(targetFile, '{}');
    try {
      await symlink(targetFile, linkFile);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EPERM' || err.code === 'EACCES') return;
      throw error;
    }
    expect(() => assertPathNotSymlink(linkFile)).toThrow(/symlink path/);
  });
});
