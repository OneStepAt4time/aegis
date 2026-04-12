/**
 * platform/shell.ts — Cross-platform shell execution abstraction.
 *
 * Centralises all platform-specific shell logic so the rest of the codebase
 * never needs to branch on `process.platform` for command execution.
 *
 * Issue #1694 / ARC-1
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);

// ── Shell quoting ────────────────────────────────────────────────────

/** Escape a value for POSIX sh single-quoting. */
export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Escape a value for PowerShell single-quoting. */
export function powerShellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Return a shell-quoted string appropriate for the current platform. */
export function quoteShellArg(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32' ? powerShellSingleQuote(value) : shellEscape(value);
}

// ── Launch command wrapper ───────────────────────────────────────────

/** Build the platform-specific launch wrapper that clears inherited tmux vars. */
export function buildClaudeLaunchCommand(
  baseCommand: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    return `Remove-Item Env:TMUX -ErrorAction SilentlyContinue; Remove-Item Env:TMUX_PANE -ErrorAction SilentlyContinue; ${baseCommand}`;
  }
  return `unset TMUX TMUX_PANE && exec ${baseCommand}`;
}

// ── Script execution ─────────────────────────────────────────────────

export interface RunScriptOptions {
  timeoutMs?: number;
}

/**
 * Execute a batch of shell commands written to a temporary script file.
 *
 * On POSIX: writes a `.sh` file and runs it with `sh`.
 * On Windows: writes a `.ps1` file and runs it with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File`.
 *
 * The temp file is always deleted afterwards.
 */
export async function runShellScript(
  lines: string[],
  opts: RunScriptOptions = {},
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const isWin = platform === 'win32';
  const ext = isWin ? '.ps1' : '.sh';
  const scriptPath = join(tmpdir(), `aegis-batch-${process.pid}${ext}`);

  try {
    await writeFile(scriptPath, lines.join('\n') + '\n');

    if (isWin) {
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { timeout: timeoutMs },
      );
    } else {
      await execFileAsync('sh', [scriptPath], { timeout: timeoutMs });
    }
  } finally {
    try { await unlink(scriptPath); } catch { /* ignore cleanup errors */ }
  }
}

// ── Process inspection ───────────────────────────────────────────

/**
 * Check whether a process with the given PID is alive.
 *
 * - POSIX: `kill -0` + `/proc/<pid>/stat` zombie check.
 * - Windows: `kill -0` (signal 0 still works in Node on Windows for local
 *   processes). No zombie concept exists on Windows.
 */
export function isPidAlive(pid: number, platform: NodeJS.Platform = process.platform): boolean {
  try {
    process.kill(pid, 0);

    if (platform === 'win32') {
      // Windows has no zombie state — if kill(0) succeeds, the process is alive.
      return true;
    }

    // POSIX: check for zombie via /proc
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const match = stat.match(/^\d+ \([^)]+\) ([A-Z])/);
      if (match && match[1] === 'Z') return false; // Zombie = effectively dead
    } catch {
      // /proc check failed — process may have exited between kill(0) and read.
      // Conservative: treat as alive since kill(0) succeeded.
    }

    return true;
  } catch {
    // ESRCH — process does not exist
    return false;
  }
}
