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
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { parseIntSafe } from './validation.js';
import { configFileSchema } from './validation.js';

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
  /** Continuation pointer TTL in milliseconds (Issue #900). */
  continuationPointerTtlMs: number;
  /** Telegram bot token */
  tgBotToken: string;
  /** Telegram group chat ID */
  tgGroupId: string;
  /** Allowed Telegram user IDs for inbound commands (empty = allow all) */
  tgAllowedUsers: number[];
  /** TTL for Telegram forum topics after session end, in milliseconds. */
  tgTopicTtlMs: number;
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
  /** Issue #1619: Require X-Hook-Secret header and reject query param secrets. */
  hookSecretHeaderOnly: boolean;
  /** Memory bridge: key/value store for cross-session context (default: disabled). */
  memoryBridge: { enabled: boolean; persistPath?: string; reaperIntervalMs?: number };
  /** Issue #884: Enable worktree-aware continuation metadata lookup (default: false).
   *  When true, Aegis fans out to sibling worktree project dirs when the primary
   *  directory lookup fails to find a session file. */
  worktreeAwareContinuation: boolean;
  /** Issue #884: Additional Claude projects directories to search during worktree fanout.
   *  Paths are expanded (~) and checked for existence before searching. */
  worktreeSiblingDirs: string[];
  /** Issue #740: Verification Protocol — auto run quality gate after session ends.
   *  When enabled, Aegis runs tsc + build + test after a Stop hook and emits
   *  results via SSE (event: 'verification'). */
  verificationProtocol: {
    /** Auto-run verification when Stop hook fires (default: false). */
    autoVerifyOnStop: boolean;
    /** Run only critical checks: tsc + build (skip slow tests). Default: false = full. */
    criticalOnly: boolean;
  };
  /** Issue #1557: Dedicated token for Prometheus /metrics scrape auth.
   *  When set, /metrics requires this token (or the primary authToken).
   *  When empty, /metrics falls through to normal auth (same as any other endpoint). */
  metricsToken: string;
  /** Issue #1423: Default pipeline stage timeout in milliseconds. 0 = no timeout. Env: AEGIS_PIPELINE_STAGE_TIMEOUT_MS */
  pipelineStageTimeoutMs: number;
  /** Production alerting (Issue #1418). */
  alerting: {
    /** Webhook URLs for alert notifications (separate from general webhooks). */
    webhooks: string[];
    /** Number of consecutive failures before triggering an alert (default: 5). */
    failureThreshold: number;
    /** Cooldown period in ms between alerts for the same type (default: 10 min). */
    cooldownMs: number;
  };
}

/** Compute stall threshold from env var or default (Issue #392).
 *  If CLAUDE_STREAM_IDLE_TIMEOUT_MS is set, uses Math.max(120000, parseInt(val) * 1.5).
 *  Otherwise defaults to 2 minutes (120000ms). */
export function computeStallThreshold(): number {
  const env = process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS;
  if (env) {
    return Math.max(120_000, Math.round(parseInt(env, 10) * 1.5));
  }
  return 2 * 60 * 1000;
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
  continuationPointerTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  tgBotToken: '',
  tgGroupId: '',
  tgAllowedUsers: [],
  tgTopicTtlMs: 24 * 60 * 60 * 1000,
  webhooks: [],
  defaultSessionEnv: {},
  defaultPermissionMode: 'default',
  stallThresholdMs: computeStallThreshold(),
  sseMaxConnections: 100,
  sseMaxPerIp: 10,
  allowedWorkDirs: [],
  hookSecretHeaderOnly: false,
  worktreeAwareContinuation: false,
  memoryBridge: { enabled: false },
  worktreeSiblingDirs: [],
  verificationProtocol: { autoVerifyOnStop: false, criticalOnly: false },
  metricsToken: '',
  pipelineStageTimeoutMs: 0,
  alerting: { webhooks: [], failureThreshold: 5, cooldownMs: 10 * 60 * 1000 },
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
        const raw = JSON.parse(data);
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          console.warn(`Config file ${path} is not a JSON object, ignoring`);
          continue;
        }
        // Expand ~ in paths before validation
        if (typeof raw.stateDir === 'string') raw.stateDir = expandTilde(raw.stateDir);
        if (typeof raw.claudeProjectsDir === 'string') raw.claudeProjectsDir = expandTilde(raw.claudeProjectsDir);

        const parsed = configFileSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn(`Config file ${path} has invalid fields, ignoring:`, parsed.error.format());
          continue;
        }
        // Log if using legacy path
        if (path.includes('manus')) {
          console.log(`Config: loaded from legacy path ${path} — consider migrating to aegis paths`);
        }
        return parsed.data as Partial<Config>;
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

type NumericConfigEnvKey =
  | 'port'
  | 'maxSessionAgeMs'
  | 'reaperIntervalMs'
  | 'continuationPointerTtlMs'
  | 'tgTopicTtlMs'
  | 'sseMaxConnections'
  | 'sseMaxPerIp'
  | 'pipelineStageTimeoutMs';

const MAX_ENV_INT = Number.MAX_SAFE_INTEGER;

const numericEnvBounds: Record<NumericConfigEnvKey, { min: number; max: number }> = {
  port: { min: 1, max: 65535 },
  maxSessionAgeMs: { min: 1, max: MAX_ENV_INT },
  reaperIntervalMs: { min: 1, max: MAX_ENV_INT },
  continuationPointerTtlMs: { min: 1, max: MAX_ENV_INT },
  tgTopicTtlMs: { min: 1, max: MAX_ENV_INT },
  sseMaxConnections: { min: 1, max: MAX_ENV_INT },
  sseMaxPerIp: { min: 1, max: MAX_ENV_INT },
  pipelineStageTimeoutMs: { min: 0, max: MAX_ENV_INT },
};

function parseNumericEnvOverride(
  envName: string,
  rawValue: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  return parseIntSafe(rawValue, fallback, {
    context: envName,
    strict: true,
    min: bounds.min,
    max: bounds.max,
    onError: (message) => console.warn(`Config: ${message}`),
  });
}

function parseTgAllowedUsers(envName: string, value: string): number[] {
  const parsedUsers: number[] = [];
  const invalidEntries: string[] = [];
  for (const token of value.split(',')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      invalidEntries.push(trimmed);
      continue;
    }
    parsedUsers.push(parsed);
  }
  if (invalidEntries.length > 0) {
    console.warn(`Config: invalid ${envName} entries ignored: ${invalidEntries.join(', ')}`);
  }
  return parsedUsers;
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
    { aegis: 'AEGIS_METRICS_TOKEN', manus: 'MANUS_METRICS_TOKEN', key: 'metricsToken' },
    { aegis: 'AEGIS_TMUX_SESSION', manus: 'MANUS_TMUX_SESSION', key: 'tmuxSession' },
    { aegis: 'AEGIS_STATE_DIR', manus: 'MANUS_STATE_DIR', key: 'stateDir' },
    { aegis: 'AEGIS_CLAUDE_PROJECTS_DIR', manus: 'MANUS_CLAUDE_PROJECTS_DIR', key: 'claudeProjectsDir' },
    { aegis: 'AEGIS_MAX_SESSION_AGE_MS', manus: 'MANUS_MAX_SESSION_AGE_MS', key: 'maxSessionAgeMs' },
    { aegis: 'AEGIS_REAPER_INTERVAL_MS', manus: 'MANUS_REAPER_INTERVAL_MS', key: 'reaperIntervalMs' },
    { aegis: 'AEGIS_CONTINUATION_POINTER_TTL_MS', manus: 'MANUS_CONTINUATION_POINTER_TTL_MS', key: 'continuationPointerTtlMs' },
    { aegis: 'AEGIS_TG_TOKEN', manus: 'MANUS_TG_TOKEN', key: 'tgBotToken' },
    { aegis: 'AEGIS_TG_GROUP', manus: 'MANUS_TG_GROUP', key: 'tgGroupId' },
    { aegis: 'AEGIS_TG_ALLOWED_USERS', manus: 'MANUS_TG_ALLOWED_USERS', key: 'tgAllowedUsers' },
    { aegis: 'AEGIS_TG_TOPIC_TTL_MS', manus: 'MANUS_TG_TOPIC_TTL_MS', key: 'tgTopicTtlMs' },
    { aegis: 'AEGIS_WEBHOOKS', manus: 'MANUS_WEBHOOKS', key: 'webhooks' },
    { aegis: 'AEGIS_SSE_MAX_CONNECTIONS', manus: 'MANUS_SSE_MAX_CONNECTIONS', key: 'sseMaxConnections' },
    { aegis: 'AEGIS_SSE_MAX_PER_IP', manus: 'MANUS_SSE_MAX_PER_IP', key: 'sseMaxPerIp' },
    { aegis: 'AEGIS_PIPELINE_STAGE_TIMEOUT_MS', manus: 'MANUS_PIPELINE_STAGE_TIMEOUT_MS', key: 'pipelineStageTimeoutMs' },
    { aegis: 'AEGIS_HOOK_SECRET_HEADER_ONLY', manus: 'MANUS_HOOK_SECRET_HEADER_ONLY', key: 'hookSecretHeaderOnly' },
  ];

  for (const { aegis, manus, key } of envMappings) {
    // AEGIS_* takes priority over MANUS_*
    const value = process.env[aegis] ?? process.env[manus];
    if (value === undefined) continue;
    const envName = process.env[aegis] !== undefined ? aegis : manus;

    switch (key) {
      case 'port':
      case 'maxSessionAgeMs':
      case 'reaperIntervalMs':
      case 'continuationPointerTtlMs':
      case 'tgTopicTtlMs':
      case 'sseMaxConnections':
      case 'sseMaxPerIp':
      case 'pipelineStageTimeoutMs':
        config[key] = parseNumericEnvOverride(envName, value, config[key], numericEnvBounds[key]);
        break;
      case 'hookSecretHeaderOnly':
        if (value === 'true' || value === 'false') {
          config[key] = value === 'true';
        } else {
          console.warn(
            `Config: Invalid ${envName}='${value}' (expected "true" or "false"); using ${config[key]}`,
          );
        }
        break;
      case 'webhooks':
        // Support comma-separated webhooks
        config[key] = value.includes(',')
          ? value.split(',').map(s => s.trim())
          : [value];
        break;
      case 'tgAllowedUsers':
        config[key] = parseTgAllowedUsers(envName, value);
        break;
      // All remaining env-mapped keys are string-typed — assign directly.
      case 'host':
      case 'authToken':
      case 'metricsToken':
      case 'tmuxSession':
      case 'stateDir':
      case 'claudeProjectsDir':
      case 'tgBotToken':
      case 'tgGroupId':
        config[key] = value;
        break;
      default:
        // Skip complex types (Record<string,string>) that can't be set from a single env var
        break;
    }
  }

  return config;
}

/** Apply alerting-specific env overrides (nested config). */
function applyAlertingEnvOverrides(config: Config): Config {
  const alertWebhooksRaw = process.env.AEGIS_ALERT_WEBHOOKS ?? process.env.MANUS_ALERT_WEBHOOKS;
  if (alertWebhooksRaw) {
    config.alerting.webhooks = alertWebhooksRaw.includes(',')
      ? alertWebhooksRaw.split(',').map(s => s.trim())
      : [alertWebhooksRaw];
  }
  const alertThreshold = process.env.AEGIS_ALERT_FAILURE_THRESHOLD;
  if (alertThreshold !== undefined) {
    config.alerting.failureThreshold = parseNumericEnvOverride(
      'AEGIS_ALERT_FAILURE_THRESHOLD',
      alertThreshold,
      config.alerting.failureThreshold,
      { min: 1, max: MAX_ENV_INT },
    );
  }
  const alertCooldown = process.env.AEGIS_ALERT_COOLDOWN_MS;
  if (alertCooldown !== undefined) {
    config.alerting.cooldownMs = parseNumericEnvOverride(
      'AEGIS_ALERT_COOLDOWN_MS',
      alertCooldown,
      config.alerting.cooldownMs,
      { min: 1, max: MAX_ENV_INT },
    );
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
  config = applyAlertingEnvOverrides(config);
  config = resolveStateDir(config);
  // Issue #349: Resolve allowedWorkDirs entries via realpath so symlink targets match
  if (config.allowedWorkDirs.length > 0) {
    config.allowedWorkDirs = await Promise.all(
      config.allowedWorkDirs.map(async (dir) => {
        try {
          return await realpath(resolve(dir));
        } catch { /* dir does not exist yet — use unresolved path */
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

/** Find the config file path that loadConfig() would use (or null if none found). */
export function findConfigFilePath(): string | null {
  const locations = [
    getConfigPathFromArgv(),
    resolve('aegis.config.json'),
    join(homedir(), '.aegis', 'config.json'),
    resolve('manus.config.json'),
    join(homedir(), '.manus', 'config.json'),
  ].filter(Boolean) as string[];

  for (const p of locations) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Load and parse a specific config file, returning parsed data or null. */
async function loadSpecificConfigFile(filePath: string): Promise<Partial<Config> | null> {
  if (!existsSync(filePath)) return null;
  try {
    const data = await readFile(filePath, 'utf-8');
    const raw = JSON.parse(data);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    if (typeof raw.stateDir === 'string') raw.stateDir = expandTilde(raw.stateDir);
    if (typeof raw.claudeProjectsDir === 'string') raw.claudeProjectsDir = expandTilde(raw.claudeProjectsDir);
    const parsed = configFileSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data as Partial<Config>;
  } catch {
    return null;
  }
}

/** Reload only allowedWorkDirs from the config file, resolving paths via realpath.
 *  Returns the new array, or null if no valid config file exists.
 *  When explicitPath is given, only that file is checked (no fallback chain).
 *  Used by the hot-reload watcher to pick up directory changes without a full restart. */
export async function reloadAllowedWorkDirs(explicitPath?: string): Promise<string[] | null> {
  const fileConfig = explicitPath
    ? await loadSpecificConfigFile(explicitPath)
    : await loadConfigFile();
  // No valid file found
  if (!fileConfig || Object.keys(fileConfig).length === 0) return null;

  const rawDirs: string[] | undefined = fileConfig.allowedWorkDirs;
  if (!rawDirs || rawDirs.length === 0) return [];

  return Promise.all(
    rawDirs.map(async (dir: string) => {
      try {
        return await realpath(resolve(dir));
      } catch {
        return resolve(dir);
      }
    }),
  );
}

/** Watch the config file for changes and invoke `onChange` with updated allowedWorkDirs.
 *  Uses debouncing (500ms) to coalesce rapid writes. Returns the watcher for cleanup.
 *  Returns null if no config file is found. */
export function watchConfigFile(
  onChange: (allowedWorkDirs: string[]) => void,
): FSWatcher | null {
  const configPath = findConfigFilePath();
  if (!configPath) return null;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(configPath, (eventType) => {
    if (eventType !== 'change') return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void reloadAllowedWorkDirs(configPath).then((dirs) => {
        if (dirs === null) return; // Config file gone/invalid — skip callback
        console.log(`Config: hot-reloaded allowedWorkDirs (${dirs.length} entries)`);
        onChange(dirs);
      });
    }, 500);
  });

  return watcher;
}
