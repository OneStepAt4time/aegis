/**
 * session/worktree.ts — Git worktree creation for session isolation.
 *
 * Issue #4694: When isolationMode is 'worktree', Aegis creates a git worktree
 * so the session operates in an isolated branch, preventing uncommitted changes
 * from polluting the main workspace.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { StructuredLogger } from '../../logger.js';

const log = new StructuredLogger();

export interface WorktreeCreationResult {
  /** Absolute path to the created worktree. */
  path: string;
  /** Branch name used for the worktree. */
  branch: string;
}

/**
 * Create a git worktree for session isolation.
 *
 * @param repoRoot - The repository root directory
 * @param sessionId - The Aegis session ID (used for branch naming)
 * @returns The worktree path and branch name
 * @throws if git operations fail
 */
export function createSessionWorktree(
  repoRoot: string,
  sessionId: string
): WorktreeCreationResult {
  const worktreeDir = join(repoRoot, '.claude', 'worktrees');
  const branch = `session/${sessionId.slice(0, 8)}`;
  const worktreePath = join(worktreeDir, sessionId.slice(0, 12));

  // Ensure the worktrees parent directory exists
  if (!existsSync(worktreeDir)) {
    mkdirSync(worktreeDir, { recursive: true });
  }

  // Check if this is a git repo
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 5_000,
    });
  } catch {
    log.warn({
      component: 'session',
      operation: 'worktreeNotARepo',
      attributes: { repoRoot },
    });
    // Not a git repo — can't create worktree, return original dir
    return { path: repoRoot, branch: '' };
  }

  // Check if worktree already exists for this session
  if (existsSync(worktreePath)) {
    log.info({
      component: 'session',
      operation: 'worktreeReused',
      attributes: { sessionId, worktreePath },
    });
    return { path: worktreePath, branch };
  }

  // Create worktree from current HEAD
  const baseBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 5_000,
  }).trim();

  try {
    execFileSync('git', [
      'worktree', 'add',
      '-b', branch,
      worktreePath,
      baseBranch,
    ], {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 30_000,
    });

    log.info({
      component: 'session',
      operation: 'worktreeCreated',
      attributes: { sessionId, worktreePath, branch, baseBranch },
    });

    return { path: worktreePath, branch };
  } catch (err) {
    log.warn({
      component: 'session',
      operation: 'worktreeCreationFailed',
      attributes: { sessionId, error: String(err) },
    });
    // Fallback: return original dir (session works without isolation)
    return { path: repoRoot, branch: '' };
  }
}

/**
 * Remove a session worktree after the session ends.
 *
 * @param repoRoot - The repository root directory
 * @param worktreePath - The worktree path to remove
 * @param branch - The branch to delete
 */
export function removeSessionWorktree(
  repoRoot: string,
  worktreePath: string,
  branch: string
): void {
  if (!worktreePath || worktreePath === repoRoot) return;

  try {
    execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 10_000,
    });

    if (branch) {
      execFileSync('git', ['branch', '-D', branch], {
        cwd: repoRoot,
        stdio: 'pipe',
        timeout: 5_000,
      });
    }

    log.info({
      component: 'session',
      operation: 'worktreeRemoved',
      attributes: { worktreePath, branch },
    });
  } catch (err) {
    log.warn({
      component: 'session',
      operation: 'worktreeRemovalFailed',
      attributes: { worktreePath, error: String(err) },
    });
  }
}
