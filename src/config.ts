/**
 * config.ts — Configuration loader for Manus.
 *
 * Priority (highest to lowest):
 * 1. CLI argument --config <path>
 * 2. ./manus.config.json (cwd)
 * 3. ~/.manus/config.json
 * 4. Defaults
 *
 * Environment variables override config file values.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

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
}

/** Default configuration values */
const defaults: Config = {
  port: 9100,
  host: '127.0.0.1',
  authToken: '',
  tmuxSession: 'manus',
  stateDir: join(homedir(), '.manus'),
  claudeProjectsDir: join(homedir(), '.claude', 'projects'),
  maxSessionAgeMs: 2 * 60 * 60 * 1000, // 2 hours
  reaperIntervalMs: 5 * 60 * 1000, // 5 minutes
  tgBotToken: '',
  tgGroupId: '',
  webhooks: [],
};

/** Parse CLI args for --config flag */
function getConfigPathFromArgv(): string | null {
  const idx = process.argv.indexOf('--config');
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return resolve(process.argv[idx + 1]);
  }
  return null;
}

/** Find and load config file from possible locations */
async function loadConfigFile(): Promise<Partial<Config>> {
  const locations = [
    getConfigPathFromArgv(),
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

/** Apply environment variable overrides */
function applyEnvOverrides(config: Config): Config {
  const envMappings: Record<string, keyof Config> = {
    MANUS_PORT: 'port',
    MANUS_HOST: 'host',
    MANUS_AUTH_TOKEN: 'authToken',
    MANUS_TMUX_SESSION: 'tmuxSession',
    MANUS_STATE_DIR: 'stateDir',
    MANUS_CLAUDE_PROJECTS_DIR: 'claudeProjectsDir',
    MANUS_MAX_SESSION_AGE_MS: 'maxSessionAgeMs',
    MANUS_REAPER_INTERVAL_MS: 'reaperIntervalMs',
    MANUS_TG_TOKEN: 'tgBotToken',
    MANUS_TG_GROUP: 'tgGroupId',
    MANUS_WEBHOOKS: 'webhooks',
  };

  for (const [envKey, configKey] of Object.entries(envMappings)) {
    const value = process.env[envKey];
    if (value === undefined) continue;

    switch (configKey) {
      case 'port':
      case 'maxSessionAgeMs':
      case 'reaperIntervalMs':
        config[configKey] = parseInt(value, 10);
        break;
      case 'webhooks':
        // Support comma-separated webhooks
        config[configKey] = value.includes(',')
          ? value.split(',').map(s => s.trim())
          : [value];
        break;
      default:
        config[configKey] = value;
    }
  }

  return config;
}

/** Load and merge configuration from all sources */
export async function loadConfig(): Promise<Config> {
  const fileConfig = await loadConfigFile();
  const config: Config = { ...defaults, ...fileConfig };
  return applyEnvOverrides(config);
}

/** Get config without async file loading (for tests or synchronous contexts) */
export function getConfig(): Config {
  // This returns defaults + env overrides only (no file loading)
  const config: Config = { ...defaults };
  return applyEnvOverrides(config);
}
