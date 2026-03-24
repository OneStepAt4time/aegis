/**
 * permission-guard.test.ts — Tests for settings.local.json permission guard.
 *
 * When autoApprove is false, Aegis must neutralize bypassPermissions in the
 * project's .claude/settings.local.json to prevent it from overriding the
 * CLI --permission-mode default flag.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  neutralizeBypassPermissions,
  restoreSettings,
  cleanOrphanedBackup,
  settingsPath,
  backupPath,
} from '../permission-guard.js';

describe('Permission guard', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'aegis-perm-guard-'));
    await mkdir(join(workDir, '.claude'), { recursive: true });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  describe('neutralizeBypassPermissions', () => {
    it('should patch bypassPermissions to default', async () => {
      const settings = {
        permissions: { defaultMode: 'bypassPermissions' },
        other: 'preserved',
      };
      await writeFile(settingsPath(workDir), JSON.stringify(settings));

      const result = await neutralizeBypassPermissions(workDir);

      expect(result).toBe(true);
      const patched = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(patched.permissions.defaultMode).toBe('default');
      expect(patched.other).toBe('preserved');
    });

    it('should create a backup of original file', async () => {
      const settings = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(settings));

      await neutralizeBypassPermissions(workDir);

      expect(existsSync(backupPath(workDir))).toBe(true);
      const backup = JSON.parse(await readFile(backupPath(workDir), 'utf-8'));
      expect(backup.permissions.defaultMode).toBe('bypassPermissions');
    });

    it('should return false if no settings file exists', async () => {
      const result = await neutralizeBypassPermissions(workDir);
      expect(result).toBe(false);
    });

    it('should return false if defaultMode is not bypassPermissions', async () => {
      const settings = { permissions: { defaultMode: 'default' } };
      await writeFile(settingsPath(workDir), JSON.stringify(settings));

      const result = await neutralizeBypassPermissions(workDir);

      expect(result).toBe(false);
      expect(existsSync(backupPath(workDir))).toBe(false);
    });

    it('should return false if no permissions key at all', async () => {
      const settings = { someOther: 'config' };
      await writeFile(settingsPath(workDir), JSON.stringify(settings));

      const result = await neutralizeBypassPermissions(workDir);
      expect(result).toBe(false);
    });

    it('should return false for malformed JSON', async () => {
      await writeFile(settingsPath(workDir), '{ not valid json');

      const result = await neutralizeBypassPermissions(workDir);
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

      await neutralizeBypassPermissions(workDir);

      const patched = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(patched.permissions.defaultMode).toBe('default');
      expect(patched.permissions.allow).toEqual(['Bash(*)', 'Read(*)']);
      expect(patched.model).toBe('claude-sonnet-4-20250514');
      expect(patched.env).toEqual({ DEBUG: '1' });
    });
  });

  describe('restoreSettings', () => {
    it('should restore original file from backup', async () => {
      const original = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(original));
      await neutralizeBypassPermissions(workDir);

      await restoreSettings(workDir);

      const restored = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(restored.permissions.defaultMode).toBe('bypassPermissions');
      expect(existsSync(backupPath(workDir))).toBe(false);
    });

    it('should do nothing if no backup exists', async () => {
      const settings = { permissions: { defaultMode: 'default' } };
      await writeFile(settingsPath(workDir), JSON.stringify(settings));

      await restoreSettings(workDir);

      const unchanged = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(unchanged.permissions.defaultMode).toBe('default');
    });
  });

  describe('cleanOrphanedBackup', () => {
    it('should restore orphaned backup (crash recovery)', async () => {
      // Simulate crash: backup exists but settings is patched
      const original = { permissions: { defaultMode: 'bypassPermissions' } };
      const patched = { permissions: { defaultMode: 'default' } };
      await writeFile(backupPath(workDir), JSON.stringify(original));
      await writeFile(settingsPath(workDir), JSON.stringify(patched));

      await cleanOrphanedBackup(workDir);

      const restored = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(restored.permissions.defaultMode).toBe('bypassPermissions');
      expect(existsSync(backupPath(workDir))).toBe(false);
    });

    it('should do nothing if no orphaned backup', async () => {
      await cleanOrphanedBackup(workDir);
      // Should not throw
    });
  });

  describe('path helpers', () => {
    it('settingsPath should point to .claude/settings.local.json', () => {
      expect(settingsPath('/tmp/project')).toBe('/tmp/project/.claude/settings.local.json');
    });

    it('backupPath should add .aegis-backup suffix', () => {
      expect(backupPath('/tmp/project')).toBe('/tmp/project/.claude/settings.local.json.aegis-backup');
    });
  });

  describe('edge cases', () => {
    it('should handle .claude dir not existing', async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), 'aegis-perm-empty-'));
      const result = await neutralizeBypassPermissions(emptyDir);
      expect(result).toBe(false);
      await rm(emptyDir, { recursive: true, force: true });
    });

    it('should handle concurrent neutralize+restore cycle', async () => {
      const settings = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(settings));

      // Neutralize
      const patched = await neutralizeBypassPermissions(workDir);
      expect(patched).toBe(true);

      // Verify patched
      const during = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(during.permissions.defaultMode).toBe('default');

      // Restore
      await restoreSettings(workDir);

      // Verify restored
      const after = JSON.parse(await readFile(settingsPath(workDir), 'utf-8'));
      expect(after.permissions.defaultMode).toBe('bypassPermissions');
    });
  });
});
