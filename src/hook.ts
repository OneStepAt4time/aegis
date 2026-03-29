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

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stopSignalsSchema, sessionMapSchema } from './validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use ~/.aegis if it exists, fall back to ~/.manus for backward compat
const AEGIS_DIR = join(homedir(), '.aegis');
const MANUS_DIR = join(homedir(), '.manus');
const BRIDGE_DIR = existsSync(AEGIS_DIR) ? AEGIS_DIR : MANUS_DIR;
const MAP_FILE = join(BRIDGE_DIR, 'session_map.json');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TMUX_PANE_RE = /^%\d+$/;

interface SessionMapEntry {
  session_id: string;
  cwd: string;
  window_name: string;
  transcript_path: string | null;
  permission_mode: string | null;
  agent_id: string | null;
  source: string | null;      // startup | resume | clear | compact
  agent_type: string | null;
  model: string | null;
  written_at: number;
}

/** Payload fields for Stop/StopFailure events. */
interface StopHookPayload {
  error?: string;
  message?: string;
  error_details?: unknown;
  last_assistant_message?: unknown;
  agent_id?: string;
  stop_reason?: string;
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

  let signals: Record<string, unknown> = {};
  if (existsSync(signalFile)) {
    try {
      const parsed = stopSignalsSchema.safeParse(JSON.parse(readFileSync(signalFile, 'utf-8')));
      if (parsed.success) {
        signals = parsed.data;
      } else {
        console.warn('stop_signals.json failed validation, starting fresh');
      }
    } catch { /* fresh */ }
  }

  signals[sessionId] = {
    event,
    timestamp: Date.now(),
    // StopFailure may include error info in the payload
    error: (payload as StopHookPayload).error || (payload as StopHookPayload).message || null,
    error_details: (payload as StopHookPayload).error_details ?? null,
    last_assistant_message: (payload as StopHookPayload).last_assistant_message ?? null,
    agent_id: (payload as StopHookPayload).agent_id ?? null,
    stop_reason: (payload as StopHookPayload).stop_reason ?? null,
  };

  // Atomic write: write to temp file then rename (prevents partial writes on crash)
  const tmpSignalFile = signalFile + '.tmp';
  writeFileSync(tmpSignalFile, JSON.stringify(signals, null, 2));
  renameSync(tmpSignalFile, signalFile);
  console.error(`Aegis hook: ${event} for session ${sessionId.slice(0, 8)}...`);
}

function main(): void {
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
    payload = JSON.parse(input);
  } catch { /* malformed or empty stdin — nothing to do */
    process.exit(0);
  }

  const sessionId = payload.session_id || '';
  const cwd = payload.cwd || '';
  const event = payload.hook_event_name || '';

  if (!sessionId) {
    process.exit(0);
  }

  // Handle Stop and StopFailure events — write signal file for monitor
  if (event === 'Stop' || event === 'StopFailure') {
    handleStopEvent(sessionId, event, payload);
    process.exit(0);
  }

  if (event !== 'SessionStart') {
    process.exit(0);
  }

  if (!UUID_RE.test(sessionId)) {
    console.error(`Invalid session_id: ${sessionId}`);
    process.exit(0);
  }

  // Get tmux window info
  const tmuxPane = process.env.TMUX_PANE;
  if (!tmuxPane) {
    console.error('TMUX_PANE not set');
    process.exit(0);
  }

  if (!TMUX_PANE_RE.test(tmuxPane)) {
    console.error(`Invalid TMUX_PANE: ${tmuxPane}`);
    process.exit(0);
  }

  let tmuxInfo: string;
  try {
    tmuxInfo = execFileSync(
      'tmux',
      ['display-message', '-t', tmuxPane, '-p', '#{session_name}:#{window_id}:#{window_name}'],
      { encoding: 'utf-8' }
    ).trim();
  } catch { /* tmux not running or pane not found */
    console.error('Failed to get tmux info');
    process.exit(0);
  }

  const parts = tmuxInfo.split(':');
  if (parts.length < 3) {
    process.exit(0);
  }

  const [sessionName, windowId, windowName] = parts;
  const key = `${sessionName}:${windowId}`;

  // Read-modify-write session_map
  mkdirSync(BRIDGE_DIR, { recursive: true });

  let sessionMap: Record<string, SessionMapEntry> = {};
  if (existsSync(MAP_FILE)) {
    try {
      const parsed = sessionMapSchema.safeParse(JSON.parse(readFileSync(MAP_FILE, 'utf-8')));
      if (parsed.success) {
        sessionMap = parsed.data as Record<string, SessionMapEntry>;
      } else {
        console.warn('session_map.json failed validation, starting fresh');
      }
    } catch { /* fresh map */ }
  }

  sessionMap[key] = {
    session_id: sessionId,
    cwd,
    window_name: windowName || '',
    transcript_path: payload.transcript_path || null,
    permission_mode: payload.permission_mode || null,
    agent_id: payload.agent_id || null,
    source: payload.source || null,
    agent_type: payload.agent_type || null,
    model: payload.model || null,
    written_at: Date.now(),
  };

  // Atomic write: write to temp file then rename (prevents race-condition data loss)
  const tmpMapFile = MAP_FILE + '.tmp';
  writeFileSync(tmpMapFile, JSON.stringify(sessionMap, null, 2));
  renameSync(tmpMapFile, MAP_FILE);
  console.error(`Aegis hook: mapped ${key} -> ${sessionId}`);
}

function install(): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch { /* corrupted or unreadable settings file */
      console.error(`Failed to read ${settingsPath}`);
      process.exit(1);
    }
  }

  const hookCommand = `node ${join(__dirname, 'hook.js')}`;
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

  mkdirSync(join(homedir(), '.claude'), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(`Aegis hook installed in ${settingsPath}`);
}

main();
