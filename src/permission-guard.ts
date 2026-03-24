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
 */

import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SETTINGS_DIR = '.claude';
const SETTINGS_FILE = 'settings.local.json';
const BACKUP_SUFFIX = '.aegis-backup';

export function settingsPath(workDir: string): string {
  return join(workDir, SETTINGS_DIR, SETTINGS_FILE);
}

export function backupPath(workDir: string): string {
  return settingsPath(workDir) + BACKUP_SUFFIX;
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

    // Back up the original file (atomic rename)
    const backup = backupPath(workDir);
    await writeFile(backup, raw);

    // Patch: remove the bypassPermissions override so CLI flag takes effect
    settings.permissions.defaultMode = 'default';
    await writeFile(path, JSON.stringify(settings, null, 2) + '\n');

    console.log(`Permission guard: neutralized bypassPermissions in ${path}`);
    return true;
  } catch (e) {
    console.error(`Permission guard: failed to neutralize ${path}: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Restore the original settings.local.json from backup.
 */
export async function restoreSettings(workDir: string): Promise<void> {
  const backup = backupPath(workDir);
  const path = settingsPath(workDir);

  if (!existsSync(backup)) return;

  try {
    await rename(backup, path);
    console.log(`Permission guard: restored ${path} from backup`);
  } catch (e) {
    console.error(`Permission guard: failed to restore ${path}: ${(e as Error).message}`);
  }
}

/**
 * Clean up any orphaned backups (e.g. from a crash).
 * Call on startup for all known workDirs if needed.
 */
export async function cleanOrphanedBackup(workDir: string): Promise<void> {
  const backup = backupPath(workDir);
  if (!existsSync(backup)) return;

  try {
    // Restore — the user's original settings should be preserved
    await rename(backup, settingsPath(workDir));
    console.log(`Permission guard: cleaned orphaned backup in ${workDir}`);
  } catch (e) {
    console.error(`Permission guard: failed to clean orphaned backup: ${(e as Error).message}`);
  }
}
