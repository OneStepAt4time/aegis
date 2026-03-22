#!/usr/bin/env node
/**
 * hook.ts — Claude Code SessionStart hook for Manus.
 * 
 * Writes session_id → window_id mapping to ~/.manus/session_map.json.
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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BRIDGE_DIR = join(homedir(), '.manus');
const MAP_FILE = join(BRIDGE_DIR, 'session_map.json');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function main(): void {
  // Check for --install flag
  if (process.argv.includes('--install')) {
    install();
    return;
  }

  // Read payload from stdin
  let payload: { session_id?: string; cwd?: string; hook_event_name?: string };
  try {
    const input = readFileSync(0, 'utf-8'); // stdin = fd 0
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const sessionId = payload.session_id || '';
  const cwd = payload.cwd || '';
  const event = payload.hook_event_name || '';

  if (!sessionId || event !== 'SessionStart') {
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

  let tmuxInfo: string;
  try {
    tmuxInfo = execSync(
      `tmux display-message -t ${tmuxPane} -p "#{session_name}:#{window_id}:#{window_name}"`,
      { encoding: 'utf-8' }
    ).trim();
  } catch {
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

  let sessionMap: Record<string, { session_id: string; cwd: string; window_name: string }> = {};
  if (existsSync(MAP_FILE)) {
    try {
      sessionMap = JSON.parse(readFileSync(MAP_FILE, 'utf-8'));
    } catch { /* fresh map */ }
  }

  sessionMap[key] = {
    session_id: sessionId,
    cwd,
    window_name: windowName || '',
  };

  writeFileSync(MAP_FILE, JSON.stringify(sessionMap, null, 2));
  console.error(`Manus hook: mapped ${key} -> ${sessionId}`);
}

function install(): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
      console.error(`Failed to read ${settingsPath}`);
      process.exit(1);
    }
  }

  const hookCommand = `node ${join(__dirname, 'hook.js')}`;
  const hooks = (settings.hooks || {}) as Record<string, unknown[]>;
  const sessionStart = (hooks.SessionStart || []) as Array<{ hooks?: Array<{ command?: string }> }>;

  // Check if already installed
  const isInstalled = sessionStart.some(entry =>
    entry.hooks?.some(h => h.command?.includes('manus') || h.command?.includes('hook.js'))
  );

  if (isInstalled) {
    console.log('Manus hook already installed');
    return;
  }

  sessionStart.push({
    hooks: [{ type: 'command', command: hookCommand, timeout: 5 } as any]
  });

  hooks.SessionStart = sessionStart;
  settings.hooks = hooks;

  mkdirSync(join(homedir(), '.claude'), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(`Manus hook installed in ${settingsPath}`);
}

main();
