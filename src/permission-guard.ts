/**
 * permission-guard.ts — Guard against settings overriding CLI permission mode.
 *
 * Problem: Claude Code checks settings in 3 locations (priority order):
 *   1. ~/.claude/settings.json (user-level)
 *   2. <project>/.claude/settings.json (project-level, committed)
 *   3. <project>/.claude/settings.local.json (project-level, local)
 *
 * Any of these can set `permissions.defaultMode: "bypassPermissions"` which
 * OVERRIDES the CLI `--permission-mode default` flag. When Aegis spawns a
 * session with autoApprove: false, the user expects permission prompts — but
 * the settings silently bypass them.
 *
 * Fix: Before launching CC, if autoApprove is false, we neutralize any
 * `bypassPermissions` in ALL 3 settings files by backing them up and patching
 * the permission mode. On session cleanup we restore them.
 *
 * Issue #102 safety: Backups are stored in ~/.aegis/permission-backups/
 * instead of the project directory to prevent accidental commit of secrets.
 */

import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { ccSettingsSchema } from './validation.js';

const SETTINGS_DIR = '.claude';
const LOCAL_SETTINGS_FILE = 'settings.local.json';
const PROJECT_SETTINGS_FILE = 'settings.json';

/** Hash a workDir path to create a safe, unique backup directory name. */
function workDirHash(workDir: string): string {
  return createHash('sha256').update(workDir).digest('hex').slice(0, 16);
}

// ─── Path helpers ───

/** Location 3: project-level local settings */
export function settingsPath(workDir: string): string {
  return join(workDir, SETTINGS_DIR, LOCAL_SETTINGS_FILE);
}

/** Location 2: project-level committed settings */
export function projectSettingsPath(workDir: string): string {
  return join(workDir, SETTINGS_DIR, PROJECT_SETTINGS_FILE);
}

/** Location 1: user-level settings. Accepts optional homeDir for test isolation. */
export function userSettingsPath(homeDir?: string): string {
  return join(homeDir ?? homedir(), SETTINGS_DIR, PROJECT_SETTINGS_FILE);
}

/** Backup directory for a given workDir. Accepts optional homeDir for test isolation. */
export function backupDirForWorkDir(workDir: string, homeDir?: string): string {
  const aegisDir = join(homeDir ?? homedir(), '.aegis');
  return join(aegisDir, 'permission-backups', workDirHash(workDir));
}

/** Get backup path for settings.local.json. Accepts optional homeDir for test isolation. */
export function backupPath(workDir: string, homeDir?: string): string {
  return join(backupDirForWorkDir(workDir, homeDir), LOCAL_SETTINGS_FILE);
}

/** Legacy backup path (in project dir) — for migration/cleanup. */
function legacyBackupPath(workDir: string): string {
  return settingsPath(workDir) + '.aegis-backup';
}

/** User-level backup directory. */
function userBackupDir(homeDir: string): string {
  return join(homeDir, '.aegis', 'permission-backups', '_user_');
}

/** All settings locations that could contain bypassPermissions. */
function getAllSettingsLocations(workDir: string, homeDir: string): Array<{ filePath: string; backupPath: string }> {
  return [
    // Location 1: user-level
    { filePath: userSettingsPath(homeDir), backupPath: join(userBackupDir(homeDir), PROJECT_SETTINGS_FILE) },
    // Location 2: project-level committed
    { filePath: projectSettingsPath(workDir), backupPath: join(backupDirForWorkDir(workDir, homeDir), PROJECT_SETTINGS_FILE) },
    // Location 3: project-level local
    { filePath: settingsPath(workDir), backupPath: backupPath(workDir, homeDir) },
  ];
}

/**
 * Check a single settings file for bypassPermissions, back it up, and patch it.
 * Returns true if the file was patched.
 */
async function neutralizeOneFile(filePath: string, bpPath: string, targetMode: string): Promise<boolean> {
  if (!existsSync(filePath)) return false;

  try {
    const raw = await readFile(filePath, 'utf-8');
    const settingsParsed = ccSettingsSchema.safeParse(JSON.parse(raw));
    if (!settingsParsed.success) return false;
    const settings = settingsParsed.data;

    const mode = settings?.permissions?.defaultMode;
    if (mode !== 'bypassPermissions') return false;

    // Back up
    mkdirSync(join(bpPath, '..'), { recursive: true });
    await writeFile(bpPath, raw);

    // Patch
    if (!settings.permissions) settings.permissions = {};
    settings.permissions.defaultMode = targetMode;
    await writeFile(filePath, JSON.stringify(settings, null, 2) + '\n');

    console.log(`Permission guard: neutralized bypassPermissions in ${filePath} (backup: ${bpPath})`);
    return true;
  } catch (e) {
    console.error(`Permission guard: failed to neutralize ${filePath}: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Check all 3 CC settings locations for bypassPermissions. Back up and patch
 * any that have it. Returns true if ANY file was patched.
 *
 * @param homeDir - Override home directory (for test isolation). Defaults to os.homedir().
 */
export async function neutralizeBypassPermissions(workDir: string, targetMode = 'default', homeDir?: string): Promise<boolean> {
  const locations = getAllSettingsLocations(workDir, homeDir ?? homedir());
  let anyPatched = false;

  for (const loc of locations) {
    const patched = await neutralizeOneFile(loc.filePath, loc.backupPath, targetMode);
    if (patched) anyPatched = true;
  }

  return anyPatched;
}

/**
 * Restore a single settings file from its backup.
 */
async function restoreOneFile(filePath: string, bpPath: string): Promise<boolean> {
  if (!existsSync(bpPath)) return false;

  try {
    const raw = await readFile(bpPath, 'utf-8');
    await writeFile(filePath, raw);
    await unlink(bpPath);
    console.log(`Permission guard: restored ${filePath} from backup`);
    return true;
  } catch (e) {
    console.error(`Permission guard: failed to restore from ${bpPath}: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Restore all 3 settings files from backups.
 * Checks new backup locations first, then legacy location for backward compat.
 *
 * @param homeDir - Override home directory (for test isolation). Defaults to os.homedir().
 */
export async function restoreSettings(workDir: string, homeDir?: string): Promise<void> {
  const locations = getAllSettingsLocations(workDir, homeDir ?? homedir());

  for (const loc of locations) {
    await restoreOneFile(loc.filePath, loc.backupPath);
  }

  // Legacy fallback for settings.local.json only (in project dir)
  const legacy = legacyBackupPath(workDir);
  if (existsSync(legacy)) {
    try {
      await rename(legacy, settingsPath(workDir));
      console.log(`Permission guard: restored ${settingsPath(workDir)} from legacy backup`);
    } catch (e) {
      console.error(`Permission guard: failed to restore from legacy ${legacy}: ${(e as Error).message}`);
    }
  }
}

/**
 * Clean up any orphaned backups (e.g. from a crash).
 * Restores all 3 settings files from their backups.
 *
 * @param homeDir - Override home directory (for test isolation). Defaults to os.homedir().
 */
export async function cleanOrphanedBackup(workDir: string, homeDir?: string): Promise<void> {
  const locations = getAllSettingsLocations(workDir, homeDir ?? homedir());

  for (const loc of locations) {
    if (!existsSync(loc.backupPath)) continue;
    try {
      const raw = await readFile(loc.backupPath, 'utf-8');
      await writeFile(loc.filePath, raw);
      await unlink(loc.backupPath);
      console.log(`Permission guard: cleaned orphaned backup for ${loc.filePath}`);
    } catch (e) {
      console.error(`Permission guard: failed to clean orphaned backup: ${(e as Error).message}`);
    }
  }

  // Clean legacy backup
  const legacy = legacyBackupPath(workDir);
  if (existsSync(legacy)) {
    try {
      await rename(legacy, settingsPath(workDir));
      console.log(`Permission guard: cleaned legacy orphaned backup in ${workDir}`);
    } catch (e) {
      console.error(`Permission guard: failed to clean legacy orphaned backup: ${(e as Error).message}`);
    }
  }
}
