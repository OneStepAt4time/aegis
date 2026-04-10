/**
 * validation.ts — Zod schemas for API request body validation.
 *
 * Issue #359: Centralized validation for all POST route bodies.
 * Issue #435: Path traversal defense in validateWorkDir.
 */

import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

/** Regex for UUID v4 format: 8-4-4-4-12 hex digits */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /v1/auth/keys */
export const authKeySchema = z.object({
  name: z.string().min(1),
  rateLimit: z.number().int().positive().optional(),
  ttlDays: z.number().int().positive().optional(),
  role: z.enum(['admin', 'operator', 'viewer']).optional(),
}).strict();

/** Maximum length for user-supplied prompts/commands (Issue #411). */
export const MAX_INPUT_LENGTH = 10_000;

/** POST /v1/sessions/:id/send */
export const sendMessageSchema = z.object({
  text: z.string().min(1).max(MAX_INPUT_LENGTH),
}).strict();

/** POST /v1/sessions/:id/command */
export const commandSchema = z.object({
  command: z.string().min(1).max(MAX_INPUT_LENGTH),
}).strict();

/** POST /v1/sessions/:id/bash */
export const bashSchema = z.object({
  command: z.string().min(1).max(MAX_INPUT_LENGTH),
}).strict();

/** POST /v1/sessions/:id/screenshot */
export const screenshotSchema = z.object({
  url: z.string().min(1),
  fullPage: z.boolean().optional(),
  width: z.number().int().positive().max(7680).optional(),
  height: z.number().int().positive().max(4320).optional(),
}).strict();

/** Webhook endpoint — validates structure of each webhook entry */
export const webhookEndpointSchema = z.object({
  url: z.string().min(1),
  events: z.array(z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  // E5-4: HMAC-SHA256 signing secret for webhook payload authentication
  secret: z.string().optional(),
  // E5-6: Redact message content from webhook payloads
  redactContent: z.boolean().optional(),
}).strict();

/** POST /v1/hooks/:eventName — CC hook event payload (Issue #665).
 *  Strict mode (Issue #1426): unknown fields are stripped before SSE delivery.
 *  tool_input uses passthrough() because Claude Code sends arbitrary tool-specific fields. */
export const hookBodySchema = z.object({
  session_id: z.string().optional(),
  agent_name: z.string().optional(),
  agent_type: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.object({ command: z.string().optional() }).passthrough().optional(),
  tool_output: z.unknown().optional(),
  tool_use_id: z.string().optional(),
  permission_prompt: z.string().optional(),
  permission_mode: z.string().optional(),
  hook_event_name: z.string().optional(),
  model: z.string().optional(),
  timestamp: z.string().optional(),
  stop_reason: z.string().optional(),
  cwd: z.string().optional(),
  command: z.string().optional(),
  worktree_path: z.string().optional(),
  // Additional fields from known CC hook events
  stop_hook_active: z.boolean().optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
  path: z.string().optional(),
  result: z.string().optional(),
}).strict();

/** POST /v1/sessions/:id/hooks/permission */
export const permissionHookSchema = z.object({
  session_id: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.unknown().optional(),
  permission_mode: z.string().optional(),
  hook_event_name: z.string().optional(),
}).strict();

/** POST /v1/sessions/:id/hooks/stop */
export const stopHookSchema = z.object({
  session_id: z.string().optional(),
  stop_reason: z.string().optional(),
  hook_event_name: z.string().optional(),
}).strict();

const batchSessionSpecSchema = z.object({
  name: z.string().max(200).optional(),
  workDir: z.string().min(1),
  prompt: z.string().max(100_000).optional(),
  permissionMode: z.enum(['default', 'bypassPermissions', 'plan', 'acceptEdits', 'dontAsk', 'auto']).optional(),
  autoApprove: z.boolean().optional(),
  stallThresholdMs: z.number().int().positive().max(3_600_000).optional(),
});

/** POST /v1/sessions/batch — max 50 sessions per batch */
export const batchSessionSchema = z.object({
  sessions: z.array(batchSessionSpecSchema).min(1).max(50),
}).strict();

const pipelineStageSchema = z.object({
  name: z.string().min(1),
  workDir: z.string().min(1).optional(),
  prompt: z.string().min(1).max(MAX_INPUT_LENGTH),
  dependsOn: z.array(z.string()).optional(),
  permissionMode: z.enum(['default', 'bypassPermissions', 'plan', 'acceptEdits', 'dontAsk', 'auto']).optional(),
  autoApprove: z.boolean().optional(),
});

/** POST /v1/pipelines */
export const pipelineSchema = z.object({
  name: z.string().min(1),
  workDir: z.string().min(1),
  stages: z.array(pipelineStageSchema).min(1).max(50),
}).strict();

/** POST /v1/handshake */
export const handshakeRequestSchema = z.object({
  protocolVersion: z.string().min(1),
  clientCapabilities: z.array(z.string().min(1)).optional(),
  clientVersion: z.string().min(1).optional(),
}).strict();

/** Clamp a numeric value to [min, max]. Returns default if input is NaN. */
export function clamp(value: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

/** Parse an env string to integer with NaN/isFinite guard. Returns fallback on failure. */
export function parseIntSafe(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

/** Validate that a string looks like a UUID. */
export function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

// ── JSON.parse boundary validation (Issue #410) ──────────────────

const UIStateEnum = z.enum([
  'idle', 'working', 'compacting', 'context_warning', 'waiting_for_input',
  'permission_prompt', 'bash_approval', 'plan_mode', 'ask_question',
  'settings', 'error', 'unknown',
]);

/** Issue #700: Permission Policy Schema */
export const permissionRuleSchema = z.object({
  source: z.enum(['userSettings', 'projectSettings', 'localSettings', 'flagSettings', 'aegisApi']),
  ruleBehavior: z.enum(['allow', 'deny', 'ask']),
  toolName: z.string().optional(),
  commandPattern: z.string().optional(),
});
export type PermissionPolicy = z.infer<typeof permissionRuleSchema>[];

/** Issue #742: richer per-session permission profile. */
export const permissionConstraintSchema = z.object({
  readOnly: z.boolean().optional(),
  paths: z.array(z.string().min(1)).max(50).optional(),
  maxFileSize: z.number().int().positive().max(10_000_000).optional(),
}).strict();

export const permissionProfileRuleSchema = z.object({
  tool: z.string().min(1),
  behavior: z.enum(['allow', 'deny', 'ask']),
  pattern: z.string().optional(),
  constraints: permissionConstraintSchema.optional(),
}).strict();

export const permissionProfileSchema = z.object({
  defaultBehavior: z.enum(['allow', 'deny', 'ask']),
  rules: z.array(permissionProfileRuleSchema).max(100),
}).strict();

export type PermissionProfile = z.infer<typeof permissionProfileSchema>;

/** Schema for persisted SessionState (sessions: { [id]: SessionInfo }). */
export const persistedStateSchema = z.record(
  z.string(),
  z.object({
    id: z.string(),
    windowId: z.string(),
    windowName: z.string(),
    workDir: z.string(),
    claudeSessionId: z.string().optional(),
    jsonlPath: z.string().optional(),
    byteOffset: z.number(),
    monitorOffset: z.number(),
    status: UIStateEnum,
    createdAt: z.number(),
    lastActivity: z.number(),
    stallThresholdMs: z.number(),
    permissionStallMs: z.number().default(300_000),
    permissionMode: z.enum(['default', 'bypassPermissions', 'plan', 'acceptEdits', 'dontAsk', 'auto']),
    settingsPatched: z.boolean().optional(),
    hookSettingsFile: z.string().optional(),
    lastHookAt: z.number().optional(),
    activeSubagents: z.array(z.string()).optional(),
    permissionPromptAt: z.number().optional(),
    permissionRespondedAt: z.number().optional(),
    lastHookReceivedAt: z.number().optional(),
    lastHookEventAt: z.number().optional(),
    model: z.string().optional(),
    lastDeadAt: z.number().optional(),
    ccPid: z.number().optional(),
    parentId: z.string().uuid().optional(),
    children: z.array(z.string().uuid()).optional(),
    permissionPolicy: z.array(z.object({
      source: z.enum(['userSettings', 'projectSettings', 'localSettings', 'flagSettings', 'aegisApi']),
      ruleBehavior: z.enum(['allow', 'deny', 'ask']),
      toolName: z.string().optional(),
      commandPattern: z.string().optional(),
    })).optional(),
    permissionProfile: permissionProfileSchema.optional(),
    ownerKeyId: z.string().optional(),
  }),
);

/** Schema for a single continuation pointer entry in session_map.json (Issue #900). */
export const sessionMapEntrySchema = z.object({
  session_id: z.string(),
  cwd: z.string(),
  window_name: z.string(),
  transcript_path: z.string().nullable().optional(),
  permission_mode: z.string().nullable().optional(),
  agent_id: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  agent_type: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  written_at: z.number(),
  schema_version: z.number().int().positive().optional(),
  expires_at: z.number().optional(),
});

/** Schema for session_map.json entries. */
export const sessionMapSchema = z.record(z.string(), sessionMapEntrySchema);

/** Incoming Stop/StopFailure hook payload (Issue #515). */
export const stopPayloadSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
  error_details: z.unknown().optional(),
  last_assistant_message: z.unknown().optional(),
  agent_id: z.string().optional(),
  stop_reason: z.string().optional(),
}).passthrough();

/** Schema for stop_signals.json entries. */
export const stopSignalsSchema = z.record(
  z.string(),
  z.object({
    event: z.string().optional(),
    timestamp: z.number().optional(),
    error: z.unknown().optional(),
    error_details: z.unknown().optional(),
    last_assistant_message: z.unknown().optional(),
    agent_id: z.unknown().optional(),
    stop_reason: z.string().optional(),
  }),
);

/** Schema for persisted auth keys store (Issue #506). */
export const authStoreSchema = z.object({
  keys: z.array(z.object({
    id: z.string(),
    name: z.string(),
    hash: z.string(),
    createdAt: z.number(),
    lastUsedAt: z.number(),
    rateLimit: z.number(),
    expiresAt: z.number().nullable().optional().default(null),
    role: z.enum(['admin', 'operator', 'viewer']).optional().default('viewer'),
  })),
});

/** Schema for sessions-index.json entries (Issue #506). */
export const sessionsIndexSchema = z.object({
  entries: z.array(z.object({
    sessionId: z.string(),
    fullPath: z.string(),
  })).optional(),
});

/** Schema for persisted metrics file (Issue #506). */
export const metricsFileSchema = z.object({
  global: z.object({
    sessionsCreated: z.number().optional(),
    sessionsCompleted: z.number().optional(),
    sessionsFailed: z.number().optional(),
    totalMessages: z.number().optional(),
    totalToolCalls: z.number().optional(),
    autoApprovals: z.number().optional(),
    webhooksSent: z.number().optional(),
    webhooksFailed: z.number().optional(),
    screenshotsTaken: z.number().optional(),
    pipelinesCreated: z.number().optional(),
    batchesCreated: z.number().optional(),
    promptsSent: z.number().optional(),
    promptsDelivered: z.number().optional(),
    promptsFailed: z.number().optional(),
  }).passthrough().optional(),
  savedAt: z.number().optional(),
}).passthrough();

/** Schema for WebSocket inbound messages (Issue #506). */
export const wsInboundMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), text: z.string() }).strict(),
  z.object({ type: z.literal('resize'), cols: z.number().optional(), rows: z.number().optional() }).strict(),
  z.object({ type: z.literal('auth'), token: z.string().optional() }).strict(),
]);

/** Schema for CC settings.json shape (Issue #506).
 *  Permissive — only validates the fields Aegis cares about. */
export const ccSettingsSchema = z.object({
  permissions: z.object({
    defaultMode: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

/** Helper: extract error message from unknown catch value. */
export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
}

// ── CC version validation (Issue #564) ─────────────────────────────────

/** Minimum supported Claude Code version. */
export const MIN_CC_VERSION = '2.1.80';

/** Parse a semver string into [major, minor, patch], or null if invalid. */
export function parseSemver(v: string): [number, number, number] | null {
  const match = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compare two semver strings.
 * Returns -1 if a < b or either is unparseable (fails closed), 0 if equal, 1 if a > b.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return -1;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

/** Extract version number from `claude --version` output. */
export function extractCCVersion(output: string): string | null {
  const match = output.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/** Default safe base directories used when allowedWorkDirs is not configured.
 *  Prevents sessions from running in system-critical directories.
 *  Includes os.tmpdir() to cover platform-specific temp paths
 *  (e.g. macOS /var/folders/... which differs from /tmp). */
function getDefaultSafeDirs(): string[] {
  const dirs = [
    os.homedir(),
    '/tmp',
    '/var/tmp',
    process.cwd(),
  ];
  const osTmp = os.tmpdir();
  if (!dirs.includes(osTmp)) {
    dirs.push(osTmp);
  }
  return dirs;
}

/** Returns true when any path segment resolves to "..".
 *  Checks raw, separator-normalized, and percent-decoded forms to catch
 *  encoded traversal like %2e%2e and mixed slash/backslash payloads. */
export function containsTraversalSegment(inputPath: string): boolean {
  const hasTraversalInSegments = (candidate: string): boolean => {
    const normalizedSeparators = candidate.replace(/[\\/]+/g, '/');
    const segments = normalizedSeparators.split('/');
    return segments.some((segment) => segment === '..');
  };

  let candidate = inputPath;
  for (let i = 0; i < 4; i++) {
    if (hasTraversalInSegments(candidate)) return true;
    let decoded: string;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      decoded = candidate;
    }
    if (decoded === candidate) break;
    candidate = decoded;
  }

  return false;
}

/** Normalize path for consistent boundary comparisons. */
function normalizeForBoundaryCheck(inputPath: string): string {
  const resolved = path.normalize(path.resolve(inputPath));
  const root = path.parse(resolved).root;
  const trimmed = resolved.length > root.length
    ? resolved.replace(/[\\/]+$/g, '')
    : resolved;
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/** Check whether `childPath` is equal to or under `parentPath`. */
function isUnderOrEqual(childPath: string, parentPath: string): boolean {
  const normalizedChild = normalizeForBoundaryCheck(childPath);
  const normalizedParent = normalizeForBoundaryCheck(parentPath);
  if (normalizedChild === normalizedParent) return true;

  const relative = path.relative(normalizedParent, normalizedChild);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Validate workDir to prevent path traversal attacks (Issue #435).
 *  1. Reject raw strings containing ".." before any normalization.
 *  2. Resolve to absolute path and resolve symlinks via fs.realpath().
 *  3. Verify the resolved path is under an allowed directory:
 *     - If allowedWorkDirs is configured, use that list.
 *     - Otherwise, use default safe dirs (home, /tmp, cwd).
 *  Returns the resolved real path on success, or an error object on failure. */
export async function validateWorkDir(
  workDir: string,
  allowedWorkDirs: readonly string[] = [],
): Promise<string | { error: string; code: string }> {
  if (typeof workDir !== 'string') return { error: 'workDir must be a string', code: 'INVALID_WORKDIR' };

  // Step 1: Reject path traversal in raw/mixed/decoded forms before resolution.
  if (containsTraversalSegment(workDir)) {
    return { error: 'workDir must not contain path traversal components (..)', code: 'INVALID_WORKDIR' };
  }

  // Step 2: Resolve to absolute path and follow symlinks.
  const resolved = path.resolve(workDir);
  let realPath: string;
  try {
    realPath = await fs.realpath(resolved);
  } catch { /* path does not exist on disk */
    return { error: `workDir does not exist: ${resolved}`, code: 'INVALID_WORKDIR' };
  }

  // Step 3: Directory allowlist check.
  const safeDirCandidates = allowedWorkDirs.length > 0
    ? allowedWorkDirs.map((dir) => path.resolve(dir))
    : getDefaultSafeDirs().map((dir) => path.resolve(dir));

  const safeDirs = await Promise.all(safeDirCandidates.map(async (dir) => {
    try {
      return await fs.realpath(dir);
    } catch {
      return dir;
    }
  }));

  const allowed = safeDirs.some((dir) => isUnderOrEqual(realPath, dir));
  if (!allowed) {
    return { error: 'workDir is not in the allowed directories list', code: 'INVALID_WORKDIR' };
  }

  return realPath;
}

/** Schema for aegis config file (Issue #1109). */
export const configFileSchema = z.object({
  port: z.number().int().positive().optional(),
  host: z.string().optional(),
  authToken: z.string().optional(),
  tmuxSession: z.string().optional(),
  stateDir: z.string().optional(),
  claudeProjectsDir: z.string().optional(),
  maxSessionAgeMs: z.number().int().positive().optional(),
  reaperIntervalMs: z.number().int().positive().optional(),
  continuationPointerTtlMs: z.number().int().positive().optional(),
  tgBotToken: z.string().optional(),
  tgGroupId: z.string().optional(),
  tgAllowedUsers: z.array(z.number()).optional(),
  tgTopicTtlMs: z.number().int().positive().optional(),
  webhooks: z.array(z.string()).optional(),
  defaultSessionEnv: z.record(z.string(), z.string()).optional(),
  defaultPermissionMode: z.enum(["default", "plan", "acceptEdits", "bypassPermissions", "dontAsk", "auto"]).optional(),
  stallThresholdMs: z.number().int().positive().optional(),
  sseMaxConnections: z.number().int().positive().optional(),
  sseMaxPerIp: z.number().int().positive().optional(),
  allowedWorkDirs: z.array(z.string()).optional(),
  worktreeAwareContinuation: z.boolean().optional(),
  memoryBridge: z.object({
    enabled: z.boolean(),
    persistPath: z.string().optional(),
    reaperIntervalMs: z.number().int().positive().optional(),
  }).optional(),
  worktreeSiblingDirs: z.array(z.string()).optional(),
  verificationProtocol: z.object({
    autoVerifyOnStop: z.boolean(),
    criticalOnly: z.boolean(),
  }).partial().optional(),
  alerting: z.object({
    webhooks: z.array(z.string()).optional(),
    failureThreshold: z.number().int().positive().optional(),
    cooldownMs: z.number().int().positive().optional(),
  }).partial().optional(),
});

