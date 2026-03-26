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

import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

/** CC hook events that support `type: "http"`. */
const HTTP_HOOK_EVENTS = [
  'Stop',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'TaskCompleted',
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
 * @param baseUrl - Aegis base URL
 * @param sessionId - Aegis session ID
 * @returns Path to the temporary settings file
 */
export async function writeHookSettingsFile(baseUrl: string, sessionId: string): Promise<string> {
  const settings = generateHookSettings(baseUrl, sessionId);
  const settingsDir = join(tmpdir(), 'aegis-hooks');

  if (!existsSync(settingsDir)) {
    await mkdir(settingsDir, { recursive: true });
  }

  const filePath = join(settingsDir, `hooks-${sessionId}.json`);
  await writeFile(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

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
