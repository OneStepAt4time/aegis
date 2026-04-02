/**
 * worktree-lookup.ts — Worktree-aware session file discovery.
 *
 * Issue #884: Extends the single-directory findSessionFile with bounded fanout
 * across sibling worktree project directories. Returns the freshest (most
 * recently modified) matching JSONL file across all candidate dirs.
 */

import { stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Expand leading ~ to home directory. */
function expandTilde(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

/**
 * Find the freshest JSONL file for a given sessionId across multiple
 * Claude projects directories.
 *
 * Search order:
 * 1. Primary directory (existing `claudeProjectsDir` — normal path)
 * 2. Sibling directories (fanout, bounded by maxCandidates)
 *
 * Returns the path with the highest mtime, or null if not found.
 * Silently ignores unreadable/missing directories.
 *
 * @param sessionId     Claude session UUID
 * @param primaryDir    Primary `~/.claude/projects` directory (searched first)
 * @param siblingDirs   Additional directories to search (fanout)
 * @param maxCandidates Upper bound on sibling candidates to evaluate (default: 5)
 */
export async function findSessionFileWithFanout(
  sessionId: string,
  primaryDir: string,
  siblingDirs: string[],
  maxCandidates = 5,
): Promise<string | null> {
  const candidates: Array<{ path: string; mtimeMs: number }> = [];

  // Helper: scan one projects dir for sessionId.jsonl files
  async function scanDir(dir: string): Promise<void> {
    const expanded = expandTilde(dir);
    if (!existsSync(expanded)) return;
    let entries;
    try {
      entries = await readdir(expanded, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return; // unreadable directory — skip
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const jsonlPath = join(expanded, entry.name, `${sessionId}.jsonl`);
      if (existsSync(jsonlPath)) {
        try {
          const { mtimeMs } = await stat(jsonlPath);
          candidates.push({ path: jsonlPath, mtimeMs });
        } catch {
          // stat failed — entry may have been deleted between existsSync and stat
        }
      }
    }
  }

  // Always scan primary first
  await scanDir(primaryDir);

  // Fanout to siblings (bounded)
  const bounded = siblingDirs.slice(0, maxCandidates);
  await Promise.all(bounded.map(d => scanDir(d)));

  if (candidates.length === 0) return null;

  // Return path with the highest mtime (freshest)
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0].path;
}
