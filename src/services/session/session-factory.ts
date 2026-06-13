/**
 * session-factory.ts — Pure session construction logic extracted from SessionManager.
 *
 * Handles the computational steps of creating a SessionInfo object without
 * touching SessionManager state (sessions map, persistence, discovery, etc.).
 */

import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import type { Config } from '../../config.js';
import { computeStallThreshold } from '../../config.js';
import { getConfiguredBaseUrl } from '../../base-url.js';
import { validateWorkdirPath } from '../../tenant-workdir.js';
import {
  neutralizeBypassPermissions,
  activateBypassPermissions,
} from '../../permission-guard.js';
import { sanitizeWindowName } from '../../validation.js';
import { writeHookSettingsFile, cleanupStaleSessionHooks } from '../../hook-settings.js';
import { sanitizeSessionEnv } from '../../session-env.js';
import {
  detectIsolationMode,
  detectModelFromSettings,
} from '../../session-helpers.js';
import { createSessionWorktree } from './worktree.js';
import type { SessionInfo, UIState } from '../../session-types.js';
import { StructuredLogger } from '../../logger.js';

const log = new StructuredLogger();

const DEFAULT_STALL_THRESHOLD_MS = computeStallThreshold();
const DEFAULT_PERMISSION_STALL_MS = 5 * 60 * 1000;

/** Cache for hook cleanup to avoid running on every createSession (Issue #1134). */
let lastCleanupTime = 0;
let lastCleanupWorkDir = '';
const CLEANUP_TTL_MS = 30_000;

/** Minimal reference to an existing session for name dedup and resume lookup. */
export interface ExistingSessionRef {
  id: string;
  tenantId: string;
  displayName: string;
  model?: string;
  effort?: string;
}

/** Options for creating a session (mirrors the SessionManager.createSession param type). */
export interface CreateSessionOpts {
  id?: string;
  workDir: string;
  name?: string | null;
  prd?: string;
  resumeSessionId?: string;
  claudeCommand?: string;
  env?: Record<string, string>;
  stallThresholdMs?: number;
  permissionStallMs?: number;
  permissionMode?: string;
  /** @deprecated Use permissionMode instead. */
  autoApprove?: boolean;
  parentId?: string;
  ownerKeyId?: string | null;
  tenantId?: string;
  initialStatus?: UIState;
  model?: string;
  effort?: string;
  runnerName?: string;
  isolationPolicy?: 'respect-cc' | 'enforce-worktree' | 'enforce-direct';
}

/** Result of building a session: the SessionInfo plus metadata. */
export interface BuildSessionResult {
  session: SessionInfo;
}

/**
 * Pure-ish factory that computes a SessionInfo object.
 *
 * Performs: validation, name dedup, env merge, permission resolution,
 * hook secret generation, isolation detection, and hook settings file creation.
 *
 * Does NOT touch SessionManager.state or persistence — the caller handles that.
 */
export async function buildSessionInfo(
  id: string,
  opts: CreateSessionOpts,
  config: Config,
  existingSessions: ExistingSessionRef[],
  activeSessionIds: Set<string>,
): Promise<BuildSessionResult> {
  // Step 1: Validate workdir path against tenant namespace
  const workdirValidation = validateWorkdirPath(opts.tenantId, opts.workDir, config);
  if (!workdirValidation.allowed) {
    throw new Error(workdirValidation.reason ?? 'workDir is outside tenant root');
  }

  // Step 2: Compute display name with deduplication (per-tenant scope)
  const candidateName = opts.name
    ? String(opts.name)
    : basename(opts.workDir || '') || `cc-${id.slice(0, 8)}`;
  let displayName = sanitizeWindowName(candidateName);
  if (displayName.length > 200) displayName = displayName.slice(0, 200);

  const existing = existingSessions
    .filter(s => s.tenantId === opts.tenantId)
    .map(s => s.displayName);
  if (existing.includes(displayName)) {
    let suffix = 1;
    const originalBase = displayName;
    while (existing.includes(displayName)) {
      const suffixStr = `-${suffix}`;
      const maxBaseLen = 200 - suffixStr.length;
      displayName = `${originalBase.slice(0, maxBaseLen)}${suffixStr}`;
      suffix++;
    }
  }

  // Step 3: Merge defaultSessionEnv with per-session env
  const mergedEnv = sanitizeSessionEnv(config.defaultSessionEnv, opts.env);
  void mergedEnv;

  // Step 4: Resolve effective permission mode + settings patching
  const effectivePermissionMode = opts.permissionMode
    ?? (opts.autoApprove === true ? 'bypassPermissions' : opts.autoApprove === false ? 'default' : undefined)
    ?? config.defaultPermissionMode
    ?? 'default';
  let settingsPatched = false;
  if (effectivePermissionMode === 'bypassPermissions') {
    settingsPatched = await activateBypassPermissions(opts.workDir);
  } else {
    settingsPatched = await neutralizeBypassPermissions(opts.workDir, effectivePermissionMode);
  }

  // Step 5: Generate per-session HMAC secret for hook URL authentication
  const hookSecret = randomBytes(32).toString('hex');

  // Step 6: Detect isolation mode and enforce policy
  const detectedIsolation = await detectIsolationMode(opts.workDir).catch(() => undefined);
  const detectedModel = await detectModelFromSettings(opts.workDir).catch(() => undefined);
  let isolationMode: 'worktree' | 'none' = detectedIsolation ?? 'worktree';

  const policy = opts.isolationPolicy ?? config.isolationPolicy;
  if (policy === 'enforce-worktree' && isolationMode === 'none') {
    log.warn({ component: 'session', operation: 'worktreePolicyRejected', sessionId: id, attributes: { policy, detectedIsolation: 'none' } });
    throw new SessionCreationError(
      `Session rejected: isolation policy is 'enforce-worktree' but CC settings have bgIsolation="none". ` +
      `Set worktree.bgIsolation to "worktree" in .claude/settings.json or change the server isolation policy.`
    );
  }
  if (policy === 'enforce-direct') {
    if (isolationMode !== 'none') {
      log.warn({ component: 'session', operation: 'directPolicyOverride', sessionId: id });
    }
    isolationMode = 'none';
  }

  // Step 7: Cleanup stale session hooks + write hook settings file
  const now = Date.now();
  if (now - lastCleanupTime < CLEANUP_TTL_MS && lastCleanupWorkDir === opts.workDir) {
    // Skipped: cleanup ran recently for this workDir
  } else {
    try {
      activeSessionIds.add(id);
      if (activeSessionIds.size > 0) {
        await cleanupStaleSessionHooks(opts.workDir, activeSessionIds);
        lastCleanupTime = now;
        lastCleanupWorkDir = opts.workDir;
      }
    } catch (e) {
      log.warn({ component: 'session', operation: 'hookCleanupFailed', attributes: { error: (e as Error).message } });
    }
  }

  let hookSettingsFile: string | undefined;
  try {
    const baseUrl = getConfiguredBaseUrl(config);
    hookSettingsFile = await writeHookSettingsFile(baseUrl, id, hookSecret, opts.workDir);
  } catch (e) {
    log.error({ component: 'session', operation: 'hookSettingsGenerateFailed', attributes: { error: (e as Error).message } });
  }

  // Step 8: Resolve effective model/effort (including resume carryover)
  let effectiveModel = opts.model || detectedModel;
  let effectiveEffort = opts.effort;
  if (opts.resumeSessionId && !opts.model) {
    const oldSession = existingSessions.find(s => s.id === opts.resumeSessionId);
    if (oldSession?.model) {
      effectiveModel = oldSession.model;
    }
    if (!opts.effort && oldSession?.effort) {
      effectiveEffort = oldSession.effort;
    }
  }

  // Issue #4694: Create git worktree for session isolation when mode is 'worktree'
  let effectiveWorkDir = opts.workDir;
  if (isolationMode === 'worktree') {
    const worktreeResult = createSessionWorktree(opts.workDir, id);
    if (worktreeResult.path !== opts.workDir) {
      effectiveWorkDir = worktreeResult.path;
      log.info({
        component: 'session',
        operation: 'worktreeIsolationActive',
        sessionId: id,
        attributes: { worktreePath: effectiveWorkDir, branch: worktreeResult.branch },
      });
    }
  }

  // Step 9: Build the SessionInfo object
  const session: SessionInfo = {
    id,
    windowId: '',
    displayName,
    workDir: effectiveWorkDir,
    claudeSessionId: undefined,
    byteOffset: 0,
    monitorOffset: 0,
    status: opts.initialStatus ?? 'pending' as UIState,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    latestActivityText: 'Starting session',
    stallThresholdMs: opts.stallThresholdMs || DEFAULT_STALL_THRESHOLD_MS,
    permissionStallMs: opts.permissionStallMs || DEFAULT_PERMISSION_STALL_MS,
    permissionMode: effectivePermissionMode,
    settingsPatched,
    hookSettingsFile,
    hookSecret,
    prd: opts.prd,
    ownerKeyId: opts.ownerKeyId ?? undefined,
    tenantId: opts.tenantId,
    model: effectiveModel,
    effort: effectiveEffort,
    runnerName: opts.runnerName,
    isolationMode,
    isolationPolicy: policy,
  };

  return { session };
}

/** Issue #3613: Error thrown when session creation is rejected by isolation policy. */
export class SessionCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionCreationError';
  }
}

/** Reset cleanup cache (for testing). */
export function resetCleanupCache(): void {
  lastCleanupTime = 0;
  lastCleanupWorkDir = '';
}
