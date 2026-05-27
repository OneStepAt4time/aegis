/**
 * config/index.ts — Domain config schemas + original Config interface + loadConfig().
 *
 * Re-exports everything that src/config.ts used to export so that existing
 * imports (`from '../config.js'`) continue to work unchanged.
 * Issue #4232.
 */

import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { detectDocker } from '../detect-docker.js';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parseIntSafe, configFileSchema } from '../validation.js';
import { getConfiguredBaseUrl } from '../base-url.js';
import { secureFilePermissions } from '../file-utils.js';
import { StructuredLogger } from '../logger.js';

import { authConfigSchema } from './auth.js';
import { channelConfigSchema } from './channels.js';
import { serverConfigSchema } from './server.js';
import { sessionConfigSchema } from './sessions.js';
import { budgetConfigSchema } from './budgets.js';

const log = new StructuredLogger();

// ── System tenant ──────────────────────────────────────────────────

/** Issue #2267: System tenant ID for admin/master keys and cross-tenant operations. */
export const SYSTEM_TENANT = '_system';

// ── Config interface (preserves original shape with optionals) ─────

export interface Config {
  /** Preferred origin URL for API clients, hooks, and dashboard links. */
  baseUrl?: string;
  /** HTTP server port */
  port: number;
  /** HTTP server host */
  host: string;
  /** Bearer auth token (empty = no auth) */
  authToken: string;
  /** Plaintext API token stored for local CLI/dashboard bootstrap flows. */
  clientAuthToken?: string;
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
  /** Whether to auto-delete Telegram forum topics after TTL expires (default: true). */
  tgTopicAutoDelete: boolean;
  /** Forward verbose CC output to Telegram (thinking, tool calls, code). Default: false. */
  tgVerbose: boolean;
  /** TTL for Telegram forum topics in hours (alternative to tgTopicTtlMs; takes priority if set). */
  tgTopicTTLHours: number;
  /** Webhook URLs (comma-separated or array) */
  webhooks: string[];
  /** Default env vars injected into every CC session. */
  defaultSessionEnv: Record<string, string>;
  /** Default permission mode for new sessions. */
  defaultPermissionMode: string;
  /** Stall threshold for monitor (ms). */
  stallThresholdMs: number;
  /** Maximum total concurrent SSE connections. */
  sseMaxConnections: number;
  /** Maximum concurrent SSE connections per client IP. */
  sseMaxPerIp: number;
  /** Allowed working directories for session creation. */
  allowedWorkDirs: string[];
  /** Require X-Hook-Secret header and reject query param secrets. */
  hookSecretHeaderOnly: boolean;
  /** Memory bridge: key/value store for cross-session context. */
  memoryBridge: { enabled: boolean; persistPath?: string; reaperIntervalMs?: number };
  /** Enable worktree-aware continuation metadata lookup. */
  worktreeAwareContinuation: boolean;
  /** Additional Claude projects directories to search during worktree fanout. */
  worktreeSiblingDirs: string[];
  /** Verification Protocol. */
  verificationProtocol: {
    autoVerifyOnStop: boolean;
    criticalOnly: boolean;
  };
  /** Dedicated token for Prometheus /metrics scrape auth. */
  metricsToken: string;
  /** Default pipeline stage timeout in milliseconds. */
  pipelineStageTimeoutMs: number;
  /** Production alerting. */
  alerting: {
    webhooks: string[];
    failureThreshold: number;
    cooldownMs: number;
  };
  /** Additional env var names to deny. */
  envDenylist: string[];
  /** Admin-defined env var names exempt from denylist. */
  envAdminAllowlist: string[];
  /** Enforce session ownership on action routes. */
  enforceSessionOwnership: boolean;
  /** Enforce RBAC role checks even when auth is disabled. */
  strictRBAC: boolean;
  /** Require explicit session approval before CC starts. */
  requireSessionApproval?: boolean;
  /** Timeout in ms before auto-rejecting an awaiting_approval session. */
  sessionApprovalTimeoutMs?: number;
  /** Interval in ms for auto-cleanup of killed sessions. */
  sessionCleanupIntervalMs?: number;
  /** Age in ms after which killed sessions are purged. */
  sessionCleanupAgeMs?: number;
  /** Milliseconds of SSE silence before emitting a heartbeat ping. */
  sseIdleMs: number;
  /** Milliseconds before closing an SSE connection that hasn't consumed data. */
  sseClientTimeoutMs: number;
  /** Timeout in ms for outgoing hook/webhook HTTP calls. */
  hookTimeoutMs: number;
  /** Grace period in ms for in-flight requests during shutdown. */
  shutdownGraceMs: number;
  /** Grace period in seconds for key rotation. */
  keyRotationGraceSeconds: number;
  /** Hard cap in ms for total shutdown sequence before process.exit. */
  shutdownHardMs: number;
  /** Session state store backend. */
  stateStore: string;
  /** PostgreSQL connection URL. */
  postgresUrl: string;
  /** Whether to serve the bundled dashboard. */
  dashboardEnabled?: boolean;
  /** Default tenant ID for keys/sessions without explicit tenant. */
  defaultTenantId: string;
  /** Per-tenant workdir roots. */
  tenantWorkdirs: Record<string, { root: string; allowedPaths?: string[] }>;
  /** API rate limiting configuration. */
  rateLimit: {
    enabled: boolean;
    sessionsMax: number;
    generalMax: number;
    timeWindowSec: number;
  };
  /** Enable ACP backend for session creation and control actions. */
  acpEnabled: boolean;
  /** ACP JSON-RPC request timeout in ms. */
  acpPromptTimeoutMs: number;
  /** Enforce ACP validation warnings as errors. */
  acpStrictValidation?: boolean;
  /** Session isolation policy. */
  isolationPolicy?: "respect-cc" | "enforce-worktree" | "enforce-direct";
}

// ── Stall threshold ────────────────────────────────────────────────

/** Compute stall threshold from env var or default (Issue #392). */
export function computeStallThreshold(): number {
  const env = process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS;
  if (env) {
    return Math.max(120_000, Math.round(parseInt(env, 10) * 1.5));
  }
  return 2 * 60 * 1000;
}

// ── Defaults ───────────────────────────────────────────────────────

/** Default configuration values */
const defaults: Config = {
  baseUrl: '',
  port: 9100,
  host: detectDocker() ? '0.0.0.0' : '127.0.0.1',
  authToken: '',
  stateDir: join(homedir(), '.aegis'),
  claudeProjectsDir: join(homedir(), '.claude', 'projects'),
  maxSessionAgeMs: 2 * 60 * 60 * 1000,
  reaperIntervalMs: 5 * 60 * 1000,
  continuationPointerTtlMs: 24 * 60 * 60 * 1000,
  tgBotToken: '',
  tgGroupId: '',
  tgAllowedUsers: [],
  tgTopicTtlMs: 24 * 60 * 60 * 1000,
  tgTopicAutoDelete: true,
  tgVerbose: false,
  tgTopicTTLHours: 0,
  webhooks: [],
  defaultSessionEnv: {},
  defaultPermissionMode: 'default',
  stallThresholdMs: computeStallThreshold(),
  sseMaxConnections: 100,
  sseMaxPerIp: 10,
  allowedWorkDirs: [],
  hookSecretHeaderOnly: false,
  worktreeAwareContinuation: false,
  memoryBridge: { enabled: true },
  worktreeSiblingDirs: [],
  verificationProtocol: { autoVerifyOnStop: false, criticalOnly: false },
  metricsToken: '',
  pipelineStageTimeoutMs: 0,
  alerting: { webhooks: [], failureThreshold: 5, cooldownMs: 10 * 60 * 1000 },
  envDenylist: [],
  envAdminAllowlist: [],
  enforceSessionOwnership: true,
  strictRBAC: false,
  requireSessionApproval: false,
  sessionApprovalTimeoutMs: 300_000,
  sessionCleanupIntervalMs: 3_600_000,
  sessionCleanupAgeMs: 86_400_000,
  sseIdleMs: 60_000,
  sseClientTimeoutMs: 300_000,
  hookTimeoutMs: 10_000,
  shutdownGraceMs: 15_000,
  keyRotationGraceSeconds: 3600,
  shutdownHardMs: 20_000,
  dashboardEnabled: true,
  defaultTenantId: 'default',
  tenantWorkdirs: {},
  stateStore: 'file',
  postgresUrl: '',
  rateLimit: { enabled: true, sessionsMax: 100, generalMax: 30, timeWindowSec: 60 },
  acpEnabled: true,
  acpPromptTimeoutMs: 120_000,
  acpStrictValidation: false,
  isolationPolicy: 'respect-cc',
};

// ── Merged Zod schema (for validation, not type inference) ─────────

/** Merged Zod schema covering all config domains. */
export const fullConfigSchema = authConfigSchema
  .merge(channelConfigSchema)
  .merge(serverConfigSchema)
  .merge(sessionConfigSchema)
  .merge(budgetConfigSchema);

// ── Config file discovery & parsing ────────────────────────────────

function getConfigPathFromArgv(): string | null {
  const idx = process.argv.indexOf('--config');
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return resolve(process.argv[idx + 1]);
  }
  return null;
}

function getConfigSearchLocations(): string[] {
  return [
    getConfigPathFromArgv(),
    resolve('.aegis', 'config.yaml'),
    resolve('.aegis', 'config.yml'),
    resolve('aegis.config.json'),
    join(homedir(), '.aegis', 'config.yaml'),
    join(homedir(), '.aegis', 'config.yml'),
    join(homedir(), '.aegis', 'config.json'),
    resolve('manus.config.json'),
    join(homedir(), '.manus', 'config.json'),
  ].filter(Boolean) as string[];
}

function isYamlConfigPath(filePath: string): boolean {
  return filePath.endsWith('.yaml') || filePath.endsWith('.yml');
}

function isLegacyManusConfigPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.endsWith('/manus.config.json') || normalized.includes('/.manus/');
}

function expandTilde(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function normalizeConfigFileObject(raw: unknown, filePath: string): Partial<Config> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    log.warn({ component: 'config', operation: 'invalidConfigFile', attributes: { path: filePath } });
    return null;
  }

  const candidate = { ...raw } as Record<string, unknown>;
  if (typeof candidate.stateDir === 'string') candidate.stateDir = expandTilde(candidate.stateDir);
  if (typeof candidate.claudeProjectsDir === 'string') candidate.claudeProjectsDir = expandTilde(candidate.claudeProjectsDir);

  const parsed = configFileSchema.safeParse(candidate);
  if (!parsed.success) {
    log.warn({ component: 'config', operation: 'invalidConfigFields', attributes: { path: filePath, errors: String(parsed.error.format()) } });
    return null;
  }

  return parsed.data as Partial<Config>;
}

function parseConfigText(filePath: string, data: string): unknown {
  return isYamlConfigPath(filePath) ? parseYaml(data) : JSON.parse(data);
}

export async function readConfigFile(filePath: string): Promise<Partial<Config> | null> {
  if (!existsSync(filePath)) return null;
  try {
    const data = await readFile(filePath, 'utf-8');
    return normalizeConfigFileObject(parseConfigText(filePath, data), filePath);
  } catch (e) {
    log.warn({ component: 'config', operation: 'parseFailed', attributes: { path: filePath, error: String(e) } });
    return null;
  }
}

function pruneUndefinedConfig<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(entry => pruneUndefinedConfig(entry)) as T;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, pruneUndefinedConfig(entryValue)]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}

export function serializeConfigFile(config: Partial<Config>, filePath: string): string {
  const cleaned = pruneUndefinedConfig(config);
  if (isYamlConfigPath(filePath)) {
    return stringifyYaml(cleaned, { lineWidth: 0 }).trimEnd() + '\n';
  }
  return `${JSON.stringify(cleaned, null, 2)}\n`;
}

export async function writeConfigFile(filePath: string, config: Partial<Config>): Promise<void> {
  const content = serializeConfigFile(config, filePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, { mode: 0o600 });
  await secureFilePermissions(filePath);
}

async function loadConfigFile(): Promise<Partial<Config>> {
  for (const path of getConfigSearchLocations()) {
    const parsed = await readConfigFile(path);
    if (!parsed) continue;
    if (isLegacyManusConfigPath(path)) {
      log.info({ component: 'config', operation: 'legacyPathUsed', attributes: { path } });
    }
    return parsed;
  }
  return {};
}

// ── Env var overrides ──────────────────────────────────────────────

type NumericConfigEnvKey =
  | 'port'
  | 'maxSessionAgeMs'
  | 'reaperIntervalMs'
  | 'continuationPointerTtlMs'
  | 'tgTopicTtlMs'
  | 'tgTopicTTLHours'
  | 'sseMaxConnections'
  | 'sseMaxPerIp'
  | 'pipelineStageTimeoutMs'
  | 'sseIdleMs'
  | 'sseClientTimeoutMs'
  | 'hookTimeoutMs'
  | 'shutdownGraceMs'
  | 'shutdownHardMs'
  | 'acpPromptTimeoutMs';

const MAX_ENV_INT = Number.MAX_SAFE_INTEGER;

const numericEnvBounds: Record<NumericConfigEnvKey, { min: number; max: number }> = {
  port: { min: 1, max: 65535 },
  maxSessionAgeMs: { min: 1, max: MAX_ENV_INT },
  reaperIntervalMs: { min: 1, max: MAX_ENV_INT },
  continuationPointerTtlMs: { min: 1, max: MAX_ENV_INT },
  tgTopicTtlMs: { min: 1, max: MAX_ENV_INT },
  tgTopicTTLHours: { min: 0, max: MAX_ENV_INT },
  sseMaxConnections: { min: 1, max: MAX_ENV_INT },
  sseMaxPerIp: { min: 1, max: MAX_ENV_INT },
  pipelineStageTimeoutMs: { min: 0, max: MAX_ENV_INT },
  sseIdleMs: { min: 1000, max: MAX_ENV_INT },
  sseClientTimeoutMs: { min: 1000, max: MAX_ENV_INT },
  hookTimeoutMs: { min: 100, max: MAX_ENV_INT },
  shutdownGraceMs: { min: 1000, max: MAX_ENV_INT },
  shutdownHardMs: { min: 1000, max: MAX_ENV_INT },
  acpPromptTimeoutMs: { min: 1000, max: MAX_ENV_INT },
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
    onError: (message) => log.warn({ component: 'config', operation: 'envParseError', attributes: { message } }),
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
    log.warn({ component: 'config', operation: 'invalidTgUsers', attributes: { envName, invalidEntries: invalidEntries.join(', ') } });
  }
  return parsedUsers;
}

function applyEnvOverrides(config: Config): Config {
  const envMappings: Array<{ aegis: string; manus: string; key: keyof Config }> = [
    { aegis: 'AEGIS_BASE_URL', manus: '', key: 'baseUrl' },
    { aegis: 'AEGIS_PORT', manus: 'MANUS_PORT', key: 'port' },
    { aegis: 'AEGIS_HOST', manus: 'MANUS_HOST', key: 'host' },
    { aegis: 'AEGIS_AUTH_TOKEN', manus: 'MANUS_AUTH_TOKEN', key: 'authToken' },
    { aegis: 'AEGIS_METRICS_TOKEN', manus: 'MANUS_METRICS_TOKEN', key: 'metricsToken' },
    { aegis: 'AEGIS_STATE_DIR', manus: 'MANUS_STATE_DIR', key: 'stateDir' },
    { aegis: 'AEGIS_CLAUDE_PROJECTS_DIR', manus: 'MANUS_CLAUDE_PROJECTS_DIR', key: 'claudeProjectsDir' },
    { aegis: 'AEGIS_MAX_SESSION_AGE_MS', manus: 'MANUS_MAX_SESSION_AGE_MS', key: 'maxSessionAgeMs' },
    { aegis: 'AEGIS_REAPER_INTERVAL_MS', manus: 'MANUS_REAPER_INTERVAL_MS', key: 'reaperIntervalMs' },
    { aegis: 'AEGIS_CONTINUATION_POINTER_TTL_MS', manus: 'MANUS_CONTINUATION_POINTER_TTL_MS', key: 'continuationPointerTtlMs' },
    { aegis: 'AEGIS_TG_TOKEN', manus: 'MANUS_TG_TOKEN', key: 'tgBotToken' },
    { aegis: 'AEGIS_TG_GROUP', manus: 'MANUS_TG_GROUP', key: 'tgGroupId' },
    { aegis: 'AEGIS_TG_ALLOWED_USERS', manus: 'MANUS_TG_ALLOWED_USERS', key: 'tgAllowedUsers' },
    { aegis: 'AEGIS_TG_TOPIC_TTL_MS', manus: 'MANUS_TG_TOPIC_TTL_MS', key: 'tgTopicTtlMs' },
    { aegis: 'AEGIS_TG_TOPIC_AUTO_DELETE', manus: 'MANUS_TG_TOPIC_AUTO_DELETE', key: 'tgTopicAutoDelete' },
    { aegis: 'AEGIS_TG_TOPIC_TTL_HOURS', manus: 'MANUS_TG_TOPIC_TTL_HOURS', key: 'tgTopicTTLHours' },
    { aegis: 'AEGIS_TG_VERBOSE', manus: 'MANUS_TG_VERBOSE', key: 'tgVerbose' },
    { aegis: 'AEGIS_WEBHOOKS', manus: 'MANUS_WEBHOOKS', key: 'webhooks' },
    { aegis: 'AEGIS_SSE_MAX_CONNECTIONS', manus: 'MANUS_SSE_MAX_CONNECTIONS', key: 'sseMaxConnections' },
    { aegis: 'AEGIS_SSE_MAX_PER_IP', manus: 'MANUS_SSE_MAX_PER_IP', key: 'sseMaxPerIp' },
    { aegis: 'AEGIS_PIPELINE_STAGE_TIMEOUT_MS', manus: 'MANUS_PIPELINE_STAGE_TIMEOUT_MS', key: 'pipelineStageTimeoutMs' },
    { aegis: 'AEGIS_SSE_IDLE_MS', manus: 'MANUS_SSE_IDLE_MS', key: 'sseIdleMs' },
    { aegis: 'AEGIS_SSE_CLIENT_TIMEOUT_MS', manus: 'MANUS_SSE_CLIENT_TIMEOUT_MS', key: 'sseClientTimeoutMs' },
    { aegis: 'AEGIS_HOOK_TIMEOUT_MS', manus: 'MANUS_HOOK_TIMEOUT_MS', key: 'hookTimeoutMs' },
    { aegis: 'AEGIS_SHUTDOWN_GRACE_MS', manus: 'MANUS_SHUTDOWN_GRACE_MS', key: 'shutdownGraceMs' },
    { aegis: 'AEGIS_SHUTDOWN_HARD_MS', manus: 'MANUS_SHUTDOWN_HARD_MS', key: 'shutdownHardMs' },
    { aegis: 'AEGIS_HOOK_SECRET_HEADER_ONLY', manus: 'MANUS_HOOK_SECRET_HEADER_ONLY', key: 'hookSecretHeaderOnly' },
    { aegis: 'AEGIS_DASHBOARD_ENABLED', manus: '', key: 'dashboardEnabled' },
    { aegis: 'AEGIS_DEFAULT_TENANT_ID', manus: '', key: 'defaultTenantId' },
    { aegis: 'AEGIS_ENFORCE_SESSION_OWNERSHIP', manus: '', key: 'enforceSessionOwnership' },
    { aegis: 'AEGIS_STRICT_RBAC', manus: '', key: 'strictRBAC' },
    { aegis: 'AEGIS_REQUIRE_SESSION_APPROVAL', manus: '', key: 'requireSessionApproval' },
    { aegis: 'AEGIS_SESSION_APPROVAL_TIMEOUT_MS', manus: '', key: 'sessionApprovalTimeoutMs' },
    { aegis: 'AEGIS_SESSION_CLEANUP_INTERVAL_MS', manus: '', key: 'sessionCleanupIntervalMs' },
    { aegis: 'AEGIS_SESSION_CLEANUP_AGE_MS', manus: '', key: 'sessionCleanupAgeMs' },
    { aegis: 'AEGIS_ACP_ENABLED', manus: '', key: 'acpEnabled' },
    { aegis: 'AEGIS_ACP_PROMPT_TIMEOUT_MS', manus: '', key: 'acpPromptTimeoutMs' },
    { aegis: 'AEGIS_ACP_STRICT_VALIDATION', manus: '', key: 'acpStrictValidation' },
    { aegis: 'AEGIS_ISOLATION_POLICY', manus: '', key: 'isolationPolicy' },
  ];

  for (const { aegis, manus, key } of envMappings) {
    const value = process.env[aegis] ?? process.env[manus];
    if (value === undefined) continue;
    const envName = process.env[aegis] !== undefined ? aegis : manus;

    switch (key) {
      case 'port':
      case 'maxSessionAgeMs':
      case 'reaperIntervalMs':
      case 'continuationPointerTtlMs':
      case 'tgTopicTtlMs':
      case 'tgTopicTTLHours':
      case 'sseMaxConnections':
      case 'sseMaxPerIp':
      case 'pipelineStageTimeoutMs':
      case 'sseIdleMs':
      case 'sseClientTimeoutMs':
      case 'hookTimeoutMs':
      case 'shutdownGraceMs':
      case 'shutdownHardMs':
      case 'acpPromptTimeoutMs':
        config[key] = parseNumericEnvOverride(envName, value, config[key], numericEnvBounds[key]);
        break;
      case 'hookSecretHeaderOnly':
      case 'tgTopicAutoDelete':
      case 'tgVerbose':
      case 'dashboardEnabled':
      case 'acpStrictValidation':
      case 'acpEnabled':
        if (value === 'true' || value === 'false') {
          config[key] = value === 'true';
        } else {
          log.warn({ component: 'config', operation: 'invalidBoolEnv', attributes: { envName, value: String(value), current: String(config[key]) } });
        }
        break;
      case 'enforceSessionOwnership':
        config[key] = value !== 'false';
        break;
      case 'webhooks':
        config[key] = value.includes(',')
          ? value.split(',').map(s => s.trim())
          : [value];
        break;
      case 'tgAllowedUsers':
        config[key] = parseTgAllowedUsers(envName, value);
        break;
      case 'host':
      case 'baseUrl':
      case 'authToken':
      case 'metricsToken':
      case 'stateDir':
      case 'claudeProjectsDir':
      case 'tgBotToken':
      case 'tgGroupId':
      case 'defaultTenantId':
        config[key] = value;
        break;
      case 'isolationPolicy':
        if (value === 'respect-cc' || value === 'enforce-worktree' || value === 'enforce-direct') {
          config.isolationPolicy = value;
        } else {
          log.warn({ component: 'config', operation: 'invalidIsolationPolicy', attributes: { value } });
        }
        break;
      default:
        break;
    }
  }

  return config;
}

function applyRateLimitEnvOverrides(config: Config): Config {
  const enabled = process.env.AEGIS_RATE_LIMIT_ENABLED;
  if (enabled !== undefined) {
    config.rateLimit.enabled = enabled !== 'false';
  }
  const sessionsMax = process.env.AEGIS_RATE_LIMIT_SESSIONS_MAX;
  if (sessionsMax !== undefined) {
    config.rateLimit.sessionsMax = parseNumericEnvOverride(
      'AEGIS_RATE_LIMIT_SESSIONS_MAX', sessionsMax, config.rateLimit.sessionsMax,
      { min: 1, max: MAX_ENV_INT },
    );
  }
  const generalMax = process.env.AEGIS_RATE_LIMIT_GENERAL_MAX;
  if (generalMax !== undefined) {
    config.rateLimit.generalMax = parseNumericEnvOverride(
      'AEGIS_RATE_LIMIT_GENERAL_MAX', generalMax, config.rateLimit.generalMax,
      { min: 1, max: MAX_ENV_INT },
    );
  }
  const timeWindowSec = process.env.AEGIS_RATE_LIMIT_TIME_WINDOW_SEC;
  if (timeWindowSec !== undefined) {
    config.rateLimit.timeWindowSec = parseNumericEnvOverride(
      'AEGIS_RATE_LIMIT_TIME_WINDOW_SEC', timeWindowSec, config.rateLimit.timeWindowSec,
      { min: 1, max: MAX_ENV_INT },
    );
  }
  return config;
}

function applyEnvDenylistOverrides(config: Config): Config {
  const denylistRaw = process.env.AEGIS_ENV_DENYLIST;
  if (denylistRaw) {
    config.envDenylist = denylistRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  }
  const allowlistRaw = process.env.AEGIS_ENV_ADMIN_ALLOWLIST;
  if (allowlistRaw) {
    config.envAdminAllowlist = allowlistRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  }
  return config;
}

function applyAllowedWorkDirsEnvOverride(config: Config): Config {
  const raw = process.env.AEGIS_ALLOWED_WORK_DIRS;
  if (raw !== undefined) {
    const sep = raw.includes(';') ? ';' : (process.platform === 'win32' ? ';' : ':');
    config.allowedWorkDirs = raw.split(sep).map(s => s.trim()).filter(Boolean);
  }
  return config;
}

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

function resolveStateDir(config: Config): Config {
  const aegisDir = join(homedir(), '.aegis');
  const manusDir = join(homedir(), '.manus');
  if (config.stateDir === aegisDir && !existsSync(aegisDir) && existsSync(manusDir)) {
    log.info({ component: 'config', operation: 'legacyStateDir', attributes: { manusDir, aegisDir } });
    config.stateDir = manusDir;
  }
  return config;
}

function finalizeDerivedConfig(config: Config): Config {
  config.baseUrl = getConfiguredBaseUrl(config);
  if (config.dashboardEnabled === undefined) {
    config.dashboardEnabled = true;
  }
  return config;
}

// ── Public API ─────────────────────────────────────────────────────

export async function loadConfig(): Promise<Config> {
  const fileConfig = await loadConfigFile();
  let config: Config = { ...defaults, ...fileConfig };
  config = applyEnvOverrides(config);
  config = applyAlertingEnvOverrides(config);
  config = applyEnvDenylistOverrides(config);
  config = applyAllowedWorkDirsEnvOverride(config);
  config = applyRateLimitEnvOverrides(config);

  if (config.tgTopicTTLHours > 0) {
    config.tgTopicTtlMs = config.tgTopicTTLHours * 60 * 60 * 1000;
  }
  config = resolveStateDir(config);
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
  return finalizeDerivedConfig(config);
}

export function getConfig(): Config {
  let config: Config = { ...defaults };
  config = applyEnvOverrides(config);
  config = applyRateLimitEnvOverrides(config);
  return finalizeDerivedConfig(config);
}

export function findConfigFilePath(): string | null {
  for (const p of getConfigSearchLocations()) {
    if (existsSync(p)) return p;
  }
  return null;
}

export async function loadSpecificConfigFile(filePath: string): Promise<Partial<Config> | null> {
  return readConfigFile(filePath);
}

export async function reloadAllowedWorkDirs(explicitPath?: string): Promise<string[] | null> {
  const fileConfig = explicitPath
    ? await loadSpecificConfigFile(explicitPath)
    : await loadConfigFile();
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

export function watchConfigFile(
  onChange: (allowedWorkDirs: string[]) => void,
): FSWatcher | null {
  const configPath = findConfigFilePath();
  if (!configPath) return null;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(configPath, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void reloadAllowedWorkDirs(configPath).then((dirs) => {
        if (dirs === null) return;
        log.info({ component: 'config', operation: 'hotReload', attributes: { count: dirs.length } });
        onChange(dirs);
      });
    }, 500);
  });

  return watcher;
}

// Re-export domain schemas for direct access
export { authConfigSchema, type AuthConfig } from './auth.js';
export { channelConfigSchema, type ChannelConfig } from './channels.js';
export { serverConfigSchema, type ServerConfig } from './server.js';
export { sessionConfigSchema, type SessionConfig } from './sessions.js';
export { budgetConfigSchema, type BudgetConfig } from './budgets.js';
