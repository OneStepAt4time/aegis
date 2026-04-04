/**
 * permission-guard.test.ts — Tests for permission guard across all 3 CC settings locations.
 *
 * All tests use workDir as the homeDir override so nothing touches the real ~/.claude
 * or ~/.aegis directories. This ensures isolation in any environment (local, CI, etc.).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import {
  neutralizeBypassPermissions,
  restoreSettings,
  cleanOrphanedBackup,
  settingsPath,
  userSettingsPath,
  projectSettingsPath,
  backupPath,
  backupDirForWorkDir,
} from '../permission-guard.js';

describe('Permission guard', () => {
  let workDir: string;
  // Separate fake home dir — must differ from workDir to avoid path collisions
  // (userSettingsPath and projectSettingsPath would overlap if homeDir === workDir)
  let fakeHome: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'aegis-perm-guard-'));
    fakeHome = await mkdtemp(join(tmpdir(), 'aegis-perm-home-'));
    await mkdir(join(workDir, '.claude'), { recursive: true });
    await mkdir(join(fakeHome, '.claude'), { recursive: true });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    await rm(fakeHome, { recursive: true, force: true });
  });

  /** Helper: get the user-level settings path for the fake home. */
  function userSettings(): string {
    return userSettingsPath(fakeHome);
  }

  /** Helper: get the user-level backup path for the fake home. */
  function userBackup(): string {
    return join(fakeHome, '.aegis', 'permission-backups', '_user_', 'settings.json');
  }

  // ─── Location 3: settings.local.json (project local) ───

  describe('neutralizeBypassPermissions — settings.local.json (project local)', () => {
    it('should patch bypassPermissions to default', async () => {
      const settings = {
        permissions: { defaultMode: 'bypassPermissions' },
        other: 'preserved',
      };
      await writeFile(settingsPath(workDir), JSON.stringify(settings));

      const result = await neutralizeBypassPermissions(workDir, 'default', fakeHome);

      expect(result).toBe(true);
      const patched = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(patched.permissions.defaultMode).toBe('default');
      expect(patched.other).toBe('preserved');
    });

    it('should patch bypassPermissions to acceptEdits', async () => {
      const settings = {
        permissions: { defaultMode: 'bypassPermissions' },
        other: 'preserved',
      };
      await writeFile(settingsPath(workDir), JSON.stringify(settings));

      const result = await neutralizeBypassPermissions(workDir, 'acceptEdits', fakeHome);

      expect(result).toBe(true);
      const patched = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(patched.permissions.defaultMode).toBe('acceptEdits');
      expect(patched.other).toBe('preserved');
    });

    it('should create a backup of original file', async () => {
      const settings = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(settings));

      await neutralizeBypassPermissions(workDir, 'default', fakeHome);

      expect(existsSync(backupPath(workDir, fakeHome))).toBe(true);
      const backup = JSON.parse(await readFile(backupPath(workDir, fakeHome), 'utf-8'));
      expect(backup.permissions.defaultMode).toBe('bypassPermissions');
    });

    it('should return false if no settings file exists', async () => {
      const result = await neutralizeBypassPermissions(workDir, 'default', fakeHome);
      expect(result).toBe(false);
    });

    it('should return false if defaultMode is not bypassPermissions', async () => {
      const settings = { permissions: { defaultMode: 'default' } };
      await writeFile(settingsPath(workDir), JSON.stringify(settings));

      const result = await neutralizeBypassPermissions(workDir, 'default', fakeHome);

      expect(result).toBe(false);
      expect(existsSync(backupPath(workDir, fakeHome))).toBe(false);
    });

    it('should return false if no permissions key at all', async () => {
      const settings = { someOther: 'config' };
      await writeFile(settingsPath(workDir), JSON.stringify(settings));

      const result = await neutralizeBypassPermissions(workDir, 'default', fakeHome);
      expect(result).toBe(false);
    });

    it('should return false for malformed JSON', async () => {
      await writeFile(settingsPath(workDir), '{ not valid json');

      const result = await neutralizeBypassPermissions(workDir, 'default', fakeHome);
      expect(result).toBe(false);
    });

    it('should preserve all other settings fields', async () => {
      const settings = {
        permissions: {
          defaultMode: 'bypassPermissions',
          allow: ['Bash(*)', 'Read(*)'],
        },
        model: 'claude-sonnet-4-20250514',
        env: { DEBUG: '1' },
      };
      await writeFile(settingsPath(workDir), JSON.stringify(settings));

      await neutralizeBypassPermissions(workDir, 'default', fakeHome);

      const patched = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(patched.permissions.defaultMode).toBe('default');
      expect(patched.permissions.allow).toEqual(['Bash(*)', 'Read(*)']);
      expect(patched.model).toBe('claude-sonnet-4-20250514');
      expect(patched.env).toEqual({ DEBUG: '1' });
    });
  });

  // ─── Location 2: project-level .claude/settings.json (committed) ───

  describe('neutralizeBypassPermissions — project settings.json (committed)', () => {
    it('should patch bypassPermissions in project settings.json', async () => {
      const settings = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(projectSettingsPath(workDir), JSON.stringify(settings));

      const result = await neutralizeBypassPermissions(workDir, 'default', fakeHome);

      expect(result).toBe(true);
      const patched = JSON.parse(await readFile(projectSettingsPath(workDir), 'utf-8'));
      expect(patched.permissions.defaultMode).toBe('default');
    });

    it('should create a backup for project settings.json', async () => {
      const settings = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(projectSettingsPath(workDir), JSON.stringify(settings));

      await neutralizeBypassPermissions(workDir, 'default', fakeHome);

      const bp = join(backupDirForWorkDir(workDir, fakeHome), 'settings.json');
      expect(existsSync(bp)).toBe(true);
      const backup = JSON.parse(await readFile(bp, 'utf-8'));
      expect(backup.permissions.defaultMode).toBe('bypassPermissions');
    });

    it('should return false if project settings.json has no bypass', async () => {
      const settings = { permissions: { defaultMode: 'default' } };
      await writeFile(projectSettingsPath(workDir), JSON.stringify(settings));

      const result = await neutralizeBypassPermissions(workDir, 'default', fakeHome);
      expect(result).toBe(false);
    });

    it('should restore project settings.json on restoreSettings', async () => {
      const settings = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(projectSettingsPath(workDir), JSON.stringify(settings));

      await neutralizeBypassPermissions(workDir, 'default', fakeHome);
      await restoreSettings(workDir, fakeHome);

      const restored = JSON.parse(await readFile(projectSettingsPath(workDir), 'utf-8'));
      expect(restored.permissions.defaultMode).toBe('bypassPermissions');
    });
  });

  // ─── Location 1: user-level settings.json ───

  describe('neutralizeBypassPermissions — user settings.json', () => {
    it('should patch bypassPermissions in user settings.json', async () => {
      const settings = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(userSettings(), JSON.stringify(settings));

      const result = await neutralizeBypassPermissions(workDir, 'default', fakeHome);

      expect(result).toBe(true);
      const patched = JSON.parse(await readFile(userSettings(), 'utf-8'));
      expect(patched.permissions.defaultMode).toBe('default');
    });

    it('should create a backup for user settings.json', async () => {
      const settings = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(userSettings(), JSON.stringify(settings));

      await neutralizeBypassPermissions(workDir, 'default', fakeHome);

      expect(existsSync(userBackup())).toBe(true);
      const backup = JSON.parse(await readFile(userBackup(), 'utf-8'));
      expect(backup.permissions.defaultMode).toBe('bypassPermissions');
    });

    it('should return false if user settings.json has no bypass', async () => {
      const settings = { permissions: { defaultMode: 'default' } };
      await writeFile(userSettings(), JSON.stringify(settings));

      const result = await neutralizeBypassPermissions(workDir, 'default', fakeHome);
      expect(result).toBe(false);
    });

    it('should restore user settings.json on restoreSettings', async () => {
      const settings = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(userSettings(), JSON.stringify(settings));

      await neutralizeBypassPermissions(workDir, 'default', fakeHome);
      await restoreSettings(workDir, fakeHome);

      const restored = JSON.parse(await readFile(userSettings(), 'utf-8'));
      expect(restored.permissions.defaultMode).toBe('bypassPermissions');
    });
  });

  // ─── All 3 locations patched simultaneously ───

  describe('neutralizeBypassPermissions — all 3 locations', () => {
    it('should patch all 3 files when all have bypassPermissions', async () => {
      const bypassSettings = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(userSettings(), JSON.stringify(bypassSettings));
      await writeFile(projectSettingsPath(workDir), JSON.stringify(bypassSettings));
      await writeFile(settingsPath(workDir), JSON.stringify(bypassSettings));

      const result = await neutralizeBypassPermissions(workDir, 'plan', fakeHome);

      expect(result).toBe(true);
      for (const p of [userSettings(), projectSettingsPath(workDir), settingsPath(workDir)]) {
        const patched = JSON.parse(await readFile(p, 'utf-8'));
        expect(patched.permissions.defaultMode).toBe('plan');
      }
    });

    it('should return true when only 1 of 3 has bypassPermissions', async () => {
      // Only user-level has bypass
      await writeFile(userSettings(), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }));
      await writeFile(projectSettingsPath(workDir), JSON.stringify({ permissions: { defaultMode: 'default' } }));
      await writeFile(settingsPath(workDir), JSON.stringify({ permissions: { defaultMode: 'default' } }));

      const result = await neutralizeBypassPermissions(workDir, 'default', fakeHome);
      expect(result).toBe(true);

      // Only user-level patched
      const user = JSON.parse(await readFile(userSettings(), 'utf-8'));
      expect(user.permissions.defaultMode).toBe('default');

      const project = JSON.parse(await readFile(projectSettingsPath(workDir), 'utf-8'));
      expect(project.permissions.defaultMode).toBe('default');

      const local = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(local.permissions.defaultMode).toBe('default');
    });

    it('should return false when none have bypassPermissions', async () => {
      await writeFile(userSettings(), JSON.stringify({ permissions: { defaultMode: 'default' } }));
      await writeFile(projectSettingsPath(workDir), JSON.stringify({ permissions: { defaultMode: 'default' } }));
      await writeFile(settingsPath(workDir), JSON.stringify({ permissions: { defaultMode: 'default' } }));

      const result = await neutralizeBypassPermissions(workDir, 'default', fakeHome);
      expect(result).toBe(false);
    });

    it('should restore all 3 files on restoreSettings', async () => {
      const bypassSettings = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(userSettings(), JSON.stringify(bypassSettings));
      await writeFile(projectSettingsPath(workDir), JSON.stringify(bypassSettings));
      await writeFile(settingsPath(workDir), JSON.stringify(bypassSettings));

      await neutralizeBypassPermissions(workDir, 'default', fakeHome);
      await restoreSettings(workDir, fakeHome);

      for (const p of [userSettings(), projectSettingsPath(workDir), settingsPath(workDir)]) {
        const restored = JSON.parse(await readFile(p, 'utf-8'));
        expect(restored.permissions.defaultMode).toBe('bypassPermissions');
      }
    });

    it('should clean all orphaned backups on cleanOrphanedBackup', async () => {
      const original = { permissions: { defaultMode: 'bypassPermissions' } };
      const patched = { permissions: { defaultMode: 'default' } };

      // Simulate crash: all 3 files are patched
      await writeFile(settingsPath(workDir), JSON.stringify(patched));
      await writeFile(projectSettingsPath(workDir), JSON.stringify(patched));
      await writeFile(userSettings(), JSON.stringify(patched));

      // Create backups manually
      const bpDir = backupDirForWorkDir(workDir, fakeHome);
      await mkdir(bpDir, { recursive: true });
      await writeFile(join(bpDir, 'settings.local.json'), JSON.stringify(original));
      await writeFile(join(bpDir, 'settings.json'), JSON.stringify(original));
      await mkdir(join(fakeHome, '.aegis', 'permission-backups', '_user_'), { recursive: true });
      await writeFile(userBackup(), JSON.stringify(original));

      await cleanOrphanedBackup(workDir, fakeHome);

      // All 3 restored
      for (const p of [userSettings(), projectSettingsPath(workDir), settingsPath(workDir)]) {
        const restored = JSON.parse(await readFile(p, 'utf-8'));
        expect(restored.permissions.defaultMode).toBe('bypassPermissions');
      }
      // Backups cleaned
      expect(existsSync(join(bpDir, 'settings.local.json'))).toBe(false);
      expect(existsSync(join(bpDir, 'settings.json'))).toBe(false);
      expect(existsSync(userBackup())).toBe(false);
    });
  });

  // ─── restoreSettings / cleanOrphanedBackup ───

  describe('restoreSettings', () => {
    it('should restore original file from backup (settings.local.json)', async () => {
      const original = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(original));
      await neutralizeBypassPermissions(workDir, 'default', fakeHome);

      await restoreSettings(workDir, fakeHome);

      const restored = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(restored.permissions.defaultMode).toBe('bypassPermissions');
      expect(existsSync(backupPath(workDir, fakeHome))).toBe(false);
    });

    it('should do nothing if no backup exists', async () => {
      const settings = { permissions: { defaultMode: 'default' } };
      await writeFile(settingsPath(workDir), JSON.stringify(settings));

      await restoreSettings(workDir, fakeHome);

      const unchanged = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(unchanged.permissions.defaultMode).toBe('default');
    });
  });

  describe('cleanOrphanedBackup', () => {
    it('should restore orphaned backup (crash recovery)', async () => {
      const original = { permissions: { defaultMode: 'bypassPermissions' } };
      const patched = { permissions: { defaultMode: 'default' } };
      const bp = backupPath(workDir, fakeHome);
      await mkdir(join(bp, '..'), { recursive: true });
      await writeFile(bp, JSON.stringify(original));
      await writeFile(settingsPath(workDir), JSON.stringify(patched));

      await cleanOrphanedBackup(workDir, fakeHome);

      const restored = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(restored.permissions.defaultMode).toBe('bypassPermissions');
      expect(existsSync(backupPath(workDir, fakeHome))).toBe(false);
    });

    it('should do nothing if no orphaned backup', async () => {
      await cleanOrphanedBackup(workDir, fakeHome);
      // Should not throw
    });
  });

  // ─── Path helpers ───

  describe('path helpers', () => {
    it('settingsPath should point to .claude/settings.local.json', () => {
      expect(settingsPath('/tmp/project')).toBe(join('/tmp/project', '.claude', 'settings.local.json'));
    });

    it('projectSettingsPath should point to .claude/settings.json', () => {
      expect(projectSettingsPath('/tmp/project')).toBe(join('/tmp/project', '.claude', 'settings.json'));
    });

    it('userSettingsPath defaults to real homedir', () => {
      expect(userSettingsPath()).toBe(join(homedir(), '.claude', 'settings.json'));
    });

    it('userSettingsPath accepts override homeDir', () => {
      expect(userSettingsPath('/fake/home')).toBe(join('/fake/home', '.claude', 'settings.json'));
    });

    it('backupPath should be in permission-backups/', () => {
      const bp = backupPath('/tmp/project', '/fake/home');
      expect(bp).toContain('permission-backups');
      expect(bp).toContain('settings.local.json');
    });
  });

  // ─── Edge cases ───

  describe('edge cases', () => {
    it('should return false when no settings files exist anywhere', async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), 'aegis-perm-empty-'));
      try {
        const result = await neutralizeBypassPermissions(emptyDir, 'default', emptyDir);
        expect(result).toBe(false);
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it('should handle concurrent neutralize+restore cycle', async () => {
      const settings = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(settings));

      const patched = await neutralizeBypassPermissions(workDir, 'default', fakeHome);
      expect(patched).toBe(true);

      const during = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(during.permissions.defaultMode).toBe('default');

      await restoreSettings(workDir, fakeHome);

      const after = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(after.permissions.defaultMode).toBe('bypassPermissions');
    });

    it('should not touch files that are not bypassPermissions', async () => {
      // User has bypass, project doesn't
      await writeFile(userSettings(), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }));
      await writeFile(projectSettingsPath(workDir), JSON.stringify({ permissions: { defaultMode: 'plan' } }));
      // No settings.local.json

      await neutralizeBypassPermissions(workDir, 'default', fakeHome);

      // User patched
      const user = JSON.parse(await readFile(userSettings(), 'utf-8'));
      expect(user.permissions.defaultMode).toBe('default');

      // Project untouched
      const project = JSON.parse(await readFile(projectSettingsPath(workDir), 'utf-8'));
      expect(project.permissions.defaultMode).toBe('plan');

      // No local file created
      expect(existsSync(settingsPath(workDir))).toBe(false);
    });
  });
});
