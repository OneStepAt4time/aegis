import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import type { z } from 'zod';
import { sessionMapEntrySchema } from './validation.js';
import { safeJsonParse } from './safe-json.js';

export type ContinuationPointerEntry = z.infer<typeof sessionMapEntrySchema>;

function computeExpiresAt(entry: ContinuationPointerEntry, ttlMs: number): number {
  if (typeof entry.expires_at === 'number') {
    return entry.expires_at;
  }
  return entry.written_at + ttlMs;
}

async function persistPointerMap(
  sessionMapFile: string,
  mapData: Record<string, ContinuationPointerEntry>,
): Promise<void> {
  const tmpFile = `${sessionMapFile}.tmp`;
  await writeFile(tmpFile, JSON.stringify(mapData, null, 2));
  await rename(tmpFile, sessionMapFile);
}

/**
 * Read continuation pointers with schema validation + TTL cleanup.
 *
 * Backward compatible behavior:
 * - Legacy entries without expires_at are accepted and normalized.
 * - Corrupt files do not throw; they are reset to an empty map.
 */
export async function loadContinuationPointers(
  sessionMapFile: string,
  ttlMs: number,
  nowMs = Date.now(),
): Promise<Record<string, ContinuationPointerEntry>> {
  if (!existsSync(sessionMapFile)) return {};

  let parsed: unknown;
  const raw = await readFile(sessionMapFile, 'utf-8');
  const parsedResult = safeJsonParse(raw, 'Continuation pointer map');
  if (!parsedResult.ok) {
    await persistPointerMap(sessionMapFile, {});
    return {};
  }
  parsed = parsedResult.data;

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    await persistPointerMap(sessionMapFile, {});
    return {};
  }

  const cleaned: Record<string, ContinuationPointerEntry> = {};
  let changed = false;

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entryResult = sessionMapEntrySchema.safeParse(value);
    if (!entryResult.success) {
      changed = true;
      continue;
    }

    const entry = entryResult.data;
    const expiresAt = computeExpiresAt(entry, ttlMs);
    if (expiresAt <= nowMs) {
      changed = true;
      continue;
    }

    if (entry.expires_at !== expiresAt || entry.schema_version !== 1) {
      changed = true;
    }

    cleaned[key] = {
      ...entry,
      schema_version: 1,
      expires_at: expiresAt,
    };
  }

  if (changed) {
    await persistPointerMap(sessionMapFile, cleaned);
  }

  return cleaned;
}
