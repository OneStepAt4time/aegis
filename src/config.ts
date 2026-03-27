/**
 * config.ts — Configuration loader for Aegis.
 *
 * Priority (highest to lowest):
 * 1. CLI argument --config <path>
 * 2. ./aegis.config.json (cwd) — fallback: ./manus.config.json
 * 3. ~/.aegis/config.json — fallback: ~/.manus/config.json
 * 4. Defaults
 *
 * Environment variables override config file values.
 * AEGIS_* env vars take priority; MANUS_* still supported for backward compat.
 */

import { readFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { parseIntSafe } from './validation.js';

export interface Config {
  /** HTTP server port */
  port: number;
  /** HTTP server host */
  host: string;
  /** Bearer auth token (empty = no auth) */
  authToken: string;
  /** tmux session name */
  tmuxSession: string;
  /** Directory for bridge state (state.json, session_map.json) */
  stateDir: string;
  /** Directory where Claude Code stores projects (~/.claude/projects) */
  claudeProjectsDir: string;
  /** Max session age in milliseconds */
  maxSessionAgeMs: number;
  /** Reaper check interval in milliseconds */
  reaperIntervalMs: number;
  /** Telegram bot token */
  tgBotToken: string;
  /** Telegram group chat ID */
  tgGroupId: string;
  /** Webhook URLs (comma-separated or array) */
  webhooks: string[];
  /** Default env vars injected into every CC session (e.g. model overrides, API keys).
   *  Per-session env vars from the API merge on top (per-session wins). */
  defaultSessionEnv: Record<string, string>;
  /** Default permission mode for new sessions (default: "bypassPermissions").
   *  Aegis is headless — there is no human at the TTY to approve prompts.
   *  Set explicitly to "default" if approval gating is needed.
   *  Values: "default" | "plan" | "acceptEdits" | "bypassPermissions" | "dontAsk" | "auto" */
  defaultPermissionMode: string;
  /** Stall threshold for monitor (ms). */
  stallThresholdMs: number;
  /** Maximum total concurrent SSE connections (default: 100). Env: AEGIS_SSE_MAX_CONNECTIONS */
  sseMaxConnections: number;
  /** Maximum concurrent SSE connections per client IP (default: 10). Env: AEGIS_SSE_MAX_PER_IP */
  sseMaxPerIp: number;
  /** Allowed working directories for session creation (Issue #349).
   *  Empty array = all directories allowed (backward compatible).
   *  Paths are resolved and symlink-resolved before checking. */
  allowedWorkDirs: string[];
}

/** Default configuration values */
const defaults: Config = {
  port: 9100,
  host: '127.0.0.1',
  authToken: '',
  tmuxSession: 'aegis',
  stateDir: join(homedir(), '.aegis'),
  claudeProjectsDir: join(homedir(), '.claude', 'projects'),
  maxSessionAgeMs: 2 * 60 * 60 * 1000, // 2 hours
  reaperIntervalMs: 5 * 60 * 1000, // 5 minutes
  tgBotToken: '',
  tgGroupId: '',
  webhooks: [],
  defaultSessionEnv: {},
  defaultPermissionMode: 'bypassPermissions',
  stallThresholdMs: 5 * 60 * 1000,
  sseMaxConnections: 100,
  sseMaxPerIp: 10,
  allowedWorkDirs: [],
};

/** Parse CLI args for --config flag */
function getConfigPathFromArgv(): string | null {
  const idx = process.argv.indexOf('--config');
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return resolve(process.argv[idx + 1]);
  }
  return null;
}

/** Find and load config file from possible locations.
 *  Checks aegis paths first, falls back to manus paths for backward compat.
 */
async function loadConfigFile(): Promise<Partial<Config>> {
  const locations = [
    getConfigPathFromArgv(),
    // New aegis paths (preferred)
    resolve('aegis.config.json'),
    join(homedir(), '.aegis', 'config.json'),
    // Legacy manus paths (backward compat)
    resolve('manus.config.json'),
    join(homedir(), '.manus', 'config.json'),
  ].filter(Boolean) as string[];

  for (const path of locations) {
    if (existsSync(path)) {
      try {
        const data = await readFile(path, 'utf-8');
        const parsed = JSON.parse(data);
        // Expand ~ in paths
        if (typeof parsed.stateDir === 'string') {
          parsed.stateDir = expandTilde(parsed.stateDir);
        }
        if (typeof parsed.claudeProjectsDir === 'string') {
          parsed.claudeProjectsDir = expandTilde(parsed.claudeProjectsDir);
        }
        // Log if using legacy path
        if (path.includes('manus')) {
          console.log(`Config: loaded from legacy path ${path} — consider migrating to aegis paths`);
        }
        return parsed;
      } catch (e) {
        console.warn(`Failed to parse config file ${path}:`, e);
      }
    }
  }

  return {};
}

/** Expand ~ to homedir in path strings */
function expandTilde(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/** Apply environment variable overrides.
 *  AEGIS_* vars take priority over MANUS_* (backward compat).
 */
function applyEnvOverrides(config: Config): Config {
  // AEGIS_* (new, preferred) and MANUS_* (legacy, backward compat)
  const envMappings: Array<{ aegis: string; manus: string; key: keyof Config }> = [
    { aegis: 'AEGIS_PORT', manus: 'MANUS_PORT', key: 'port' },
    { aegis: 'AEGIS_HOST', manus: 'MANUS_HOST', key: 'host' },
    { aegis: 'AEGIS_AUTH_TOKEN', manus: 'MANUS_AUTH_TOKEN', key: 'authToken' },
    { aegis: 'AEGIS_TMUX_SESSION', manus: 'MANUS_TMUX_SESSION', key: 'tmuxSession' },
    { aegis: 'AEGIS_STATE_DIR', manus: 'MANUS_STATE_DIR', key: 'stateDir' },
    { aegis: 'AEGIS_CLAUDE_PROJECTS_DIR', manus: 'MANUS_CLAUDE_PROJECTS_DIR', key: 'claudeProjectsDir' },
    { aegis: 'AEGIS_MAX_SESSION_AGE_MS', manus: 'MANUS_MAX_SESSION_AGE_MS', key: 'maxSessionAgeMs' },
    { aegis: 'AEGIS_REAPER_INTERVAL_MS', manus: 'MANUS_REAPER_INTERVAL_MS', key: 'reaperIntervalMs' },
    { aegis: 'AEGIS_TG_TOKEN', manus: 'MANUS_TG_TOKEN', key: 'tgBotToken' },
    { aegis: 'AEGIS_TG_GROUP', manus: 'MANUS_TG_GROUP', key: 'tgGroupId' },
    { aegis: 'AEGIS_WEBHOOKS', manus: 'MANUS_WEBHOOKS', key: 'webhooks' },
    { aegis: 'AEGIS_SSE_MAX_CONNECTIONS', manus: 'MANUS_SSE_MAX_CONNECTIONS', key: 'sseMaxConnections' },
    { aegis: 'AEGIS_SSE_MAX_PER_IP', manus: 'MANUS_SSE_MAX_PER_IP', key: 'sseMaxPerIp' },
  ];

  for (const { aegis, manus, key } of envMappings) {
    // AEGIS_* takes priority over MANUS_*
    const value = process.env[aegis] ?? process.env[manus];
    if (value === undefined) continue;

    switch (key) {
      case 'port':
      case 'maxSessionAgeMs':
      case 'reaperIntervalMs':
      case 'sseMaxConnections':
      case 'sseMaxPerIp':
        config[key] = parseIntSafe(value, config[key]);
        break;
      case 'webhooks':
        // Support comma-separated webhooks
        config[key] = value.includes(',')
          ? value.split(',').map(s => s.trim())
          : [value];
        break;
      default:
        // Skip complex types (Record<string,string>) that can't be set from a single env var
        if (typeof config[key] === 'object' && config[key] !== null && !Array.isArray(config[key])) break;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (config as any)[key] = value;
    }
  }

  return config;
}

/** Resolve the state directory.
 *  If ~/.aegis doesn't exist but ~/.manus does, use ~/.manus for backward compat.
 */
function resolveStateDir(config: Config): Config {
  const aegisDir = join(homedir(), '.aegis');
  const manusDir = join(homedir(), '.manus');

  // If stateDir is the default aegis path but doesn't exist, check for legacy manus path
  if (config.stateDir === aegisDir && !existsSync(aegisDir) && existsSync(manusDir)) {
    console.log(`Config: using legacy state dir ${manusDir} — consider migrating to ${aegisDir}`);
    config.stateDir = manusDir;
  }

  return config;
}

/** Load and merge configuration from all sources */
export async function loadConfig(): Promise<Config> {
  const fileConfig = await loadConfigFile();
  let config: Config = { ...defaults, ...fileConfig };
  config = applyEnvOverrides(config);
  config = resolveStateDir(config);
  // Issue #349: Resolve allowedWorkDirs entries via realpath so symlink targets match
  if (config.allowedWorkDirs.length > 0) {
    config.allowedWorkDirs = await Promise.all(
      config.allowedWorkDirs.map(async (dir) => {
        try {
          return await realpath(resolve(dir));
        } catch {
          return resolve(dir);
        }
      }),
    );
  }
  return config;
}

/** Get config without async file loading (for tests or synchronous contexts) */
export function getConfig(): Config {
  // This returns defaults + env overrides only (no file loading)
  let config: Config = { ...defaults };
  config = applyEnvOverrides(config);
  return config;
}
