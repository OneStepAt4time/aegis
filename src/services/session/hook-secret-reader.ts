/**
 * hook-secret-reader.ts — Extract hook secrets from CC settings files.
 *
 * Reads the hook settings JSON written by Aegis and extracts the
 * X-Hook-Secret header value used to validate inbound hook callbacks.
 */

import { readFile } from 'node:fs/promises';

/** Check whether a value is a plain Record<string, unknown>. */
function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read and parse a CC hook settings file, extracting the first
 * `X-Hook-Secret` header value found.
 *
 * @param settingsPath — Absolute path to the hook settings JSON file.
 * @returns The secret string, or `undefined` if not found / file unreadable.
 */
export async function readHookSecretFromSettingsFile(
  settingsPath: string,
): Promise<string | undefined> {
  try {
    const raw = await readFile(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isObjectRecord(parsed) || !isObjectRecord(parsed.hooks)) return undefined;

    for (const eventEntries of Object.values(parsed.hooks)) {
      if (!Array.isArray(eventEntries)) continue;
      for (const entry of eventEntries) {
        if (!isObjectRecord(entry) || !Array.isArray(entry.hooks)) continue;
        for (const hook of entry.hooks) {
          if (!isObjectRecord(hook) || !isObjectRecord(hook.headers)) continue;
          const secret = hook.headers['X-Hook-Secret'];
          if (typeof secret === 'string' && secret.length > 0) {
            return secret;
          }
        }
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}
