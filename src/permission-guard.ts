/**
 * permission-guard.ts — Guard against project-level settings overriding CLI permission mode.
 *
 * Problem: Claude Code's `.claude/settings.local.json` can set
 * `permissions.defaultMode: "bypassPermissions"` which OVERRIDES the CLI
 * `--permission-mode default` flag. When Aegis spawns a session with
 * `autoApprove: false`, the user expects permission prompts — but the
 * project-level settings silently bypass them.
 *
 * Fix: Before launching CC, if autoApprove is false, we neutralize any
 * `bypassPermissions` in the project's settings.local.json by backing it
 * up and patching the permission mode. On session cleanup we restore it.
 *
 * Issue #102 safety: Backups are stored in ~/.aegis/permission-backups/
 * instead of the project directory to prevent accidental commit of secrets.
 */

import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const SETTINGS_DIR = '.claude';
const SETTINGS_FILE = 'settings.local.json';

// Backups go to ~/.aegis/permission-backups/<hash>/ to avoid polluting project dirs
const AEGIS_DIR = join(homedir(), '.aegis');
const BACKUP_DIR = join(AEGIS_DIR, 'permission-backups');

/** Hash a workDir path to create a safe, unique backup directory name. */
function workDirHash(workDir: string): string {
  return createHash('sha256').update(workDir).digest('hex').slice(0, 16);
}

export function settingsPath(workDir: string): string {
  return join(workDir, SETTINGS_DIR, SETTINGS_FILE);
}

/** Get backup path in ~/.aegis/permission-backups/<hash>/settings.local.json */
export function backupPath(workDir: string): string {
  return join(BACKUP_DIR, workDirHash(workDir), SETTINGS_FILE);
}

/** Legacy backup path (in project dir) — for migration/cleanup. */
function legacyBackupPath(workDir: string): string {
  return settingsPath(workDir) + '.aegis-backup';
}

/**
 * If the project's settings.local.json has bypassPermissions and autoApprove
 * is false, back it up and patch to "default" mode.
 *
 * Returns true if a backup was created (and restore is needed later).
 */
export async function neutralizeBypassPermissions(workDir: string): Promise<boolean> {
  const path = settingsPath(workDir);
  if (!existsSync(path)) return false;

  try {
    const raw = await readFile(path, 'utf-8');
    const settings = JSON.parse(raw);

    // Check if permissions.defaultMode is bypassPermissions
    const mode = settings?.permissions?.defaultMode;
    if (mode !== 'bypassPermissions') return false;

    // Back up to ~/.aegis/permission-backups/<hash>/
    const backup = backupPath(workDir);
    mkdirSync(join(BACKUP_DIR, workDirHash(workDir)), { recursive: true });
    await writeFile(backup, raw);

    // Patch: remove the bypassPermissions override so CLI flag takes effect
    settings.permissions.defaultMode = 'default';
    await writeFile(path, JSON.stringify(settings, null, 2) + '\n');

    console.log(`Permission guard: neutralized bypassPermissions in ${path} (backup: ${backup})`);
    return true;
  } catch (e) {
    console.error(`Permission guard: failed to neutralize ${path}: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Restore the original settings.local.json from backup.
 * Checks new location first, then legacy location for backward compat.
 */
export async function restoreSettings(workDir: string): Promise<void> {
  const path = settingsPath(workDir);

  // Try new backup location first
  const newBackup = backupPath(workDir);
  if (existsSync(newBackup)) {
    try {
      const raw = await readFile(newBackup, 'utf-8');
      await writeFile(path, raw);
      await unlink(newBackup);
      console.log(`Permission guard: restored ${path} from backup`);
      return;
    } catch (e) {
      console.error(`Permission guard: failed to restore from ${newBackup}: ${(e as Error).message}`);
    }
  }

  // Fallback: legacy backup location (in project dir)
  const legacy = legacyBackupPath(workDir);
  if (existsSync(legacy)) {
    try {
      await rename(legacy, path);
      console.log(`Permission guard: restored ${path} from legacy backup`);
    } catch (e) {
      console.error(`Permission guard: failed to restore from legacy ${legacy}: ${(e as Error).message}`);
    }
  }
}

/**
 * Clean up any orphaned backups (e.g. from a crash).
 * Checks both new and legacy locations.
 */
export async function cleanOrphanedBackup(workDir: string): Promise<void> {
  const path = settingsPath(workDir);

  // Clean new backup
  const newBackup = backupPath(workDir);
  if (existsSync(newBackup)) {
    try {
      const raw = await readFile(newBackup, 'utf-8');
      await writeFile(path, raw);
      await unlink(newBackup);
      console.log(`Permission guard: cleaned orphaned backup for ${workDir}`);
    } catch (e) {
      console.error(`Permission guard: failed to clean orphaned backup: ${(e as Error).message}`);
    }
  }

  // Clean legacy backup
  const legacy = legacyBackupPath(workDir);
  if (existsSync(legacy)) {
    try {
      await rename(legacy, path);
      console.log(`Permission guard: cleaned legacy orphaned backup in ${workDir}`);
    } catch (e) {
      console.error(`Permission guard: failed to clean legacy orphaned backup: ${(e as Error).message}`);
    }
  }
}
