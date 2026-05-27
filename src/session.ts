/**
 * session.ts — Session state manager.
 * 
 * Manages the lifecycle of CC sessions (ACP mode).
 * Tracks: session ID, window ID, byte offset for JSONL reading, status.
 */

import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import type { StateStore, SerializedSessionState } from './services/state/state-store.js';
import { readNewEntries, type ParsedEntry } from './transcript.js';
import { SessionTranscripts } from './session-transcripts.js';
import { SessionDiscovery } from './session-discovery.js';
import type { Config } from './config.js';
import { computeStallThreshold } from './config.js';
import { getConfiguredBaseUrl } from './base-url.js';
import { validateWorkdirPath } from './tenant-workdir.js';
import { neutralizeBypassPermissions, activateBypassPermissions, restoreSettings, cleanOrphanedBackup } from './permission-guard.js';
import { persistedStateSchema, type PermissionPolicy, type PermissionProfile, ENV_NAME_RE, ENV_DENYLIST, ENV_DANGEROUS_PREFIXES, stripCrLf, hasControlChars, ENV_VALUE_MAX_BYTES, sanitizeWindowName } from './validation.js';
import type { z } from 'zod';
import { writeHookSettingsFile, cleanupHookSettingsFile, cleanupStaleSessionHooks } from './hook-settings.js';
// PermissionDecision and request management now via SessionPermissionService
import { QuestionManager } from './question-manager.js';
import { Mutex } from 'async-mutex';
import { maybeInjectFault } from './fault-injection.js';
import type { Span } from '@opentelemetry/api';
import type { PendingPermissionInfo, PendingQuestionInfo } from './api-contracts.js';
import { startSessionSpan, spanError, spanOk } from './tracing.js';
import { StructuredLogger } from './logger.js';
import { SessionPersistenceService } from './services/session/persistence.js';
import { SessionPermissionService, resolveApprovalInput, normalizeApprovalLabel, type PermissionDecision } from './services/session/permissions.js';
export { resolveApprovalInput };
const log = new StructuredLogger();

// Re-export types from session-types.ts for backward compatibility
import type { UIState, SessionInfo, SessionState, PersistedStateData } from './session-types.js';
export type { UIState, SessionInfo, SessionState, PersistedStateData };

import { detectUIState, hasBlankPromptNearBottom, detectApprovalMethod } from './session-ui-parser.js';
import { recordHookFailure as _recordHookFailure, recordHookSuccess as _recordHookSuccess, checkHookCircuitBreaker as _checkHookCircuitBreaker } from './session-hook-circuit-breaker.js';
export { detectUIState, hasBlankPromptNearBottom, detectApprovalMethod };

/** Convert parsed JSON arrays to Sets for activeSubagents (#668). */
// Cache for hook cleanup to avoid running on every createSession (Issue #1134).
// TTL of 30 seconds prevents redundant disk I/O during batch session creation.
let lastCleanupTime = 0;
let lastCleanupWorkDir = '';
const CLEANUP_TTL_MS = 30_000;

/** Issue #1798: Maximum time (ms) sendMessage waits for CC to become idle. */
const SEND_MESSAGE_IDLE_TIMEOUT_MS = 30_000;
/** Issue #1798: Poll interval (ms) when waiting for CC idle state. */
const SEND_MESSAGE_IDLE_POLL_MS = 500;

// hasBlankPromptNearBottom moved to session-ui-parser.ts

function hydrateSessions(raw: z.infer<typeof persistedStateSchema>): Record<string, SessionInfo> {
  const sessions: Record<string, SessionInfo> = Object.create(null);
  for (const [id, s] of Object.entries(raw)) {
    const { activeSubagents, displayName, ...rest } = s as Record<string, unknown>;
    sessions[id] = {
      ...rest,
      displayName: (typeof (rest as Record<string, unknown>).displayName === 'string'
        ? (rest as Record<string, unknown>).displayName
        : typeof displayName === 'string' ? displayName : id.slice(0, 8)) as string,
      activeSubagents: activeSubagents ? new Set(activeSubagents as string[]) : undefined,
    } as SessionInfo;
  }
  return sessions;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Canonical runtime metadata for an Aegis-managed Claude Code session.
 *
 * This structure is persisted to disk and reused by the REST API, SSE layer,
 * monitoring loop, and session recovery logic.
 */
// SessionInfo and SessionState now in session-types.ts (re-exported above)

/**
 * Detect whether CC is showing numbered permission options (e.g. "1. Yes, 2. No")
 * vs a simple y/N prompt. Returns the approval method to use.
 *
 * CC's permission UI uses indented numbered lines with "Esc to cancel" nearby.
 * We look for the pattern "  <N>. <option>" where N is 1-3, which distinguishes
 * permission options from regular numbered lists in output.
 */
// detectApprovalMethod moved to session-ui-parser.ts (re-exported above)




/** Issue #3740: Detect the model name from Claude Code settings files.
 * Reads ANTHROPIC_MODEL from env in settings.local.json or settings.json. */
async function detectModelFromSettings(workDir: string): Promise<string | undefined> {
  const candidates = [
    join(workDir, '.claude', 'settings.local.json'),
    join(workDir, '.claude', 'settings.json'),
    join(homedir(), '.claude', 'settings.local.json'),
    join(homedir(), '.claude', 'settings.json'),
  ];
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const raw = await readFile(p, { encoding: 'utf8' }).catch(() => undefined);
      if (!raw) continue;
      let obj: any;
      try { obj = JSON.parse(raw); } catch { continue; }
      const model = obj?.env?.ANTHROPIC_MODEL;
      if (typeof model === 'string' && model.length > 0) return model;
    } catch { continue; }
  }
  return undefined;
}

/** Detect session isolation mode from project or global Claude Code settings. */
async function detectIsolationMode(workDir: string): Promise<'worktree' | 'none' | undefined> {
  const candidates = [
    join(workDir, '.claude', 'settings.local.json'),
    join(workDir, '.claude', 'settings.json'),
    join(homedir(), '.claude', 'settings.local.json'),
    join(homedir(), '.claude', 'settings.json'),
  ];

  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const raw = await readFile(p, { encoding: 'utf8' }).catch(() => undefined);
      if (!raw) continue;
      let obj: any;
      try { obj = JSON.parse(raw); } catch { continue; }
      const val = obj?.worktree?.bgIsolation;
      if (typeof val === 'string') {
        if (val === 'none') return 'none';
        if (val === 'worktree') return 'worktree';
      }
    } catch (_) {
      // ignore and continue
    }
  }
  return undefined;
}

function getUiApprovalInput(
  paneText: string,
  action: 'approve' | 'reject',
  permissionMode: string,
): string | null {
  const state = detectUIState(paneText);
  if (state !== 'permission_prompt' && state !== 'plan_mode' && state !== 'bash_approval') {
    return null;
  }
  return resolveApprovalInput(paneText, action, permissionMode);
}

/** Resolves a pending PermissionRequest hook with a decision. */
export type { PermissionDecision };

/**
 * Coordinates session lifecycle, persistence, transcript discovery, and
 * interactive approval/question flows for all managed Claude Code sessions.
 */
/** Issue #3613: Error thrown when session creation is rejected by isolation policy. */
export class SessionCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionCreationError';
  }
}

export class SessionManager {
  private state: SessionState = { sessions: Object.create(null) as Record<string, SessionInfo> };
  private stateFile: string;
  private sessionMapFile: string;
  /** Issue #4251: Delegated persistence service. */
  private readonly persistence: SessionPersistenceService;
  /** #4228: Encryption delegated to persistence.encryption. */
  private readonly permissions = new SessionPermissionService();
  private questions = new QuestionManager();
  // Issue #657: Cached session list to avoid allocating a new array per call
  private sessionsListCache: SessionInfo[] | null = null;
  // Issue #840/#880: Explicit mutex to prevent TOCTOU races in session acquisition.
  private readonly sessionAcquireMutex = new Mutex();
  // ARC-3: Extracted services
  private readonly transcripts: SessionTranscripts;
  private readonly discovery: SessionDiscovery;
  /** Issue #1937: Pluggable persistence backend (null = legacy file I/O). */
  private readonly store: StateStore | null;
  /** Issue #4092: Recovery callback for sessions stuck in awaiting_approval after restart. */
  onSessionApprovalRecovery: ((session: SessionInfo) => void) | null = null;
  /** Issue #4114: Active approval timeouts — session ID → timeout handle. */
  private readonly approvalTimeouts = new Map<string, NodeJS.Timeout>();
  /** Issue #4124: Periodic cleanup timer for killed sessions. */
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private config: Config,
    store?: StateStore,
  ) {
    this.stateFile = join(config.stateDir, 'state.json');
    this.sessionMapFile = join(config.stateDir, 'session_map.json');
    this.store = store ?? null;
    // Issue #4251: Create delegated persistence service
    this.persistence = new SessionPersistenceService(this.stateFile, this.store);
    this.transcripts = new SessionTranscripts(config);
    this.discovery = new SessionDiscovery(
      {
        getSession: (id) => this.state.sessions[id] || null,
        getAllSessions: () => Object.values(this.state.sessions),
        save: () => this.save(),
      },
      config,
      this.sessionMapFile,
    );
  }

  /** Load state from disk or the configured store (Issue #1937).
   *  Issue #4251: Delegates to SessionPersistenceService for persistence. */
  async load(): Promise<void> {
    this.state = await this.persistence.load();
    await this.restoreSessionHookSecrets();

    // Write backup of successfully loaded state
    await this.persistence.writeBackup(this.state);

    // Issue #657: Invalidate sessions list cache after loading state
    this.invalidateSessionsListCache();

    // Issue #4092: Recover sessions stuck in awaiting_approval after server restart.
    const stuckSessions = Object.values(this.state.sessions).filter(
      (s) => s.status === 'awaiting_approval'
    );
    if (stuckSessions.length > 0) {
      log.warn({ component: 'session', operation: 'recoveringStuckApprovals', attributes: { count: stuckSessions.length } });
      for (const session of stuckSessions) {
        this.emitSessionAwaitingApproval(session);
      }
    }
  }
  /** Save state to disk atomically (write to temp, then rename).
   *  #218: Uses a write queue to serialize concurrent saves and prevent corruption.
   *  Issue #4251: Delegates to SessionPersistenceService. */
  async save(): Promise<void> {
    await this.persistence.save(this.state);
  }

  /** #357: Debounced save — skips immediate save for offset-only changes.
   *  Coalesces rapid successive reads into a single disk write.
   *  Issue #4251: Delegates to SessionPersistenceService. */
  debouncedSave(): void {
    this.persistence.debouncedSave(this.state);
  }

  /** Issue #4251: Serialization is delegated to SessionPersistenceService. */
  private serializeState(): string {
    return this.persistence.serializeState(this.state);
  }

  /** Issue #4251: Store serialization is delegated to SessionPersistenceService. */
  private serializeStateForStore(): SerializedSessionState {
    return this.persistence.serializeStateForStore(this.state);
  }

  /** Issue #3143: Wire ACP event store into transcript reader. */
  setAcpEventStore(store: import("./services/acp/event-store.js").AcpEventStore): void {
    this.transcripts.setAcpEventStore(store);
  }

  setEncryptionKey(masterToken: string): void {
    if (!masterToken) return;
    // Issue #4228: Delegate to persistence service's encryption
    this.persistence.setEncryptionKey(masterToken);
  }

  /** Encrypt a hook secret. Delegates to persistence encryption service. */
  private encryptSecret(secret: string): string {
    return this.persistence.encryptSecret(secret);
  }

  /** Decrypt a hook secret. Delegates to persistence encryption service. */
  private decryptSecret(encrypted: string): string | undefined {
    return this.persistence.decryptSecret(encrypted);
  }

  private async restoreSessionHookSecrets(): Promise<void> {
    for (const session of Object.values(this.state.sessions)) {
      // #1644: Decrypt if the stored value is an AES-GCM ciphertext (iv:tag:enc format).
      // Plaintext hookSecrets are 64-char hex strings with no colons.
      if (session.hookSecret?.includes(':') && this.persistence.hasEncryptionKey()) {
        const decrypted = this.persistence.decryptSecret(session.hookSecret);
        if (decrypted) { session.hookSecret = decrypted; continue; }
        session.hookSecret = undefined; // Decryption failed — force re-read below
      }
      if (session.hookSecret) continue; // Already plaintext
      // Fall back to reading the hook settings file.
      if (session.hookSettingsFile) {
        session.hookSecret = await this.readHookSecretFromSettingsFile(session.hookSettingsFile);
      }
    }
  }
  private async readHookSecretFromSettingsFile(settingsPath: string): Promise<string | undefined> {
    try {
      const raw = await readFile(settingsPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (!isObjectRecord(parsed) || !isObjectRecord(parsed.hooks)) return undefined;

      for (const eventEntries of Object.values(parsed.hooks)) {
        if (!Array.isArray(eventEntries)) continue;
        for (const entry of eventEntries) {
          if (!isObjectRecord(entry) || !Array.isArray(entry.hooks)) continue;
          for (const hook of entry.hooks) {
            if (!isObjectRecord(hook) || !isObjectRecord(hook.headers)) continue;
            const secret = hook.headers['X-Hook-Secret'];
            if (typeof secret === 'string' && secret.length > 0) {
              return secret;
            }
          }
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  /** Default stall threshold: 2 min (Issue #392: 1.5x CC's 90s default, configurable via CLAUDE_STREAM_IDLE_TIMEOUT_MS). */
  static readonly DEFAULT_STALL_THRESHOLD_MS = computeStallThreshold();
  static readonly DEFAULT_PERMISSION_STALL_MS = 5 * 60 * 1000;

  /** Create a new CC session. */
  /** Default timeout for waiting CC to become ready (60s for cold starts). */
  static readonly DEFAULT_PROMPT_TIMEOUT_MS = 60_000;

  /** Max retries if CC doesn't become ready in time. */
  static readonly DEFAULT_PROMPT_MAX_RETRIES = 2;


  /** Wait for CC idle prompt, then send. Single attempt. */


  async createSession(opts: {
    id?: string;
    workDir: string;
    name?: string;
    prd?: string;
    resumeSessionId?: string;
    claudeCommand?: string;
    env?: Record<string, string>;
    stallThresholdMs?: number;
    permissionStallMs?: number;    // Issue #89 L8: per-session permission stall threshold
    permissionMode?: string;
    /** @deprecated Use permissionMode instead. Maps true→bypassPermissions, false→default. */
    autoApprove?: boolean;
    /** Issue #702: Parent session ID for sub-agent hierarchy */
    parentId?: string;
    /** Issue #1429: API key ID that owns this session */
    ownerKeyId?: string | null;
    /** Issue #1944: Tenant ID inherited from the creating API key. */
    tenantId?: string;
    /** Issue #2535: Model name supplied at creation time (e.g. "claude-sonnet-4-6"). */
    /** Issue #3135: Override initial status when creating from ACP result. */
    initialStatus?: UIState;
    model?: string;
    effort?: string;
    /** Issue #3681: Runner name for agent type identification. */
    runnerName?: string;
    /** Issue #3613: Per-session isolation policy override. */
  isolationPolicy?: 'respect-cc' | 'enforce-worktree' | 'enforce-direct';
  }): Promise<SessionInfo> {
    const id = opts.id ?? crypto.randomUUID();
    const createSpan = startSessionSpan('create', id, { workDir: opts.workDir });
    try {
    return await this._createSession(id, opts, createSpan);
    } catch (e) {
      spanError(createSpan, e);
      throw e;
    } finally {
      createSpan.end();
    }
  }

  /** Inner implementation for createSession — separated for span wrapping. */
  private async _createSession(
    id: string,
    opts: Parameters<SessionManager['createSession']>[0],
    parentSpan: Span,
  ): Promise<SessionInfo> {
    // Issue #1945: Validate workdir path against tenant workdir namespace
    const workdirValidation = validateWorkdirPath(opts.tenantId, opts.workDir, this.config);
    if (!workdirValidation.allowed) {
      throw new Error(workdirValidation.reason ?? 'workDir is outside tenant root');
    }

    // Compute a sensible display name with fallbacks:
    // 1) explicit name
    // 3) basename(workDir)
    // 4) fallback id prefix
    const candidateName = opts.name ? String(opts.name) : basename(opts.workDir || '') || `cc-${id.slice(0,8)}`;
    let displayName = sanitizeWindowName(candidateName);
    // Trim to 200 chars
    if (displayName.length > 200) displayName = displayName.slice(0, 200);
    // De-duplicate display names: append numeric suffix when needed (per-tenant scope)
    const existing = this.listSessions().filter(s => s.tenantId === opts.tenantId).map(s=>s.displayName);
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


    // Merge defaultSessionEnv (from config) with per-session env (per-session wins)
    // Security: validate env var names to prevent injection attacks
    const DANGEROUS_ENV_VARS = new Set(ENV_DENYLIST);
    const DANGEROUS_ENV_PREFIXES = ENV_DANGEROUS_PREFIXES;
    const mergedEnv: Record<string, string> = {};
    const allEnv = { ...this.config.defaultSessionEnv, ...opts.env };
    for (const [key, value] of Object.entries(allEnv)) {
      // Issue #1093: Check dangerous prefixes FIRST (before name regex), since some
      // dangerous prefixes like npm_config_ are lowercase and would fail the regex check.
      if (DANGEROUS_ENV_PREFIXES.some(prefix => key.startsWith(prefix))) {
        const matchedPrefix = DANGEROUS_ENV_PREFIXES.find(p => key.startsWith(p))!;
        throw new Error(`Forbidden env var: "${key}" — cannot override dangerous environment variable prefix "${matchedPrefix}"`);
      }
      if (!ENV_NAME_RE.test(key)) {
        throw new Error(`Invalid env var name: "${key}" — must match /^[A-Z_][A-Z0-9_]*$/`);
      }
      if (DANGEROUS_ENV_VARS.has(key)) {
        throw new Error(`Forbidden env var: "${key}" — cannot override dangerous environment variables`);
      }
      // Value hardening (Issue #1908): reject CR/LF and control chars
      if (/[\r\n]/.test(value)) {
        throw new Error(`Forbidden env var value for "${key}" — contains CR/LF characters`);
      }
      if (hasControlChars(value)) {
        throw new Error(`Forbidden env var value for "${key}" — contains control characters`);
      }
      if (Buffer.byteLength(value, 'utf-8') > ENV_VALUE_MAX_BYTES) {
        throw new Error(`Env var "${key}" value exceeds ${ENV_VALUE_MAX_BYTES} byte limit`);
      }
      mergedEnv[key] = value;
    }
    const hasEnv = Object.keys(mergedEnv).length > 0;

    // Permission guard: if permissionMode is "default", neutralize any project-level
    // settings.local.json that has bypassPermissions. The CLI flag --permission-mode
    // should be authoritative, but CC lets project settings override it.
    // We back up the file, patch it, and restore on session cleanup.
    const effectivePermissionMode = opts.permissionMode
      ?? (opts.autoApprove === true ? 'bypassPermissions' : opts.autoApprove === false ? 'default' : undefined)
      ?? this.config.defaultPermissionMode
      ?? 'default';
    let settingsPatched = false;
    if (effectivePermissionMode === 'bypassPermissions') {
      // Issue #3436: When bypassPermissions is requested, we must write it to the
      // project-level settings.local.json so the ACP agent picks it up. The ACP
      // reads permissionMode from SettingsManager (settings files), NOT from
      // session/new params. Without this, Claude always spawns with --permission-mode default.
      settingsPatched = await activateBypassPermissions(opts.workDir);
    } else {
      settingsPatched = await neutralizeBypassPermissions(opts.workDir, effectivePermissionMode);
    }

    // Issue #629: Generate per-session HMAC secret for hook URL authentication.
    const hookSecret = randomBytes(32).toString('hex');

    // Issue #169 Phase 2: Generate HTTP hook settings for this session.
    // Detect isolation mode from project/global Claude settings (Issue #3590)
    const detectedIsolation = await detectIsolationMode(opts.workDir).catch(() => undefined);
    const detectedModel = await detectModelFromSettings(opts.workDir).catch(() => undefined);
    let isolationMode: 'worktree' | 'none' = detectedIsolation ?? 'worktree';

    // Issue #3613: Enforce isolation policy
    const policy = opts.isolationPolicy ?? this.config.isolationPolicy;
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
    // policy === 'respect-cc' → use detected isolationMode as-is

    // Writes a temp file with hooks pointing to Aegis's hook receiver.
      // Issue #936: Clean stale session hooks from settings.local.json before writing new hooks.
      // This prevents CC from loading dead hook URLs on restart.
      // Issue #1134: Skip cleanup if ran recently for this workDir
        // Note: cleanup runs BEFORE the new session is added to this.state.sessions.
        // We must include the new session's ID in activeIds to prevent cleanup from
        // removing hooks for a session that was just created.
        const now = Date.now();
        if (now - lastCleanupTime < CLEANUP_TTL_MS && lastCleanupWorkDir === opts.workDir) {
          // Skipped: cleanup ran recently for this workDir
        } else {
          try {
            const activeIds = new Set(this.listSessions().map(s => s.id));
            activeIds.add(id); // Include the new session so cleanup preserves its hooks
            if (activeIds.size > 0) {
              await cleanupStaleSessionHooks(opts.workDir, activeIds);
              lastCleanupTime = now;
              lastCleanupWorkDir = opts.workDir;
            }
          } catch (e) {
            log.warn({ component: 'session', operation: 'hookCleanupFailed', attributes: { error: (e as Error).message } });
          }
        }

    let hookSettingsFile: string | undefined;
    try {
      const baseUrl = getConfiguredBaseUrl(this.config);
      hookSettingsFile = await writeHookSettingsFile(baseUrl, id, hookSecret, opts.workDir);
    } catch (e) {
      log.error({ component: 'session', operation: 'hookSettingsGenerateFailed', attributes: { error: (e as Error).message } });
      // Non-fatal: hooks won't work for this session, but CC still launches
    }

    let windowId: string;
    let finalName: string;
    let freshSessionId: string | undefined;
    // ACP mode: create session without window manager
    windowId = '';
    finalName = displayName;

    // Issue #3948: When resuming, carry over model/effort from the original session
    // if no explicit override is provided. This preserves /model changes made mid-session.
    let effectiveModel = opts.model || detectedModel;
    let effectiveEffort = opts.effort;
    if (opts.resumeSessionId && !opts.model) {
      const oldSession = this.state.sessions[opts.resumeSessionId];
      if (oldSession?.model) {
        effectiveModel = oldSession.model;
      }
      if (!opts.effort && oldSession?.effort) {
        effectiveEffort = oldSession.effort;
      }
    }

    const session: SessionInfo = {
      id,
      windowId,
      displayName: finalName,
      workDir: opts.workDir,
      // If we know the CC session ID upfront (from --session-id), set it immediately.
      // This eliminates the discovery delay and prevents stale ID assignment entirely.
      claudeSessionId: freshSessionId || undefined,
      byteOffset: 0,
      monitorOffset: 0,
      status: opts.initialStatus ?? 'pending',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      latestActivityText: 'Starting session',
      stallThresholdMs: opts.stallThresholdMs || SessionManager.DEFAULT_STALL_THRESHOLD_MS,
      permissionStallMs: opts.permissionStallMs || SessionManager.DEFAULT_PERMISSION_STALL_MS,
      permissionMode: effectivePermissionMode,
      settingsPatched,
      hookSettingsFile,
      hookSecret,
      prd: opts.prd,
      ownerKeyId: opts.ownerKeyId ?? undefined,
      tenantId: opts.tenantId,
      // Issue #2535: Store model at creation so analytics can group by model
      // Issue #3740: Fall back to model from CC settings if not provided at creation.
      // Issue #3948: effectiveModel includes resume carry-over from original session.
      model: effectiveModel,
      effort: effectiveEffort,
      runnerName: opts.runnerName,
      isolationMode: isolationMode,
      isolationPolicy: policy,
    };

    this.state.sessions[id] = session;
    this.invalidateSessionsListCache();
    await this.save();

        // Issue #702: Register child with parent
    if (opts.parentId) {
      const parent = this.state.sessions[opts.parentId];
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(id);
        await this.save();
      }
    }
    // Issue #353: Fetch CC process PID for swarm parent matching.
    // Fire-and-forget — PID is not needed synchronously.
    // Issue #574: Add .catch() to prevent unhandled rejection if runtime fails mid-lookup.

    // Issue #4088: Session approval gate — skip CC launch when approval is required.
    if (this.config.requireSessionApproval) {
      session.status = 'awaiting_approval';
      session.awaitingApproval = true;
      this.invalidateSessionsListCache();
      await this.save();
      // Issue #4114: Auto-reject after timeout.
      this.scheduleApprovalTimeout(session.id);
      return session;
    }
    // Start coordinated discovery polling:
    // - Hook/session_map sync: fast path
    // - Filesystem scan fallback: works when hooks fail or are skipped (Issue #16)
    // Field bug (Zeus 2026-03-22): hooks may not fire even without --bare
    this.discovery.startDiscoveryPolling(id, opts.workDir);

    // P0 fix: Clean stale entries from session_map.json for BOTH window name AND id.
    // After archiving old .jsonl files, stale session_map entries would point
    // to moved files, causing discovery to pick up ghost session IDs.
    // Also cleans stale windowId entries that could collide after restart.
    await this.discovery.cleanSessionMapForWindow(finalName, windowId);

    return session;
  }

  /** Get a session by ID. */
  getSession(id: string): SessionInfo | null {
    if (id === '__proto__' || id === 'prototype' || id === 'constructor') {
      return null;
    }
    return this.state.sessions[id] || null;
  }

  /** Issue #4027: Update session metadata (isPinned, etc.).
   *  Merges the provided fields into the session and persists. */
  async updateSessionMetadata(id: string, updates: Partial<Pick<SessionInfo, 'isPinned'>>): Promise<SessionInfo | null> {
    const session = this.state.sessions[id];
    if (!session) return null;
    Object.assign(session, updates);
    this.invalidateSessionsListCache();
    await this.save();
    return session;
  }

  /** Issue #169 Phase 3: Update session status from a hook event.
   *  Returns the previous status for change detection.
   *  Issue #87: Also records hook latency timestamps. */
  updateStatusFromHook(id: string, hookEvent: string, hookTimestamp?: number): UIState | null {
    const session = this.state.sessions[id];
    if (!session) return null;

    const prevStatus = session.status;
    const now = Date.now();

    // Map hook events to UI states
    switch (hookEvent) {
      case 'Stop':
      case 'TaskCompleted':
      case 'SessionEnd':
        // Issue #2538: CC finished work — transition to idle immediately
        // so the API returns the correct status instead of staying "working".
        session.status = 'idle';
        break;
      case 'TeammateIdle':
        // Informational — a teammate went idle, not this session
        break;
      case 'PreToolUse':
        // Issue #2520: Track tool use count for premature termination detection
        session.toolUseCount = (session.toolUseCount ?? 0) + 1;
        session.status = 'working';
        break;
      case 'PostToolUse':
      case 'SubagentStart':
      case 'UserPromptSubmit':
        session.status = 'working';
        break;
      case 'PermissionRequest':
        session.status = 'permission_prompt';
        break;
      case 'StopFailure':
      case 'PostToolUseFailure':
        session.status = 'error';
        break;
      case 'Notification':
      case 'PreCompact':
      case 'PostCompact':
      case 'SubagentStop':
        // Informational events — no status change
        break;
      default:
        // Unknown hook events: no status change
        break;
    }

    // Issue #2520: Detect premature termination. Upstream CC kills background
    // agents at ~20-30 tool uses with no wrap-up (upstream #55707).
    const PREMATURE_MIN_TOOLS = parseInt(process.env.PREMATURE_TERMINATION_MIN_TOOLS ?? '30', 10);
    const PREMATURE_MIN_DURATION_MS = parseInt(process.env.PREMATURE_TERMINATION_MIN_DURATION_MS ?? '30000', 10);
    if ((hookEvent === 'TaskCompleted' || hookEvent === 'Stop') && session.toolUseCount !== undefined) {
      const toolCount = session.toolUseCount;
      const duration = now - session.createdAt;
      if (toolCount > 0 && toolCount <= PREMATURE_MIN_TOOLS && duration >= PREMATURE_MIN_DURATION_MS) {
        session.prematureTermination = true;
        log.warn({
          component: 'session',
          operation: 'possiblePrematureTermination',
          sessionId: id,
          attributes: { toolCount, durationMs: duration, thresholdTools: PREMATURE_MIN_TOOLS, thresholdMs: PREMATURE_MIN_DURATION_MS },
        });
      }
    }

    session.lastHookAt = now;
    session.lastActivity = now;

    // Issue #87: Record hook receive timestamp for latency calculation
    session.lastHookReceivedAt = now;
    if (hookTimestamp) {
      // Issue #828: Clamp future timestamps to prevent clock skew corruption.
      // If the client's clock is ahead of ours, store our timestamp instead.
      if (hookTimestamp > now) {
        log.warn({ component: 'session', operation: 'clampedFutureTimestamp', sessionId: id, attributes: { hookTimestamp, now } });
        session.lastHookEventAt = now;
      } else {
        session.lastHookEventAt = hookTimestamp;
      }
    }

    // Issue #87: Track permission prompt timestamp
    if (hookEvent === 'PermissionRequest') {
      session.permissionPromptAt = now;
    }

    return prevStatus;
  }

  /** Issue #812: Detect if CC is waiting for user input by analyzing the JSONL transcript.
   *  Returns true if the last assistant message has text content only (no tool_use). */

  /** Send initial prompt (ACP stub — prompts sent via JSON-RPC). */
  // Issue #2995: Return honest delivery status when ACP is disabled.
  // In ACP mode, prompts are delivered through the ACP backend during session
  // creation — this stub is only reached when acpEnabled is false.
  async sendInitialPrompt(_id: string, _prompt: string): Promise<{ delivered: boolean; attempts: number }> {
    return { delivered: false, attempts: 0 };
  }

  /** Find an idle session by workDir (ACP mode: state-based lookup with acquisition).
   *  Atomically acquires the session under a mutex to prevent TOCTOU race (Issue #840/#880).
   *  Supports fault injection for testing (Issue #901).
   */
  async findIdleSessionByWorkDir(workDir: string): Promise<SessionInfo | null> {
    return this.sessionAcquireMutex.runExclusive(async () => {
      await maybeInjectFault('session.findIdleSessionByWorkDir.start');
      const normalized = workDir.replace(/\/+$/, '');
      for (const session of Object.values(this.state.sessions)) {
        if (session.workDir.replace(/\/+$/, '') === normalized && session.status === 'idle') {
          await maybeInjectFault('session.findIdleSessionByWorkDir.windowExists');
          session.status = 'working';
          session.lastActivity = Date.now();
          return session;
        }
      }
      return null;
    });
  }

  /** Get health info (ACP stub — basic status without window checks). */
  async getHealth(id: string): Promise<{
    alive: boolean;
    claudeRunning: boolean;
    status: UIState;
    hasTranscript: boolean;
    lastActivity: number;
    lastActivityAgo: number;
    sessionAge: number;
    details: string;
    actionHints?: Record<string, { method: string; url: string; description: string }>;
  }> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);
    const status = session.status;
    const lastActivityAgo = Date.now() - session.lastActivity;
    const actionHints = (status === 'permission_prompt' || status === 'bash_approval')
      ? {
          approve: { method: 'POST', url: `/v1/sessions/${session.id}/approve`, description: 'Approve the pending permission' },
          reject: { method: 'POST', url: `/v1/sessions/${session.id}/reject`, description: 'Reject the pending permission' },
        }
      : undefined;
    return {
      alive: true, claudeRunning: status === 'working' || status === 'permission_prompt' || status === 'ask_question',
      status, hasTranscript: !!session.jsonlPath,
      lastActivity: session.lastActivity, lastActivityAgo,
      sessionAge: Date.now() - session.createdAt,
      details: `Session ${id}: ${status} (ACP mode)`,
      actionHints,
    };
  }

  /** Send message (ACP stub — use JSON-RPC). */
  async sendMessage(_id: string, _text: string): Promise<{ delivered: boolean; attempts: number; error?: string }> {
    return { delivered: false, attempts: 0, error: 'no_active_transport' };
  }

  /** Approve permission (ACP stub — handled by hooks). */
  async approve(id: string): Promise<void> {
    const resolved = this.permissions.requests.resolvePendingPermission(id, 'allow');
    if (!resolved) {
      throw new Error('No pending permission request');
    }
  }

  /** Reject permission (ACP stub — handled by hooks). */
  async reject(id: string): Promise<void> {
    const resolved = this.permissions.requests.resolvePendingPermission(id, 'deny');
    if (!resolved) {
      throw new Error('No pending permission request');
    }
  }

  /** Escape session (ACP stub). */
  async escape(_id: string): Promise<void> {}

  /** Issue #4088: Approve a session awaiting approval. Starts CC. */

  /** Issue #4114: Schedule auto-reject for a session awaiting approval. */
  private scheduleApprovalTimeout(sessionId: string): void {
    const timeoutMs = this.config.sessionApprovalTimeoutMs ?? 300_000;
    const handle = setTimeout(async () => {
      this.approvalTimeouts.delete(sessionId);
      const session = this.state.sessions[sessionId];
      if (session && session.status === 'awaiting_approval') {
        log.warn({ component: 'session', operation: 'autoRejectApproval', sessionId, attributes: { timeoutMs } });
        try {
          await this.rejectSession(sessionId);
          // Notify channels about auto-rejection
          if (this.onSessionApprovalRecovery) {
            this.onSessionApprovalRecovery({ ...session, status: 'killed' });
          }
        } catch (e) {
          log.error({ component: 'session', operation: 'autoRejectFailed', sessionId, attributes: { error: String(e) } });
        }
      }
    }, timeoutMs);
    this.approvalTimeouts.set(sessionId, handle);
  }

  /** Issue #4114: Clear an active approval timeout. */
  private clearApprovalTimeout(sessionId: string): void {
    const handle = this.approvalTimeouts.get(sessionId);
    if (handle) {
      clearTimeout(handle);
      this.approvalTimeouts.delete(sessionId);
    }
  }

  /** Issue #4124: Start periodic cleanup of killed sessions. */
  startCleanupTimer(): void {
    const interval = this.config.sessionCleanupIntervalMs ?? 3_600_000;
    if (interval <= 0) return; // disabled
    this.stopCleanupTimer();
    this.cleanupTimer = setInterval(() => {
      void this.purgeKilled(this.config.sessionCleanupAgeMs ?? 86_400_000);
    }, interval);
    // Unref so the timer doesn't prevent process exit
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /** Issue #4124: Stop the periodic cleanup timer. */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Issue #4124: Purge killed sessions older than the given age.
   * Returns the number of sessions purged.
   */
  async purgeKilled(olderThanMs: number): Promise<number> {
    const now = Date.now();
    let purged = 0;
    for (const [id, session] of Object.entries(this.state.sessions)) {
      if (session.status !== 'killed') continue;
      const killedAt = session.lastActivity ?? session.createdAt;
      if (now - killedAt >= olderThanMs) {
        delete this.state.sessions[id];
        this.permissions.requests.cleanupPendingPermission(id);
        this.questions.cleanupPendingQuestion(id);
        this.approvalTimeouts.delete(id);
        purged++;
      }
    }
    if (purged > 0) {
      this.invalidateSessionsListCache();
      await this.save();
    }
    return purged;
  }

  /** Issue #4092: Emit awaiting_approval event for recovery after restart. */
  private emitSessionAwaitingApproval(session: SessionInfo): void {
    // Re-notify channels that this session still needs approval.
    // This is a no-op if no recovery callback is registered.
    if (this.onSessionApprovalRecovery) {
      this.onSessionApprovalRecovery(session);
    }
  }
  async approveSession(id: string, approvedBy?: string): Promise<SessionInfo> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session not found: ${id}`);
    if (session.status !== 'awaiting_approval') {
      throw new Error(`Session is not awaiting approval`);
    }
    session.status = 'pending';
    session.awaitingApproval = false;
    session.approvedBy = approvedBy;
    session.approvedAt = Date.now();
    this.invalidateSessionsListCache();
    // Issue #4114: Clear approval timeout.
    this.clearApprovalTimeout(id);
    await this.save();
    // Start discovery polling now that session is approved.
    // Issue #4092: Wrap in try/catch — if discovery fails, session is still approved
    // but we log the error instead of crashing the approval flow.
    try {
      this.discovery.startDiscoveryPolling(id, session.workDir);
    } catch (e) {
      log.error({ component: 'session', operation: 'approveDiscoveryFailed', sessionId: id, attributes: { error: String(e) } });
    }
    return session;
  }

  /** Issue #4088: Reject a session awaiting approval. Cleans up. */
  async rejectSession(id: string): Promise<void> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session not found: ${id}`);
    if (session.status !== 'awaiting_approval') {
      throw new Error(`Session is not awaiting approval`);
    }
    session.status = 'killed';
    session.awaitingApproval = false;
    this.invalidateSessionsListCache();
    // Issue #4114: Clear approval timeout.
    this.clearApprovalTimeout(id);
    await this.save();
  }

  /** Interrupt session (ACP stub — use JSON-RPC cancel). */
  async interrupt(_id: string): Promise<void> {}

  /** Window alive check (ACP stub — always true). */
  async isWindowAlive(_id: string): Promise<boolean> {
    return true;
  }


  async detectWaitingForInput(id: string): Promise<boolean> {
    const session = this.state.sessions[id];
    if (!session?.jsonlPath) return false;

    try {
      const { raw } = await readNewEntries(session.jsonlPath, session.byteOffset);
      // Walk backwards to find the last assistant JSONL entry
      for (let i = raw.length - 1; i >= 0; i--) {
        const entry = raw[i];
        if (entry.type !== 'assistant' || !entry.message) continue;
        const content = entry.message.content;
        if (typeof content === 'string') return true; // text-only message
        if (!Array.isArray(content)) return false;
        // Check if any content block is a tool_use
        const hasToolUse = content.some((block: { type: string }) => block.type === 'tool_use');
        return !hasToolUse;
      }
    } catch {
      // If we can't read the transcript, don't override status
    }
    return false;
  }

  /** Issue #88: Add an active subagent to a session. */
  addSubagent(id: string, name: string): void {
    const session = this.state.sessions[id];
    if (!session) return;
    if (!session.activeSubagents) session.activeSubagents = new Set<string>();
    session.activeSubagents.add(name);
  }

  /** Issue #88: Remove an active subagent from a session. */
  removeSubagent(id: string, name: string): void {
    const session = this.state.sessions[id];
    if (!session || !session.activeSubagents) return;
    session.activeSubagents.delete(name);
  }

  /** Issue #2518: Record a StopFailure hook event for circuit breaker tracking. */
  recordHookFailure(id: string): void {
    const session = this.state.sessions[id];
    if (!session) return;
    _recordHookFailure(session);
  }

  /** Issue #2518: Record a Stop (success) event — resets circuit breaker state. */
  recordHookSuccess(id: string): void {
    const session = this.state.sessions[id];
    if (!session) return;
    _recordHookSuccess(session);
  }

  /**
   * Issue #2518: Check whether the circuit breaker should trip.
   * Delegates to session-hook-circuit-breaker.ts.
   */
  checkHookCircuitBreaker(id: string, maxFailures: number, windowMs: number): boolean {
    const session = this.state.sessions[id];
    if (!session) return false;
    return _checkHookCircuitBreaker(session, maxFailures, windowMs);
  }

  /** Issue #89 L25: Update the model field on a session from hook payload. */
  updateSessionModel(id: string, model: string): void {
    const session = this.state.sessions[id];
    if (!session) return;
    session.model = model;
  }

  /** Issue #87: Get latency metrics for a session. */
  getLatencyMetrics(id: string): {
    hook_latency_ms: number | null;
    state_change_detection_ms: number | null;
    permission_response_ms: number | null;
  } | null {
    const session = this.state.sessions[id];
    if (!session) return null;

    // hook_latency_ms: time from CC sending hook to Aegis receiving it
    // Calculated from the difference between our receive time and the hook's timestamp
    let hookLatency: number | null = null;
    if (session.lastHookReceivedAt && session.lastHookEventAt) {
      hookLatency = session.lastHookReceivedAt - session.lastHookEventAt;
      // Guard against negative values (clock skew)
      if (hookLatency < 0) hookLatency = null;
    }

    // state_change_detection_ms: time from CC state change to Aegis detection
    // Approximated as hook_latency_ms since the hook IS the state change signal
    const stateChangeDetection: number | null = hookLatency;

    // permission_response_ms: time from permission prompt to user action
    let permissionResponse: number | null = null;
    if (session.permissionPromptAt && session.permissionRespondedAt) {
      permissionResponse = session.permissionRespondedAt - session.permissionPromptAt;
    }

    return {
      hook_latency_ms: hookLatency,
      state_change_detection_ms: stateChangeDetection,
      permission_response_ms: permissionResponse,
    };
  }

  /** Check if a session still exists and has a live process.
   *  Issue #69: A window can exist with a crashed/zombie CC process (zombie window).
   *  After checking window exists, also verify the pane PID is alive.
   *  Issue #390: Check stored ccPid first for immediate crash detection.
   *  When CC crashes (SIGKILL, OOM), the shell prompt returns in the pane,
   *  so the current pane PID is the shell (alive). Checking ccPid catches
   *  the crash within seconds instead of waiting for the 5-min stall timer. */

  /** Issue #2638: Re-validate a session's window ID by checking if the
   *  window still exists. If the ID is stale (e.g. renamed during
   *  CC initialization), look up by displayName and update windowId.
   *  Modeled after reconcile()'s re-attach logic. */

  /** Issue #657: Invalidate the sessions list cache. Call on any mutation. */
  private invalidateSessionsListCache(): void {
    this.sessionsListCache = null;
  }

  /** List all sessions. */
  listSessions(): SessionInfo[] {
    if (!this.sessionsListCache) {
      this.sessionsListCache = Object.values(this.state.sessions);
    }
    return this.sessionsListCache;
  }

  /** Issue #607: Find an idle session for the given workDir.
   *  Returns the most recently active idle session, or null if none found.
   *  Used to resume existing sessions instead of creating duplicates.
   *  Issue #636: Verifies session is still alive before returning.
   *  Issue #840/#880: Atomically acquires the session under a mutex to prevent TOCTOU race. */

  /** Release a session claim after the reuse path completes (success or failure). */
  releaseSessionClaim(id: string): void {
    const session = this.state.sessions[id];
    if (session) {
      session.status = 'idle';
    }
  }


  /** Issue #1798: Poll CC's terminal state until it becomes idle.
   *  Returns true if idle within timeout, false if CC is still active.
   *  Active states (working, compacting, context_warning) are waited on;
   *  other states (permission_prompt, ask_question, idle, etc.) return immediately. */


  /** Record that a permission prompt was detected for this session. */
  recordPermissionPrompt(id: string): void {
    const session = this.state.sessions[id];
    if (!session) return;
    session.permissionPromptAt = Date.now();
  }

  /** Approve a permission prompt. Resolves pending hook permission first. */

  /** Reject a permission prompt. Resolves pending hook permission first. */

  /**
   * Issue #284: Store a pending permission request and return a promise that
   * resolves when the client approves/rejects via the API.
   *
   * @param sessionId - Aegis session ID
   * @param timeoutMs - Timeout before auto-rejecting (default 10_000ms, matching CC's hook timeout)
   * @param toolName - Optional tool name from the hook payload
   * @param prompt - Optional permission prompt text
   * @returns Promise that resolves with the client's decision
   */
  waitForPermissionDecision(
    sessionId: string,
    timeoutMs: number = 10_000,
    toolName?: string,
    prompt?: string,
  ): Promise<PermissionDecision> {
    return this.permissions.requests.waitForPermissionDecision(sessionId, timeoutMs, toolName, prompt);
  }

  /** Check if a session has a pending permission request. */
  hasPendingPermission(sessionId: string): boolean {
    return this.permissions.requests.hasPendingPermission(sessionId);
  }

  /** Get info about a pending permission (for API responses). */
  getPendingPermissionInfo(sessionId: string): PendingPermissionInfo | null {
    return this.permissions.requests.getPendingPermissionInfo(sessionId);
  }

  /** Clean up any pending permission for a session (e.g. on session delete). */
  cleanupPendingPermission(sessionId: string): void {
    this.permissions.requests.cleanupPendingPermission(sessionId);
  }

  /**
   * Issue #336: Store a pending AskUserQuestion and return a promise that
   * resolves when the external client provides an answer via POST /answer.
   */
  waitForAnswer(
    sessionId: string,
    toolUseId: string,
    question: string,
    timeoutMs: number = 30_000,
  ): Promise<string | null> {
    return this.questions.waitForAnswer(sessionId, toolUseId, question, timeoutMs);
  }

  /** Issue #336: Submit an answer to a pending question. Returns true if resolved. */
  submitAnswer(sessionId: string, questionId: string, answer: string): boolean {
    return this.questions.submitAnswer(sessionId, questionId, answer);
  }

  /** Issue #336: Check if a session has a pending question. */
  hasPendingQuestion(sessionId: string): boolean {
    return this.questions.hasPendingQuestion(sessionId);
  }

  /** Issue #336: Get info about a pending question. */
  getPendingQuestionInfo(sessionId: string): { toolUseId: string; question: string; timestamp: number } | null {
    return this.questions.getPendingQuestionInfo(sessionId);
  }

  /** Issue #336: Clean up any pending question for a session. */
  cleanupPendingQuestion(sessionId: string): void {
    this.questions.cleanupPendingQuestion(sessionId);
  }

  /** Send Escape key. */

  /** Send Ctrl+C. */

  /** Read new messages from a session. */
  async readMessages(id: string): Promise<{
    messages: ParsedEntry[];
    status: UIState;
    statusText: string | null;
    interactiveContent: string | null;
  }> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);
    return this.readMessagesFromSession(session);
  }

  /**
   * Issue #2539: Read new messages from an already-resolved SessionInfo.
   * Avoids the double lookup that `readMessages(id)` performs, eliminating
   * the TOCTOU race between ownership check and transcript read.
   */
  async readMessagesFromSession(session: SessionInfo): Promise<{
    messages: ParsedEntry[];
    status: UIState;
    statusText: string | null;
    interactiveContent: string | null;
  }> {
    const result = await this.transcripts.readMessages(session);
    // #357: Debounce saves on GET reads — offsets change frequently but disk
    // writes are expensive. Full save still happens on create/kill/reconcile.
    this.debouncedSave();
    return result;
  }

  /** Read new messages for the monitor (separate offset from API reads). */
  async readMessagesForMonitor(id: string): Promise<{
    messages: ParsedEntry[];
    status: UIState;
    statusText: string | null;
    interactiveContent: string | null;
  }> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);
    return this.transcripts.readMessagesForMonitor(session);
  }

  /** Issue #35: Get a condensed summary of a session's transcript. */
  async getSummary(id: string, maxMessages = 20): Promise<{
    sessionId: string;
    displayName: string;
    status: UIState;
    totalMessages: number;
    messages: Array<{ role: string; contentType: string; text: string }>;
    createdAt: number;
    lastActivity: number;
    permissionMode: string;
    prd?: string;
  }> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);
    return this.transcripts.getSummary(session, maxMessages);
  }

  /** Paginated transcript read — does NOT advance the session's byteOffset. */
  async readTranscript(id: string, page = 1, limit = 50, roleFilter?: 'user' | 'assistant' | 'system'): Promise<{
    messages: ParsedEntry[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  }> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);
    return this.transcripts.readTranscript(session, page, limit, roleFilter);
  }

  /** Cursor-based transcript read — stable under concurrent appends. */
  async readTranscriptCursor(
    id: string,
    beforeId?: number,
    limit = 50,
    roleFilter?: 'user' | 'assistant' | 'system',
  ): Promise<{
    messages: (ParsedEntry & { _cursor_id: number })[];
    has_more: boolean;
    oldest_id: number | null;
    newest_id: number | null;
  }> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);
    return this.transcripts.readTranscriptCursor(session, beforeId, limit, roleFilter);
  }

  /** #405: Clean up all tracking maps for a session to prevent memory leaks. */
  private cleanupSession(id: string): void {
    this.discovery.stopDiscoveryPolling(id);

    this.cleanupPendingPermission(id);
    this.cleanupPendingQuestion(id);
    this.transcripts.clearCache(id);
  }

  /** Kill a session. */
  async killSession(id: string): Promise<void> {
    const session = this.state.sessions[id];
    if (!session) return;

    const span = startSessionSpan('kill', id, { displayName: session.displayName });
    try {
    } catch (e) {
    }

    try {
      // Permission guard: restore original settings.local.json if we patched it
      if (session.settingsPatched) {
        await restoreSettings(session.workDir);
      }

      // Issue #169 Phase 2: Clean up temp hook settings file
      if (session.hookSettingsFile) {
        await cleanupHookSettingsFile(session.hookSettingsFile);
      }

      // #405: Clean up all tracking maps (pollTimers, pendingPermissions, pendingQuestions, parsedEntriesCache)
      this.cleanupSession(id);

      // Issue #3137: Mark session as killed instead of deleting from storage
      session.status = 'killed';
      session.lastActivity = Date.now();
      this.invalidateSessionsListCache();
      // #357: Cancel any pending debounced save before doing an immediate save
      // Issue #4251: Delegated to SessionPersistenceService
      this.persistence.cancelDebouncedSave();
      await this.save();
      spanOk(span);
    } catch (e) {
      spanError(span, e);
      span.end();
      throw e;
    }
    span.end();
  }
}
