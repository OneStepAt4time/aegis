/**
 * hook-settings.ts — Generate CC settings.json with HTTP hooks for Aegis.
 *
 * When Aegis creates a CC session, it writes a per-session settings file
 * that configures HTTP hooks pointing to Aegis's hook receiver endpoint.
 * The file is passed to CC via the `--settings` CLI flag.
 *
 * Only events that support `type: "http"` hooks are included:
 *   Stop, PreToolUse, PostToolUse, PermissionRequest, TaskCompleted
 *
 * Events like Notification, SessionEnd, etc. only support `type: "command"`
 * and are excluded.
 *
 * Issue #169: Phase 2 — Inject CC settings.json with HTTP hooks.
 */

import { readFile, writeFile, unlink, mkdir, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { ccSettingsSchema, containsTraversalSegment } from './validation.js';
import { secureFilePermissions } from './file-utils.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSettingsWithFallback(raw: string): Record<string, unknown> | undefined {
  // Windows editors may write UTF-8 BOM; strip it so JSON.parse does not fail.
  const json = JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown;
  if (!isRecord(json)) return undefined;

  const parsed = ccSettingsSchema.safeParse(json);
  if (parsed.success) return parsed.data;

  // Preserve unknown/extra fields (including env vars) even when schema validation fails.
  return json;
}

function normalizeHookBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (url.hostname === '0.0.0.0' || url.hostname === '::' || url.hostname === '[::]') {
      url.hostname = '127.0.0.1';
    }
    return url.origin;
  } catch {
    return baseUrl.replace('0.0.0.0', '127.0.0.1');
  }
}

/** Build a normalized path to .claude/settings.local.json for Unix and Windows workDirs. */
export function buildProjectSettingsPath(
  workDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  let normalizedWorkDir = platform === 'win32'
    ? workDir.replace(/\//g, '\\')
    : workDir.replace(/\\/g, '/');
  // On Linux, resolve() prepends CWD to Windows paths like "D:\Users\dev"
  // because Linux doesn't understand Windows drive letters. Only resolve
  // paths that are NOT already absolute on the target platform.
  const isWinAbs = /^[A-Za-z]:\\/.test(normalizedWorkDir);
  const isUnixAbs = /^\//.test(normalizedWorkDir);
  const alreadyAbs = (platform === 'win32' && isWinAbs) || isUnixAbs;
  if (!alreadyAbs) normalizedWorkDir = resolve(normalizedWorkDir);
  // Normalize separators to match the target platform.
  const result = join(normalizedWorkDir, '.claude', 'settings.local.json');
  return platform === 'win32' ? result.replace(/\//g, '\\') : result;
}

/**
 * Validate a workDir path for use in hook settings resolution.
 * Defense-in-depth against path traversal: rejects paths containing ".." segments
 * or that resolve outside the provided workDir.
 *
 * @returns Sanitized absolute path, or undefined if validation fails.
 */
function validateWorkDirPath(workDir: string): string | undefined {
  if (containsTraversalSegment(workDir)) return undefined;
  return resolve(workDir);
}

/** CC hook events that support `type: "http"`.
 *
 * All CC hook events support HTTP hooks. We register the most useful ones
 * for Aegis status detection and event forwarding.
 *
 * Excluded (low value for Aegis):
 *   - InstructionsLoaded, ConfigChange (informational)
 *   - WorktreeCreate, WorktreeRemove (worktree management)
 *   - Elicitation, ElicitationResult (MCP-specific)
 */
const HTTP_HOOK_EVENTS = [
  // Status detection (highest value)
  'Stop',
  'StopFailure',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'TaskCompleted',
  // Session lifecycle
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  // Subagent tracking
  'SubagentStart',
  'SubagentStop',
  // Context management
  'PreCompact',
  'PostCompact',
  // File & directory changes
  'FileChanged',
  'CwdChanged',
  // Notifications
  'Notification',
  'TeammateIdle',
  // Worktree management (only Create/Remove — *Failed variants don't exist in CC, see #1002)
  'WorktreeCreate',
  'WorktreeRemove',
  // Elicitation
  'Elicitation',
  'ElicitationResult',
] as const;

export { HTTP_HOOK_EVENTS };

export type HttpHookEvent = typeof HTTP_HOOK_EVENTS[number];

/** Shape of a single HTTP hook entry in CC settings.json. */
interface HttpHookConfig {
  type: 'http';
  url: string;
}

/** Shape of the `hooks` section in CC settings.json. */
export interface HookSettings {
  hooks: Record<string, Array<{ matcher?: string; hooks: HttpHookConfig[] }>>;
}

/**
 * Generate the hooks section of a CC settings.json for a given session.
 *
 * @param baseUrl - Aegis base URL (e.g. "http://localhost:9100")
 * @param sessionId - Aegis session ID (used as query param for routing)
 * @param hookSecret - Per-session secret for hook URL authentication (Issue #629)
 */
export function generateHookSettings(baseUrl: string, sessionId: string, hookSecret?: string): HookSettings {
  const hooks: HookSettings['hooks'] = {};
  const callbackBaseUrl = normalizeHookBaseUrl(baseUrl);

  for (const event of HTTP_HOOK_EVENTS) {
    const secretParam = hookSecret ? `&secret=${hookSecret}` : '';
    hooks[event] = [
      {
        hooks: [
          {
            type: 'http',
            url: `${callbackBaseUrl}/v1/hooks/${event}?sessionId=${sessionId}${secretParam}`,
          },
        ],
      },
    ];
  }

  return { hooks };
}

/**
 * Write hook settings to a temporary file and return its path.
 *
 * Issue #339: Reads .claude/settings.local.json from workDir and deep-merges
 * hook settings into it, so CC gets both project settings (env vars, permissions,
 * bypassPermissions) AND Aegis hooks in a single --settings file.
 *
 * @param baseUrl - Aegis base URL
 * @param sessionId - Aegis session ID
 * @param workDir - Project working directory (to read settings.local.json from)
 * @returns Path to the temporary settings file
 */
export async function writeHookSettingsFile(baseUrl: string, sessionId: string, hookSecret: string, workDir?: string): Promise<string> {
  const hookSettings = generateHookSettings(baseUrl, sessionId, hookSecret);

  // Issue #339: Read project's settings.local.json and merge hooks into it.
  // This ensures CC gets env vars, permissions, and bypassPermissions alongside hooks.
  // Issue #847: Validate workDir path to prevent traversal attacks.
  let merged: Record<string, unknown> = {};
  const safeWorkDir = workDir ? validateWorkDirPath(workDir) : undefined;
  if (safeWorkDir) {
    const projectSettingsPath = buildProjectSettingsPath(safeWorkDir);
    if (existsSync(projectSettingsPath)) {
      try {
        const raw = await readFile(projectSettingsPath, 'utf-8');
        merged = parseSettingsWithFallback(raw) ?? {};
      } catch {
        // Malformed settings file — use empty base, hooks will still work
      }
    }
  }

  // Deep-merge: project settings as base, hooks merged by event key so both
  // project-level and Aegis hooks coexist (Issue #635).
  const existingHooks = (merged.hooks as Record<string, Array<unknown>>) ?? {};
  const mergedHooks: Record<string, Array<unknown>> = { ...existingHooks };
  for (const [event, entries] of Object.entries(hookSettings.hooks)) {
    mergedHooks[event] = [...(existingHooks[event] ?? []), ...entries];
  }

  const combined: Record<string, unknown> = { ...merged, hooks: mergedHooks };

  // Issue #931: Always inject MCP_CONNECTION_NONBLOCKING so CC does not block
  // on MCP server connections when launched via Aegis orchestration.
  ((combined as Record<string, unknown>).env = (combined.env || {}) as Record<string, string>);
  ((combined.env || {}) as Record<string, string>)["MCP_CONNECTION_NONBLOCKING"] = "true";

  // Issue #648: Use unpredictable directory name and restrictive permissions
  // to prevent symlink attacks and information disclosure in /tmp.
  const suffix = randomBytes(4).toString('hex');
  const settingsDir = join(tmpdir(), `aegis-hooks-${suffix}`);

  await mkdir(settingsDir, { recursive: true, mode: 0o700 });

  const filePath = join(settingsDir, `hooks-${sessionId}.json`);
  await writeFile(filePath, JSON.stringify(combined, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  await secureFilePermissions(filePath);

  return filePath;
}

/**
 * Clean up a hook settings temp file.
 *
 * @param filePath - Path to the temporary settings file
 */
export async function cleanupHookSettingsFile(filePath: string): Promise<void> {
  try {
    if (existsSync(filePath)) {
      await unlink(filePath);
      // Issue #648: Also remove the randomized parent directory
      const parentDir = join(filePath, '..');
      await rmdir(parentDir).catch(() => {
        // Non-fatal: directory may not be empty or already removed
      });
    }
  } catch {
    // Non-fatal: temp file cleanup failed
  }
}

/**
 * Issue #936: Clean stale session hooks from settings.local.json before writing new hooks.
 *
 * When sessions die, their hook URLs remain in settings.local.json.
 * On restart, CC loads these dead hooks and crashes.
 *
 * @param workDir - Project working directory
 * @param activeSessionIds - Set of currently active session IDs
 */
export async function cleanupStaleSessionHooks(
  workDir: string,
  activeSessionIds: Set<string>
): Promise<void> {
  const safeWorkDir = workDir ? validateWorkDirPath(workDir) : undefined;
  if (!safeWorkDir) return;

  const projectSettingsPath = buildProjectSettingsPath(safeWorkDir);
  if (!existsSync(projectSettingsPath)) return;

  try {
    const raw = await readFile(projectSettingsPath, 'utf-8');
    const parsed = ccSettingsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return;

    const settings = parsed.data;
    const hooks = settings.hooks as Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; url: string }> }>> | undefined;
    if (!hooks) return;

    let changed = false;
    for (const [event, eventHooks] of Object.entries(hooks)) {
      const filtered = eventHooks.filter(entry => {
        const httpHook = entry.hooks?.find(h => h.type === 'http');
        if (!httpHook) return true;
        const url = httpHook.url;
        const match = url.match(/[?&]sessionId=([^&]+)/);
        if (!match) return true;
        const sessionId = match[1];
        if (!activeSessionIds.has(sessionId)) {
          changed = true;
          return false;
        }
        return true;
      });
      (hooks as Record<string, unknown>)[event] = filtered;
    }

    if (changed) {
      await writeFile(projectSettingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
      await secureFilePermissions(projectSettingsPath);
    }
  } catch {
    // Non-fatal: cleanup failed
  }
}
