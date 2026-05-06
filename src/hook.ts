#!/usr/bin/env node
/**
 * hook.ts — Claude Code SessionStart hook for Aegis.
 * 
 * Writes session_id → window_id mapping to ~/.aegis/session_map.json.
 * Falls back to ~/.manus/ for backward compatibility.
 * Called by CC's hook system, reads payload from stdin.
 * 
 * Install: add to ~/.claude/settings.json:
 * {
 *   "hooks": {
 *     "SessionStart": [{
 *       "hooks": [{ "type": "command", "command": "node /path/to/dist/hook.js", "timeout": 5 }]
 *     }]
 *   }
 * }
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, lstatSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { stopSignalsSchema, stopPayloadSchema } from './validation.js';
import { safeJsonParse, safeJsonParseSchema } from './safe-json.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use ~/.aegis if it exists, fall back to ~/.manus for backward compat
const AEGIS_DIR = join(homedir(), '.aegis');
const MANUS_DIR = join(homedir(), '.manus');
const BRIDGE_DIR = existsSync(AEGIS_DIR) ? AEGIS_DIR : MANUS_DIR;
const LOCK_ACQUIRE_TIMEOUT_MS = 2_000;
const LOCK_RETRY_DELAY_MS = 25;
const COMMAND_PATH_CONTROL_CHARS_RE = /[\u0000\r\n]/;

function normalizeCommandPath(pathValue: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? pathValue.replace(/\//g, '\\') : pathValue.replace(/\\/g, '/');
}

function assertCommandPathSafe(pathValue: string): void {
  if (COMMAND_PATH_CONTROL_CHARS_RE.test(pathValue)) {
    throw new Error('Hook command paths must not contain control characters');
  }
}

function quoteCommandPath(pathValue: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = normalizeCommandPath(pathValue, platform);
  assertCommandPathSafe(normalized);

  if (platform === 'win32') {
    if (normalized.includes('"')) {
      throw new Error('Hook command paths must not contain double quotes on Windows');
    }
    const escaped = normalized
      .replace(/%/g, '%%')
      .replace(/!/g, '^!');
    return `"${escaped}"`;
  }

  const escaped = normalized.replace(/'/g, `'\"'\"'`);
  return `'${escaped}'`;
}

/** Build a shell-safe command string that invokes hook.js with an explicit Node executable. */
export function buildHookCommand(
  scriptPath: string,
  nodeExecutable: string = process.execPath,
  platform: NodeJS.Platform = process.platform,
): string {
  return `${quoteCommandPath(nodeExecutable, platform)} ${quoteCommandPath(scriptPath, platform)}`;
}

function sleepSync(ms: number): void {
  const blocker = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(blocker, 0, 0, ms);
}

export function assertPathNotSymlink(pathValue: string): void {
  if (!existsSync(pathValue)) return;
  const stats = lstatSync(pathValue);
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to operate on symlink path: ${pathValue}`);
  }
}

export function withLockFile<T>(lockFile: string, fn: () => T, timeoutMs: number = LOCK_ACQUIRE_TIMEOUT_MS): T {
  const start = Date.now();
  while (true) {
    try {
      const fd = openSync(lockFile, 'wx');
      try {
        return fn();
      } finally {
        closeSync(fd);
        try { unlinkSync(lockFile); } catch { /* ignore lock cleanup errors */ }
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') throw error;
      if (Date.now() - start >= timeoutMs) {
        throw new Error(`Timed out waiting for lock: ${lockFile}`);
      }
      sleepSync(LOCK_RETRY_DELAY_MS);
    }
  }
}

function writeTextAtomic(targetPath: string, content: string): void {
  const parentDir = dirname(targetPath);
  mkdirSync(parentDir, { recursive: true });
  assertPathNotSymlink(parentDir);
  assertPathNotSymlink(targetPath);
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  assertPathNotSymlink(tmpPath);
  try {
    writeFileSync(tmpPath, content, { mode: 0o600 });
    renameSync(tmpPath, targetPath);
  } finally {
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch { /* ignore tmp cleanup errors */ }
    }
  }
}

/** Handle Stop/StopFailure events.
 *  Writes a signal file that the Aegis monitor can detect.
 *  Issue #15: StopFailure fires on API errors (rate limit, auth failure).
 */
function handleStopEvent(
  sessionId: string,
  event: string,
  payload: Record<string, unknown>,
): void {
  const signalFile = join(BRIDGE_DIR, 'stop_signals.json');
  assertPathNotSymlink(BRIDGE_DIR);
  withLockFile(`${signalFile}.lock`, () => {
    let signals: Record<string, unknown> = {};
    if (existsSync(signalFile)) {
      const parsed = safeJsonParseSchema(readFileSync(signalFile, 'utf-8'), stopSignalsSchema, 'stop_signals.json');
      if (parsed.ok) {
        signals = parsed.data;
      } else {
        console.warn(`${parsed.error}; starting fresh`);
      }
    }

    const p = stopPayloadSchema.safeParse(payload);
    const pd = p.success ? p.data : {};
    signals[sessionId] = {
      event,
      timestamp: Date.now(),
      // StopFailure may include error info in the payload
      error: pd.error ?? pd.message ?? null,
      error_details: pd.error_details ?? null,
      last_assistant_message: pd.last_assistant_message ?? null,
      agent_id: pd.agent_id ?? null,
      stop_reason: pd.stop_reason ?? null,
    };

    writeTextAtomic(signalFile, JSON.stringify(signals, null, 2));
  });
  console.error(`Aegis hook: ${event} for session ${sessionId.slice(0, 8)}...`);
}

export function main(): void {
  // Check for --install flag
  if (process.argv.includes('--install')) {
    install();
    return;
  }

  // Read payload from stdin
  let payload: {
    session_id?: string;
    cwd?: string;
    hook_event_name?: string;
    transcript_path?: string;
    permission_mode?: string;
    agent_id?: string;
    source?: string;         // startup | resume | clear | compact
    agent_type?: string;
    model?: string;
  };
  try {
    const input = readFileSync(0, 'utf-8'); // stdin = fd 0
    const parsed = safeJsonParse(input, 'Hook stdin payload');
    if (!parsed.ok || typeof parsed.data !== 'object' || parsed.data === null || Array.isArray(parsed.data)) {
      process.exit(0);
    }
    payload = parsed.data as typeof payload;
  } catch { /* malformed or empty stdin — nothing to do */
    process.exit(0);
  }

  const sessionId = payload.session_id || '';
  const event = payload.hook_event_name || '';

  if (!sessionId) {
    process.exit(0);
  }

  // Handle Stop and StopFailure events — write signal file for monitor
  if (event === 'Stop' || event === 'StopFailure') {
    handleStopEvent(sessionId, event, payload);
    process.exit(0);
  }

  // SessionStart handling removed — ACP mode discovers sessions via protocol
  process.exit(0);
}

export function install(): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    const parsed = safeJsonParse(readFileSync(settingsPath, 'utf-8'), settingsPath);
    if (!parsed.ok || typeof parsed.data !== 'object' || parsed.data === null || Array.isArray(parsed.data)) {
      console.error(`Failed to read ${settingsPath}`);
      process.exit(1);
    }
    settings = parsed.data as Record<string, unknown>;
  }

  const hookCommand = buildHookCommand(join(__dirname, 'hook.js'));
  interface HookCommand { type: string; command: string; timeout: number }
  interface HookEntry { hooks?: HookCommand[] }

  const hooks = (settings.hooks || {}) as Record<string, HookEntry[]>;
  const sessionStart = (hooks.SessionStart || []) as HookEntry[];

  // Check if already installed
  const isInstalled = sessionStart.some(entry =>
    entry.hooks?.some(h => h.command?.includes('aegis') || h.command?.includes('manus') || h.command?.includes('hook.js'))
  );

  if (isInstalled) {
    console.log('Aegis hook already installed');
    return;
  }

  sessionStart.push({
    hooks: [{ type: 'command', command: hookCommand, timeout: 5 }]
  });

  hooks.SessionStart = sessionStart;

  // Issue #15: Also register Stop and StopFailure hooks
  const hookEntry: HookEntry = { hooks: [{ type: 'command', command: hookCommand, timeout: 5 }] };
  for (const event of ['Stop', 'StopFailure'] as const) {
    const existing = (hooks[event] || []) as HookEntry[];
    const alreadyInstalled = existing.some(entry =>
      entry.hooks?.some(h => h.command?.includes('aegis') || h.command?.includes('manus') || h.command?.includes('hook.js'))
    );
    if (!alreadyInstalled) {
      existing.push({ ...hookEntry });
      hooks[event] = existing;
    }
  }

  settings.hooks = hooks;

  const claudeDir = join(homedir(), '.claude');
  mkdirSync(claudeDir, { recursive: true });
  assertPathNotSymlink(claudeDir);
  withLockFile(`${settingsPath}.lock`, () => {
    writeTextAtomic(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  });
  console.log(`Aegis hook installed in ${settingsPath}`);
}

const isDirectExecution = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return resolve(argv1) === resolve(__filename);
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  main();
}
