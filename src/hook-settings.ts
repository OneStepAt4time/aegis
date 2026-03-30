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

import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ccSettingsSchema } from './validation.js';

/** CC hook events that support `type: "http"`.
 *
 * All CC hook events support HTTP hooks. We register the most useful ones
 * for Aegis status detection and event forwarding.
 *
 * Excluded (low value for Aegis):
 *   - InstructionsLoaded, ConfigChange, CwdChanged, FileChanged (informational)
 *   - WorktreeCreate, WorktreeRemove (worktree management)
 *   - Elicitation, ElicitationResult (MCP-specific)
 *   - PreCompact, PostCompact (internal optimization)
 */
const HTTP_HOOK_EVENTS = [
  // Status detection (highest value)
  'Stop',
  // NOTE: StopFailure is excluded — not recognized by older CC versions (e.g. 2.1.63).
  // Internal StopFailure handling in hook.ts/hooks.ts/monitor.ts/session.ts remains intact;
  // those detect StopFailure from the Stop hook's response body, not from a CC settings hook.
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
  // Notifications
  'Notification',
  'TeammateIdle',
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
 */
export function generateHookSettings(baseUrl: string, sessionId: string): HookSettings {
  const hooks: HookSettings['hooks'] = {};

  for (const event of HTTP_HOOK_EVENTS) {
    hooks[event] = [
      {
        hooks: [
          {
            type: 'http',
            url: `${baseUrl}/v1/hooks/${event}?sessionId=${sessionId}`,
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
export async function writeHookSettingsFile(baseUrl: string, sessionId: string, workDir?: string): Promise<string> {
  const hookSettings = generateHookSettings(baseUrl, sessionId);

  // Issue #339: Read project's settings.local.json and merge hooks into it.
  // This ensures CC gets env vars, permissions, and bypassPermissions alongside hooks.
  let merged: Record<string, unknown> = {};
  if (workDir) {
    const projectSettingsPath = join(workDir, '.claude', 'settings.local.json');
    if (existsSync(projectSettingsPath)) {
      try {
        const raw = await readFile(projectSettingsPath, 'utf-8');
        const parsed = ccSettingsSchema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          merged = parsed.data;
        }
      } catch {
        // Malformed settings file — use empty base, hooks will still work
      }
    }
  }

  // Deep-merge: project settings as base, hook settings override
  const combined = {
    ...merged,
    hooks: {
      ...((merged.hooks as Record<string, unknown>) ?? {}),
      ...hookSettings.hooks,
    },
  };

  const settingsDir = join(tmpdir(), 'aegis-hooks');

  if (!existsSync(settingsDir)) {
    await mkdir(settingsDir, { recursive: true });
  }

  const filePath = join(settingsDir, `hooks-${sessionId}.json`);
  await writeFile(filePath, JSON.stringify(combined, null, 2) + '\n', 'utf-8');

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
    }
  } catch {
    // Non-fatal: temp file cleanup failed
  }
}
