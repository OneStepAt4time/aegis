/**
 * session.ts — Session state manager.
 * 
 * Manages the lifecycle of CC sessions running in tmux windows.
 * Tracks: session ID, window ID, byte offset for JSONL reading, status.
 */

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { StateStore, SerializedSessionState, SerializedSessionInfo } from './services/state/state-store.js';
import { TmuxManager, type TmuxWindow } from './tmux.js';
import { readNewEntries, type ParsedEntry } from './transcript.js';
import { detectUIState, type UIState } from './terminal-parser.js';
import { SessionTranscripts } from './session-transcripts.js';
import { SessionDiscovery } from './session-discovery.js';
import type { Config } from './config.js';
import { computeStallThreshold } from './config.js';
import { getConfiguredBaseUrl } from './base-url.js';
import { validateWorkdirPath } from './tenant-workdir.js';
import { neutralizeBypassPermissions, restoreSettings, cleanOrphanedBackup } from './permission-guard.js';
import { persistedStateSchema, type PermissionPolicy, type PermissionProfile, ENV_NAME_RE, ENV_DENYLIST, ENV_DANGEROUS_PREFIXES, stripCrLf, hasControlChars, ENV_VALUE_MAX_BYTES, sanitizeWindowName } from './validation.js';
import type { z } from 'zod';
import { writeHookSettingsFile, cleanupHookSettingsFile, cleanupStaleSessionHooks } from './hook-settings.js';
import { PermissionRequestManager, type PermissionDecision } from './permission-request-manager.js';
import { QuestionManager } from './question-manager.js';
import { Mutex } from 'async-mutex';
import { maybeInjectFault } from './fault-injection.js';
import { startSessionSpan, startTmuxSpan, spanError, spanOk } from './tracing.js';
import type { Span } from '@opentelemetry/api';
import type { PendingPermissionInfo, PendingQuestionInfo } from './api-contracts.js';

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

function hasBlankPromptNearBottom(paneText: string): boolean {
  if (!paneText) return false;
  const lines = paneText.trimEnd().split('\n');
  for (let i = Math.max(0, lines.length - 8); i < lines.length; i++) {
    const stripped = lines[i]?.trim() ?? '';
    if (stripped === '❯' || stripped === '❯\u00a0') {
      return true;
    }
  }
  return false;
}

function hydrateSessions(raw: z.infer<typeof persistedStateSchema>): Record<string, SessionInfo> {
  const sessions: Record<string, SessionInfo> = Object.create(null);
  for (const [id, s] of Object.entries(raw)) {
    const { activeSubagents, ...rest } = s;
    sessions[id] = {
      ...rest,
      activeSubagents: activeSubagents ? new Set(activeSubagents) : undefined,
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
export interface SessionInfo {
  id: string;                    // Our bridge session ID (UUID)
  windowId: string;              // tmux window ID
  windowName: string;            // tmux window name  
  workDir: string;               // Working directory
  claudeSessionId?: string;      // CC's own session ID (from hook)
  jsonlPath?: string;            // Path to the JSONL file
  byteOffset: number;            // Last read byte offset (for API reads)
  monitorOffset: number;         // Last read byte offset (for monitor/telegram)
  status: UIState;               // Current UI state
  createdAt: number;             // Unix timestamp
  lastActivity: number;          // Unix timestamp of last activity
  stallThresholdMs: number;      // Per-session stall threshold (Issue #4)
  permissionStallMs: number;     // Per-session permission stall threshold (Issue #89 L8)
  permissionMode: string;        // Permission mode: "default"|"plan"|"acceptEdits"|"bypassPermissions"|"dontAsk"|"auto"
  settingsPatched?: boolean;     // Permission guard: settings.local.json was patched
  hookSettingsFile?: string;     // Temp file with HTTP hook settings (Issue #169)
  hookSecret?: string;           // Per-session secret for hook URL authentication (Issue #629)
  lastHookAt?: number;           // Unix timestamp of last received hook event (Issue #169 Phase 3)
  activeSubagents?: Set<string>;    // Active subagent names (Issue #88, #357: Set for O(1))
  // Issue #87: Latency metrics
  permissionPromptAt?: number;   // Unix timestamp when permission prompt was detected
  permissionRespondedAt?: number; // Unix timestamp when user approved/rejected
  lastHookReceivedAt?: number;   // Unix timestamp when last hook was received by Aegis
  lastHookEventAt?: number;      // Unix timestamp from the hook payload (CC's timestamp)
  model?: string;                // Issue #89 L25: Model name from hook payload (e.g. "claude-sonnet-4-6")
  lastDeadAt?: number;           // Unix timestamp when session was detected as dead (Issue #283)
  ccPid?: number;                // PID of the CC process in the tmux pane (Issue #353: swarm parent matching)
  parentId?: string;             // Issue #702: Parent session ID for sub-agent hierarchy
  children?: string[];          // Issue #702: Child session IDs for sub-agent hierarchy
  permissionPolicy?: PermissionPolicy;  // Issue #700: Dynamic permission rules
  permissionProfile?: PermissionProfile; // Issue #742: Per-session tool permission profile
  prd?: string;                // Issue #735: Optional PRD contract text attached to the session
  ownerKeyId?: string;         // Issue #1429: API key ID that created this session (ownership)
  tenantId?: string;           // Issue #1944: Tenant isolation scoping
  autoApprove?: boolean;        // API contract compat: auto-approve flag
  pendingPermission?: PendingPermissionInfo;  // API contract compat: active permission prompt
  pendingQuestion?: PendingQuestionInfo;       // API contract compat: active question
  promptDelivery?: { delivered: boolean; attempts: number };  // API contract compat: prompt status
  actionHints?: Record<string, { method: string; url: string; description: string }>;  // API contract compat: actionable hints
  // Issue #2518: Hook failure circuit breaker
  hookFailureTimestamps?: number[];   // Sliding window of StopFailure timestamps (ms)
  circuitBreakerTripped?: boolean;    // True once the circuit breaker has fired
}

/** Persisted session store keyed by Aegis session ID. */
export interface SessionState {
  sessions: Record<string, SessionInfo>;
}

/**
 * Detect whether CC is showing numbered permission options (e.g. "1. Yes, 2. No")
 * vs a simple y/N prompt. Returns the approval method to use.
 *
 * CC's permission UI uses indented numbered lines with "Esc to cancel" nearby.
 * We look for the pattern "  <N>. <option>" where N is 1-3, which distinguishes
 * permission options from regular numbered lists in output.
 */
export function detectApprovalMethod(paneText: string): 'numbered' | 'yes' {
  // Match CC's permission option format: indented "  1. Yes" lines.
  // Issue #843: Tightened to require "Esc to cancel" nearby (within 300 chars)
  // to avoid false positives on regular indented numbered lists in output.
  const numberedOptionPattern = /^\s{2}[1-3]\.\s/m;
  if (numberedOptionPattern.test(paneText) && /Esc to cancel/i.test(paneText)) {
    return 'numbered';
  }
  return 'yes';
}

interface NumberedApprovalOption {
  value: string;
  label: string;
}

function parseNumberedApprovalOptions(paneText: string): NumberedApprovalOption[] {
  const numberedRegex = /^\s*[❯> ]?\s*(\d+)\.\s*(.+)$/gm;
  const options: NumberedApprovalOption[] = [];
  let match: RegExpExecArray | null;

  while ((match = numberedRegex.exec(paneText)) !== null) {
    options.push({
      value: match[1],
      label: match[2].trim(),
    });
  }

  return options;
}

function normalizeApprovalLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function pickNumberedApprovalOption(
  options: NumberedApprovalOption[],
  action: 'approve' | 'reject',
  permissionMode: string,
): string {
  const normalized = options.map(option => ({
    ...option,
    normalizedLabel: normalizeApprovalLabel(option.label),
  }));

  if (action === 'approve') {
    if (permissionMode === 'plan') {
      const manualApproval = normalized.find(option => option.normalizedLabel.includes('manuallyapproveedits'));
      if (manualApproval) return manualApproval.value;
    }

    const leastPrivilegeYes = normalized.find(option =>
      (option.normalizedLabel.startsWith('yes') || option.normalizedLabel.startsWith('allow'))
      && !option.normalizedLabel.includes('always')
      && !option.normalizedLabel.includes('automode')
    );
    if (leastPrivilegeYes) return leastPrivilegeYes.value;

    const anyPositive = normalized.find(option =>
      option.normalizedLabel.includes('yes')
      || option.normalizedLabel.includes('allow')
      || option.normalizedLabel.includes('proceed')
    );
    if (anyPositive) return anyPositive.value;

    return options[0]?.value ?? '1';
  }

  const negative = normalized.find(option =>
    option.normalizedLabel.startsWith('no')
    || option.normalizedLabel.includes('deny')
    || option.normalizedLabel.includes('reject')
    || option.normalizedLabel.includes('cancel')
  );
  if (negative) return negative.value;

  return options[options.length - 1]?.value ?? 'n';
}

export function resolveApprovalInput(
  paneText: string,
  action: 'approve' | 'reject',
  permissionMode: string,
): string {
  const options = parseNumberedApprovalOptions(paneText);
  if (options.length >= 2) {
    return pickNumberedApprovalOption(options, action, permissionMode);
  }
  return action === 'approve' ? 'y' : 'n';
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
export class SessionManager {
  private state: SessionState = { sessions: Object.create(null) as Record<string, SessionInfo> };
  private stateFile: string;
  private sessionMapFile: string;
  private saveQueue: Promise<void> = Promise.resolve(); // #218: serialize concurrent saves
    /** #1644: AES-256-GCM key derived from master token for encrypting hook secrets at rest. */
    private encKey: Buffer | null = null;
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private static readonly SAVE_DEBOUNCE_MS = 5_000; // #357: debounce offset-only saves
  private permissionRequests = new PermissionRequestManager();
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

  constructor(
    private tmux: TmuxManager,
    private config: Config,
    store?: StateStore,
  ) {
    this.stateFile = join(config.stateDir, 'state.json');
    this.sessionMapFile = join(config.stateDir, 'session_map.json');
    this.store = store ?? null;
    this.transcripts = new SessionTranscripts(tmux, config);
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

  /** Validate that parsed data looks like a valid SessionState. */
  private isValidState(data: unknown): data is SessionState {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    if (typeof obj.sessions !== 'object' || obj.sessions === null) return false;
    const sessions = obj.sessions as Record<string, unknown>;
    for (const val of Object.values(sessions)) {
      if (typeof val !== 'object' || val === null) return false;
      const s = val as Record<string, unknown>;
      if (typeof s.id !== 'string' || typeof s.windowId !== 'string') return false;
    }
    return true;
  }

  /** Clean up stale .tmp files left by crashed writes. */
  private cleanTmpFiles(dir: string): void {
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.endsWith('.tmp')) {
          const fullPath = join(dir, entry);
          try { unlinkSync(fullPath); } catch { /* best effort */ }
          console.log(`Cleaned stale tmp file: ${entry}`);
        }
      }
    } catch { /* dir may not exist yet */ }
  }

  /** Load state from disk or the configured store (Issue #1937). */
  async load(): Promise<void> {
    if (this.store) {
      // Issue #1937: Load from pluggable store backend.
      const serialized = await this.store.load();
      const parsed = persistedStateSchema.safeParse(serialized.sessions);
      if (parsed.success && this.isValidState({ sessions: parsed.data })) {
        this.state = { sessions: hydrateSessions(parsed.data) };
        await this.restoreSessionHookSecrets();
      } else {
        this.state = { sessions: Object.create(null) as Record<string, SessionInfo> };
      }
    } else {
      // Legacy file I/O path.
      const dir = dirname(this.stateFile);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      // Clean stale .tmp files from crashed writes
      this.cleanTmpFiles(dir);

      if (existsSync(this.stateFile)) {
        try {
          const raw = await readFile(this.stateFile, 'utf-8');
          const parsed = persistedStateSchema.safeParse(JSON.parse(raw));
          if (parsed.success && this.isValidState({ sessions: parsed.data })) {
            this.state = { sessions: hydrateSessions(parsed.data) };
            await this.restoreSessionHookSecrets();
          } else {
            console.warn('State file failed validation, attempting backup restore');
            const backupFile = `${this.stateFile}.bak`;
            if (existsSync(backupFile)) {
              try {
                const backupRaw = await readFile(backupFile, 'utf-8');
                const backupParsed = persistedStateSchema.safeParse(JSON.parse(backupRaw));
                if (backupParsed.success && this.isValidState({ sessions: backupParsed.data })) {
                  this.state = { sessions: hydrateSessions(backupParsed.data) };
                  await this.restoreSessionHookSecrets();
                  console.log('Restored state from backup');
                } else {
                  this.state = { sessions: Object.create(null) as Record<string, SessionInfo> };
                }
              } catch { /* backup state file corrupted — start empty */
                this.state = { sessions: Object.create(null) as Record<string, SessionInfo> };
              }
            } else {
              this.state = { sessions: Object.create(null) as Record<string, SessionInfo> };
            }
          }
        } catch { /* state file corrupted — start empty */
          this.state = { sessions: Object.create(null) as Record<string, SessionInfo> };
        }
      }

      // Create backup of successfully loaded state
      try {
        await writeFile(`${this.stateFile}.bak`, this.serializeState());
      } catch { /* non-critical */ }
    }

    // Issue #657: Invalidate sessions list cache after loading state
    this.invalidateSessionsListCache();

    // Reconcile: verify tmux windows still exist, clean up dead sessions
    await this.reconcile();
  }

  /** Reconcile state with actual tmux windows. Remove dead sessions, restart discovery for live ones.
   *  Issue #397: Also handles re-attach by window name when windowId is stale after tmux restart. */
  private async reconcile(): Promise<void> {
    const windows = await this.tmux.listWindows();
    const windowIds = new Set(windows.map(w => w.windowId));
    const windowByName = new Map<string, TmuxWindow>();
    for (const w of windows) windowByName.set(w.windowName, w);

    let changed = false;
    for (const [id, session] of Object.entries(this.state.sessions)) {
      const windowIdAlive = windowIds.has(session.windowId);
      const windowNameAlive = windowByName.has(session.windowName);

      if (!windowIdAlive && !windowNameAlive) {
        console.log(`Reconcile: session ${session.windowName} (${id.slice(0, 8)}) — tmux window gone, removing`);
        // Restore patched settings before removing dead session
        if (session.settingsPatched) {
          await cleanOrphanedBackup(session.workDir);
        }
        delete this.state.sessions[id];
        this.invalidateSessionsListCache();
        changed = true;
      } else if (!windowIdAlive && windowNameAlive) {
        // Issue #397: Window exists with same name but different ID (tmux restarted).
        // Re-attach by updating the windowId to the new one.
        const win = windowByName.get(session.windowName)!;
        const oldWindowId = session.windowId;
        session.windowId = win.windowId;
        console.log(`Reconcile: session ${session.windowName} re-attached: ${oldWindowId} → ${win.windowId}`);
        // Restart discovery if needed
        if (!session.claudeSessionId || !session.jsonlPath) {
          this.discovery.startDiscoveryPolling(id, session.workDir);
        }
        changed = true;
      } else {
        // Session is alive — restart discovery if needed
        if (!session.claudeSessionId || !session.jsonlPath) {
          console.log(`Reconcile: session ${session.windowName} — restarting JSONL discovery`);
          this.discovery.startDiscoveryPolling(id, session.workDir);
        } else {
          console.log(`Reconcile: session ${session.windowName} — alive, JSONL ready`);
        }
      }
    }

    // P0 fix: On startup, purge session_map entries that don't correspond to active sessions.
    const finalWindowIds = new Set(Object.values(this.state.sessions).map(s => s.windowId));
    const finalWindowNames = new Set(Object.values(this.state.sessions).map(s => s.windowName));
    await this.discovery.purgeStaleSessionMapEntries(finalWindowIds, finalWindowNames);

    // Issue #35: Adopt orphaned tmux windows (cc-* prefix) not in state
    const knownWindowIds = new Set(Object.values(this.state.sessions).map(s => s.windowId));
    const knownWindowNames = new Set(Object.values(this.state.sessions).map(s => s.windowName));
    for (const win of windows) {
      const windowName = win.windowName ?? '';
      if (knownWindowIds.has(win.windowId) || knownWindowNames.has(windowName)) continue;
      // Only adopt windows that look like Aegis-created sessions (cc-* prefix or _bridge_ prefix)
      if (!windowName.startsWith('cc-') && !windowName.startsWith('_bridge_')) continue;

      const id = crypto.randomUUID();
      const session: SessionInfo = {
        id,
        windowId: win.windowId,
        windowName,
        workDir: win.cwd || homedir(),
        byteOffset: 0,
        monitorOffset: 0,
        status: 'unknown',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        stallThresholdMs: SessionManager.DEFAULT_STALL_THRESHOLD_MS,
        permissionStallMs: SessionManager.DEFAULT_PERMISSION_STALL_MS,
        permissionMode: 'default',
      };
      this.state.sessions[id] = session;
      this.invalidateSessionsListCache();
      console.log(`Reconcile: adopted orphaned window ${windowName} (${win.windowId}) as ${id.slice(0, 8)}`);
      this.discovery.startDiscoveryPolling(id, session.workDir);
      changed = true;
    }

    if (changed) {
      await this.save();
    }
  }

  /** Issue #397: Reconcile after tmux server crash recovery.
   *  Called when the monitor detects tmux server came back after a crash.
   *  Returns counts for observability. */
  async reconcileTmuxCrash(): Promise<{ recovered: number; orphaned: number }> {
    console.log('Reconcile: tmux crash recovery — checking all sessions');
    const windows = await this.tmux.listWindows();
    const windowIds = new Set(windows.map(w => w.windowId));
    const windowByName = new Map<string, typeof windows[0]>();
    for (const w of windows) windowByName.set(w.windowName, w);

    let recovered = 0;
    let orphaned = 0;
    let changed = false;

    for (const [id, session] of Object.entries(this.state.sessions)) {
      const windowIdAlive = windowIds.has(session.windowId);
      const windowNameAlive = windowByName.has(session.windowName);

      if (windowIdAlive) {
        // Window ID still matches — session survived the crash
        continue;
      }

      if (windowNameAlive) {
        // Window exists by name but ID changed — re-attach
        const win = windowByName.get(session.windowName)!;
        const oldWindowId = session.windowId;
        session.windowId = win.windowId;
        session.status = 'unknown';
        session.lastActivity = Date.now();
        console.log(`Reconcile (crash): session ${session.windowName} re-attached: ${oldWindowId} → ${win.windowId}`);
        // Restart discovery in case the session state is stale
        if (!session.claudeSessionId || !session.jsonlPath) {
          this.discovery.startDiscoveryPolling(id, session.workDir);
        }
        recovered++;
        changed = true;
      } else {
        // Window gone entirely — session is orphaned
        console.log(`Reconcile (crash): session ${session.windowName} (${id.slice(0, 8)}) — window gone, marking orphaned`);
        session.status = 'unknown';
        session.lastDeadAt = Date.now();
        orphaned++;
        changed = true;
      }
    }

    if (changed) {
      await this.save();
    }

    return { recovered, orphaned };
  }

  /** Save state to disk atomically (write to temp, then rename).
   *  #218: Uses a write queue to serialize concurrent saves and prevent corruption. */
  async save(): Promise<void> {
    this.saveQueue = this.saveQueue.then(() => this.doSave()).catch(e => console.error('State save error:', e));
    await this.saveQueue;
  }

  /** #357: Debounced save — skips immediate save for offset-only changes.
   *  Coalesces rapid successive reads into a single disk write. */
  debouncedSave(): void {
    if (this.saveDebounceTimer !== null) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null;
      void this.save().catch(e => console.error('Session: debounced save failed:', e));
    }, SessionManager.SAVE_DEBOUNCE_MS);
  }

  private async doSave(): Promise<void> {
    if (this.store) {
      // Issue #1937: Persist via the pluggable store.
      const serialized = this.serializeStateForStore();
      await this.store.save(serialized);
      return;
    }
    // Legacy file I/O path.
    const dir = dirname(this.stateFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const tmpFile = `${this.stateFile}.tmp`;
    await writeFile(tmpFile, this.serializeState());
    await rename(tmpFile, this.stateFile);
  }

  /** Issue #1937: Serialize state for the store (Set→array, encrypt hook secrets). */
  private serializeStateForStore(): SerializedSessionState {
    const sessions: Record<string, SerializedSessionInfo> = Object.create(null) as Record<string, SerializedSessionInfo>;
    for (const [id, session] of Object.entries(this.state.sessions)) {
      const { activeSubagents, hookSecret, ...rest } = session;
      sessions[id] = {
        ...rest,
        activeSubagents: activeSubagents ? [...activeSubagents] : undefined,
        hookSecret: (typeof hookSecret === 'string' && this.encKey)
          ? this.encryptSecret(hookSecret)
          : undefined,
      } as unknown as SerializedSessionInfo;
    }
    return { sessions };
  }

  private serializeState(): string {
    // #357: Serialize Set<string> as arrays.
    // #1644: Encrypt hook secrets at rest using AES-256-GCM derived from master token.
    // If no encryption key is set (e.g. no auth token), omit hook secrets entirely.
    return JSON.stringify(this.state, (key, value) => {
      if (key === 'hookSecret') {
        if (typeof value !== 'string' || !this.encKey) return undefined;
        return this.encryptSecret(value);
      }
      if (value instanceof Set) return [...value];
      return value;
    }, 2);
  }

  /** #1644: Set the AES-256-GCM key derived from the master auth token. */
  setEncryptionKey(masterToken: string): void {
    if (!masterToken) return;
    // scryptSync is synchronous — called once at startup, acceptable cost.
    this.encKey = scryptSync(masterToken, 'aegis-hook-key-v1', 32);
  }

  /** Encrypt a hook secret with AES-256-GCM. Returns '<iv>:<tag>:<ciphertext>' hex. */
  private encryptSecret(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey!, iv);
    const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }

  /** Decrypt a hook secret from AES-256-GCM '<iv>:<tag>:<ciphertext>' hex. */
  private decryptSecret(encrypted: string): string | undefined {
    if (!this.encKey) return undefined;
    try {
      const parts = encrypted.split(':');
      if (parts.length !== 3) return undefined;
      const [ivHex, tagHex, encHex] = parts as [string, string, string];
      const decipher = createDecipheriv('aes-256-gcm', this.encKey, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
    } catch {
      return undefined;
    }
  }

  private async restoreSessionHookSecrets(): Promise<void> {
    for (const session of Object.values(this.state.sessions)) {
      // #1644: Decrypt if the stored value is an AES-GCM ciphertext (iv:tag:enc format).
      // Plaintext hookSecrets are 64-char hex strings with no colons.
      if (session.hookSecret?.includes(':') && this.encKey) {
        const decrypted = this.decryptSecret(session.hookSecret);
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

  /**
   * Wait for CC to show its idle prompt in the tmux pane, then send the initial prompt.
   * Uses exponential backoff on retry: first attempt waits timeoutMs, subsequent attempts
   * wait 1.5x the previous timeout.
   *
   * Returns delivery result. Logs warnings on each retry for observability.
   */
  async sendInitialPrompt(
    sessionId: string,
    prompt: string,
    timeoutMs?: number,
    maxRetries?: number,
  ): Promise<{ delivered: boolean; attempts: number }> {
    const session = this.getSession(sessionId);
    if (!session) return { delivered: false, attempts: 0 };

    const effectiveTimeout = timeoutMs ?? SessionManager.DEFAULT_PROMPT_TIMEOUT_MS;
    const effectiveMaxRetries = maxRetries ?? SessionManager.DEFAULT_PROMPT_MAX_RETRIES;

    for (let attempt = 1; attempt <= effectiveMaxRetries + 1; attempt++) {
      const attemptTimeout = attempt === 1
        ? effectiveTimeout
        : Math.min(effectiveTimeout * Math.pow(1.5, attempt - 1), 120_000); // cap at 2min per retry

      const result = await this.waitForReadyAndSend(sessionId, prompt, attemptTimeout);

      if (result.delivered) {
        if (attempt > 1) {
          console.log(`sendInitialPrompt: delivered on attempt ${attempt}/${effectiveMaxRetries + 1}`);
        }
        return result;
      }

      // If this was the last attempt, return failure
      if (attempt > effectiveMaxRetries) {
        console.error(`sendInitialPrompt: FAILED after ${attempt} attempts for session ${sessionId.slice(0, 8)}`);
        return result;
      }

      // Log retry
      console.warn(`sendInitialPrompt: CC not ready after ${attemptTimeout}ms, retry ${attempt}/${effectiveMaxRetries}`);
    }

    return { delivered: false, attempts: effectiveMaxRetries + 1 };
  }

  /** Wait for CC idle prompt, then send. Single attempt. */
  private async waitForReadyAndSend(
    sessionId: string,
    prompt: string,
    timeoutMs: number,
  ): Promise<{ delivered: boolean; attempts: number }> {
    const session = this.getSession(sessionId);
    if (!session) return { delivered: false, attempts: 0 };

    // #363: Exponential backoff from 500ms → 2000ms to reduce tmux CLI calls.
    // Instead of ~120 fixed-interval polls, we get ~8-10 polls per session.
    const MIN_POLL_MS = 500;
    const MAX_POLL_MS = 2_000;
    let pollInterval = MIN_POLL_MS;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // Use capturePaneDirect to bypass the serialize queue.
      // At session creation, no other code is writing to this pane,
      // so queue serialization is unnecessary and adds latency.
      const paneText = await this.tmux.capturePaneDirect(session.windowId);
      // Issue #561: Use detectUIState for robust readiness detection.
      // Requires both ❯ prompt AND chrome separators (─────) to confirm idle.
      // Naive includes('❯') matched splash/startup output, causing premature sends.
      if (paneText && detectUIState(paneText) === 'idle') {
        const result = await this.sendMessageDirect(sessionId, prompt);
        if (!result.delivered) return result;

        // Issue #561: Post-send verification. Wait for CC to transition to a
        // recognized active state, or for a fast reply to round-trip back to a
        // fresh blank prompt. Without the idle-round-trip check, short prompts
        // can be accepted, answered, and retried anyway.
        const verified = await this.verifyPromptAccepted(session.windowId, paneText);
        return verified
          ? result
          : { delivered: false, attempts: result.attempts };
      }
      await new Promise(r => setTimeout(r, pollInterval));
      pollInterval = Math.min(pollInterval * 2, MAX_POLL_MS);
    }
    return { delivered: false, attempts: 0 };
  }

  /**
   * Issue #561: After sending an initial prompt, verify CC actually accepted it
   * by polling for a state transition away from idle/unknown, or for a quick
   * answer to return to a fresh blank idle prompt.
   */
  private async verifyPromptAccepted(windowId: string, readyPaneText: string): Promise<boolean> {
    const VERIFY_TIMEOUT_MS = 5_000;
    const VERIFY_POLL_MS = 500;
    const verifyStart = Date.now();

    while (Date.now() - verifyStart < VERIFY_TIMEOUT_MS) {
      const paneText = await this.tmux.capturePaneDirect(windowId);
      const state = detectUIState(paneText);
      // Active states mean CC received and is processing the prompt.
      // waiting_for_input = CC accepted prompt, awaiting follow-up (no chrome yet).
      if (state === 'working' || state === 'permission_prompt' ||
          state === 'bash_approval' || state === 'plan_mode' ||
          state === 'ask_question' || state === 'compacting' ||
          state === 'context_warning' || state === 'waiting_for_input') {
        return true;
      }
      // Fast prompts can complete between polls and return to a blank prompt.
      if (
        state === 'idle'
        && paneText.trimEnd() !== readyPaneText.trimEnd()
        && hasBlankPromptNearBottom(paneText)
      ) {
        return true;
      }
      // idle or unknown — keep polling
      await new Promise(r => setTimeout(r, VERIFY_POLL_MS));
    }

    console.warn(`verifyPromptAccepted: CC did not transition from idle/unknown within ${VERIFY_TIMEOUT_MS}ms`);
    return false;
  }

  async createSession(opts: {
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
  }): Promise<SessionInfo> {
    const id = crypto.randomUUID();
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

    const windowName = opts.name ? sanitizeWindowName(opts.name) : `cc-${id.slice(0, 8)}`;

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
    if (effectivePermissionMode !== 'bypassPermissions') {
      settingsPatched = await neutralizeBypassPermissions(opts.workDir, effectivePermissionMode);
    }

    // Issue #629: Generate per-session HMAC secret for hook URL authentication.
    const hookSecret = randomBytes(32).toString('hex');

    // Issue #169 Phase 2: Generate HTTP hook settings for this session.
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
            console.warn(`Hook cleanup: failed to clean stale hooks: ${(e as Error).message}`);
          }
        }

    let hookSettingsFile: string | undefined;
    try {
      const baseUrl = getConfiguredBaseUrl(this.config);
      hookSettingsFile = await writeHookSettingsFile(baseUrl, id, hookSecret, opts.workDir);
    } catch (e) {
      console.error(`Hook settings: failed to generate settings file: ${(e as Error).message}`);
      // Non-fatal: hooks won't work for this session, but CC still launches
    }

    const tmuxSpan = startTmuxSpan('create_window', windowName, { workDir: opts.workDir });
    let windowId: string;
    let finalName: string;
    let freshSessionId: string | undefined;
    try {
      const result = await this.tmux.createWindow({
        workDir: opts.workDir,
        windowName,
        resumeSessionId: opts.resumeSessionId,
        claudeCommand: opts.claudeCommand,
        env: hasEnv ? mergedEnv : undefined,
        permissionMode: effectivePermissionMode,
        settingsFile: hookSettingsFile,
      });
      windowId = result.windowId;
      finalName = result.windowName;
      freshSessionId = result.freshSessionId;
      tmuxSpan.setAttribute('aegis.tmux.window_id', windowId);
      spanOk(tmuxSpan);
    } catch (e) {
      spanError(tmuxSpan, e);
      tmuxSpan.end();
      throw e;
    }
    tmuxSpan.end();

    const session: SessionInfo = {
      id,
      windowId,
      windowName: finalName,
      workDir: opts.workDir,
      // If we know the CC session ID upfront (from --session-id), set it immediately.
      // This eliminates the discovery delay and prevents stale ID assignment entirely.
      claudeSessionId: freshSessionId || undefined,
      byteOffset: 0,
      monitorOffset: 0,
      status: 'unknown',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      stallThresholdMs: opts.stallThresholdMs || SessionManager.DEFAULT_STALL_THRESHOLD_MS,
      permissionStallMs: opts.permissionStallMs || SessionManager.DEFAULT_PERMISSION_STALL_MS,
      permissionMode: effectivePermissionMode,
      settingsPatched,
      hookSettingsFile,
      hookSecret,
      prd: opts.prd,
      ownerKeyId: opts.ownerKeyId ?? undefined,
      tenantId: opts.tenantId,
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
    // Issue #574: Add .catch() to prevent unhandled rejection if tmux fails mid-lookup.
    void this.tmux.listPanePid(windowId).then(pid => {
      if (pid !== null) {
        session.ccPid = pid;
        void this.save().catch(e => console.error(`Session: failed to save PID for ${id}:`, e));
      }
    }).catch(e => console.error(`Session: failed to list pane PID for ${id}:`, e));

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
      case 'TeammateIdle':
        break;
      case 'PreToolUse':
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

    session.lastHookAt = now;
    session.lastActivity = now;

    // Issue #87: Record hook receive timestamp for latency calculation
    session.lastHookReceivedAt = now;
    if (hookTimestamp) {
      // Issue #828: Clamp future timestamps to prevent clock skew corruption.
      // If the client's clock is ahead of ours, store our timestamp instead.
      if (hookTimestamp > now) {
        console.warn(`updateStatusFromHook: clamping future hookTimestamp ` +
          `(${hookTimestamp} > ${now}) for session ${id.slice(0, 8)}`);
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
    if (!session.hookFailureTimestamps) session.hookFailureTimestamps = [];
    session.hookFailureTimestamps.push(Date.now());
  }

  /** Issue #2518: Record a Stop (success) event — resets circuit breaker state. */
  recordHookSuccess(id: string): void {
    const session = this.state.sessions[id];
    if (!session) return;
    session.hookFailureTimestamps = [];
    session.circuitBreakerTripped = false;
  }

  /**
   * Issue #2518: Check whether the circuit breaker should trip.
   * Prunes stale timestamps outside the sliding window, then trips if the
   * failure count meets or exceeds maxFailures. Once tripped, always returns true.
   */
  checkHookCircuitBreaker(id: string, maxFailures: number, windowMs: number): boolean {
    const session = this.state.sessions[id];
    if (!session) return false;
    if (session.circuitBreakerTripped) return true;

    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = (session.hookFailureTimestamps ?? []).filter(ts => ts >= cutoff);
    session.hookFailureTimestamps = recent;

    if (recent.length >= maxFailures) {
      session.circuitBreakerTripped = true;
      return true;
    }
    return false;
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

  /** Check if a session's tmux window still exists and has a live process.
   *  Issue #69: A window can exist with a crashed/zombie CC process (zombie window).
   *  After checking window exists, also verify the pane PID is alive.
   *  Issue #390: Check stored ccPid first for immediate crash detection.
   *  When CC crashes (SIGKILL, OOM), the shell prompt returns in the pane,
   *  so the current pane PID is the shell (alive). Checking ccPid catches
   *  the crash within seconds instead of waiting for the 5-min stall timer. */
  async isWindowAlive(id: string): Promise<boolean> {
    const session = this.state.sessions[id];
    if (!session) return false;
    try {
      // Issue #390/#1817: Fast crash detection via stored CC PID
      // If session.ccPid was recorded and the process is now dead, session is dead
      if (session.ccPid != null && !this.tmux.isPidAlive(session.ccPid)) {
        return false;
      }

      const windowHealth = await this.tmux.getWindowHealth(session.windowId);
      if (!windowHealth.windowExists) return false;
      // Issue #1040: When CC exits (normal or crash), it becomes a zombie.
      // isPidAlive returns false for zombies — we cannot distinguish normal exit from crash.
      // paneDead + grace period handles both: keep alive briefly, then mark dead.
      if (windowHealth.paneDead) {
        const msSinceActivity = Date.now() - (session.lastActivity || session.createdAt);
        const GRACE_PERIOD_MS = 15000; // 15 seconds — enough for CC to finish and write results
        return msSinceActivity < GRACE_PERIOD_MS;
      }

      // Pane not dead — verify pane process is alive (for non-CC processes like shells)
      const panePid = await this.tmux.listPanePid(session.windowId);
      if (panePid !== null && !this.tmux.isPidAlive(panePid)) return false;
      return true;
    } catch { /* tmux query failed — treat as not alive */
      return false;
    }
  }

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
   *  Issue #636: Verifies tmux window is still alive before returning.
   *  Issue #840/#880: Atomically acquires the session under a mutex to prevent TOCTOU race. */
  async findIdleSessionByWorkDir(workDir: string): Promise<SessionInfo | null> {
    return this.sessionAcquireMutex.runExclusive(async () => {
      await maybeInjectFault('session.findIdleSessionByWorkDir.start');
      const candidates = Object.values(this.state.sessions).filter(
        (s) => s.workDir === workDir && s.status === 'idle',
      );
      if (candidates.length === 0) return null;
      // Return the most recently active session
      candidates.sort((a, b) => b.lastActivity - a.lastActivity);
      // Issue #636: verify tmux window exists before returning
      for (const candidate of candidates) {
        await maybeInjectFault('session.findIdleSessionByWorkDir.windowExists');
        if (await this.tmux.windowExists(candidate.windowId)) {
          // Issue #840: Mark session as acquired immediately to prevent
          // concurrent callers from grabbing the same session
          candidate.status = 'acquired' as UIState;
          return candidate;
        }
      }
      return null;
    });
  }

  /** Release a session claim after the reuse path completes (success or failure). */
  releaseSessionClaim(id: string): void {
    const session = this.state.sessions[id];
    if (session) {
      session.status = 'idle';
    }
  }

  /** Get health info for a session.
   *  Issue #2: Returns comprehensive health status for orchestrators.
   */
  async getHealth(id: string): Promise<{
    alive: boolean;
    windowExists: boolean;
    claudeRunning: boolean;
    paneCommand: string | null;
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

    const now = Date.now();
    const windowHealth = await this.tmux.getWindowHealth(session.windowId);

    // Get terminal state
    let status: UIState = 'unknown';
    // Issue #69: Also check if the pane PID is alive (zombie window detection)
    let processAlive = true;
    const paneExited = !!windowHealth.paneDead;
    if (windowHealth.windowExists) {
      if (paneExited) {
        processAlive = false;
      } else {
        try {
          const panePid = await this.tmux.listPanePid(session.windowId);
          if (panePid !== null) {
            processAlive = this.tmux.isPidAlive(panePid);
          }
        } catch { /* cannot list pane PID — assume dead */
          processAlive = false;
        }
      }
    }

    if (windowHealth.windowExists && processAlive) {
      try {
        const paneText = await this.tmux.capturePane(session.windowId);
        status = detectUIState(paneText);
        session.status = status;
      } catch { /* pane capture failed — default to unknown */
        status = 'unknown';
      }
    }

    const hasTranscript = !!(session.claudeSessionId && session.jsonlPath);
    const lastActivityAgo = now - session.lastActivity;
    const sessionAge = now - session.createdAt;

    // Determine if session is alive
    // Alive = window exists AND process alive AND (Claude running OR recently active)
    const recentlyActive = lastActivityAgo < 5 * 60 * 1000; // 5 minutes
    const alive = windowHealth.windowExists && processAlive && (windowHealth.claudeRunning || recentlyActive);

    // Human-readable detail
    let details: string;
    if (!windowHealth.windowExists) {
      details = 'Tmux window does not exist — session is dead';
    } else if (paneExited) {
      details = 'Tmux pane has exited — session is dead';
    } else if (!processAlive) {
      details = 'Tmux window exists but pane process is dead — session is dead (zombie window)';
    } else if (!windowHealth.claudeRunning && !recentlyActive) {
      details = `Claude not running (pane: ${windowHealth.paneCommand}), no activity for ${Math.round(lastActivityAgo / 60000)}min`;
    } else if (status === 'idle') {
      details = 'Claude is idle, awaiting input';
    } else if (status === 'working') {
      details = 'Claude is actively working';
    } else if (status === 'permission_prompt' || status === 'bash_approval') {
      details = `Claude is waiting for permission approval. POST /v1/sessions/${session.id}/approve to approve, or /v1/sessions/${session.id}/reject to reject.`;
    } else {
      details = `Status: ${status}, pane: ${windowHealth.paneCommand}`;
    }

    // Issue #20: Action hints for interactive states
    const actionHints = (status === 'permission_prompt' || status === 'bash_approval')
      ? {
          approve: { method: 'POST', url: `/v1/sessions/${session.id}/approve`, description: 'Approve the pending permission' },
          reject: { method: 'POST', url: `/v1/sessions/${session.id}/reject`, description: 'Reject the pending permission' },
        }
      : undefined;

    return {
      alive,
      windowExists: windowHealth.windowExists,
      claudeRunning: windowHealth.claudeRunning,
      paneCommand: windowHealth.paneCommand,
      status,
      hasTranscript,
      lastActivity: session.lastActivity,
      lastActivityAgo,
      sessionAge,
      details,
      actionHints,
    };
  }

  /** Send a message to a session with delivery verification.
   *  Issue #1: Uses capture-pane to verify the prompt was delivered.
   *  Returns delivery status for API response.
   *  Issue #1325: Optionally includes stall feedback when monitor is provided.
   *  Issue #1798: Waits for CC to become idle before sending to prevent
   *  disrupting active work (especially extended thinking), which causes
   *  jsonl stalls and session death.
   */
  async sendMessage(
    id: string,
    text: string,
  ): Promise<{ delivered: boolean; attempts: number }> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);

    // Issue #1798: Wait for CC to become idle before sending text + Enter.
    // Sending Enter while CC is actively working (especially during extended
    // thinking) disrupts CC's internal state, causing the session to become
    // unresponsive while still showing "working" indicators (jsonl stall).
    const idle = await this.waitForIdleState(session.windowId, SEND_MESSAGE_IDLE_TIMEOUT_MS);
    if (!idle) {
      return { delivered: false, attempts: 0 };
    }

    const result = await this.tmux.sendKeysVerified(session.windowId, text);
    if (result.delivered) {
      session.lastActivity = Date.now();
      try {
        await this.save();
      } catch {
        // Message was delivered — don't let a save failure mask the success
      }
    }
    return result;
  }

  /** Issue #1798: Poll CC's terminal state until it becomes idle.
   *  Returns true if idle within timeout, false if CC is still active.
   *  Active states (working, compacting, context_warning) are waited on;
   *  other states (permission_prompt, ask_question, idle, etc.) return immediately. */
  private async waitForIdleState(windowId: string, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const paneText = await this.tmux.capturePane(windowId);
      const state = detectUIState(paneText);
      if (state === 'idle' || state === 'waiting_for_input') {
        return true;
      }
      // States that CC will naturally exit — don't wait
      if (state !== 'working' && state !== 'compacting' && state !== 'context_warning') {
        return true;
      }
      await new Promise(r => setTimeout(r, SEND_MESSAGE_IDLE_POLL_MS));
    }
    return false;
  }

  /** Send message bypassing the tmux serialize queue.
   *  Used by sendInitialPrompt for critical-path prompt delivery.
   *
   *  Issue #285: Changed from sendKeysDirect (unverified) to sendKeysVerified
   *  with 3 retry attempts. tmux send-keys can silently fail even at session
   *  creation time, causing ~20% prompt delivery failure rate.
   *
   *  We still bypass the serialize queue (using capturePaneDirect in verifyDelivery)
   *  but now verify actual delivery to CC.
   */
  private async sendMessageDirect(id: string, text: string): Promise<{ delivered: boolean; attempts: number }> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);

    // Issue #285: Use verified sending with retry for reliability
    const result = await this.tmux.sendKeysVerified(session.windowId, text, 3);
    if (result.delivered) {
      session.lastActivity = Date.now();
      try {
        await this.save();
      } catch {
        // Message was delivered — don't let a save failure mask the success
      }
    }
    return result;
  }

  /** Record that a permission prompt was detected for this session. */
  recordPermissionPrompt(id: string): void {
    const session = this.state.sessions[id];
    if (!session) return;
    session.permissionPromptAt = Date.now();
  }

  /** Approve a permission prompt. Resolves pending hook permission first, falls back to tmux send-keys. */
  async approve(id: string): Promise<void> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);

    const paneText = await this.tmux.capturePane(session.windowId);
    const uiApprovalInput = getUiApprovalInput(paneText, 'approve', session.permissionMode);
    const resolvedPendingPermission = this.permissionRequests.resolvePendingPermission(id, 'allow');

    const isPlanMode = session.permissionMode === 'plan';
    if (uiApprovalInput !== null && (isPlanMode || !resolvedPendingPermission)) {
      // Plan-mode always needs a numbered-option keypress; for other modes only
      // send tmux input when the hook didn't already handle the decision (avoids
      // injecting a stale keypress into the next prompt after CC advances).
      await this.tmux.sendKeys(session.windowId, uiApprovalInput, true);
    } else if (!resolvedPendingPermission && uiApprovalInput === null) {
      await this.tmux.sendKeys(session.windowId, 'y', true);
    }

    session.lastActivity = Date.now();
    if (session.permissionPromptAt) {
      session.permissionRespondedAt = Date.now();
    }
  }

  /** Reject a permission prompt. Resolves pending hook permission first, falls back to tmux send-keys. */
  async reject(id: string): Promise<void> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);

    const paneText = await this.tmux.capturePane(session.windowId);
    const uiApprovalInput = getUiApprovalInput(paneText, 'reject', session.permissionMode);
    const resolvedPendingPermission = this.permissionRequests.resolvePendingPermission(id, 'deny');

    const isPlanMode = session.permissionMode === 'plan';
    if (uiApprovalInput !== null && (isPlanMode || !resolvedPendingPermission)) {
      // Plan-mode always needs a numbered-option keypress; for other modes only
      // send tmux input when the hook didn't already handle the decision (avoids
      // injecting a stale keypress into the next prompt after CC advances).
      await this.tmux.sendKeys(session.windowId, uiApprovalInput, true);
    } else if (!resolvedPendingPermission && uiApprovalInput === null) {
      await this.tmux.sendKeys(session.windowId, 'n', true);
    }

    session.lastActivity = Date.now();
    if (session.permissionPromptAt) {
      session.permissionRespondedAt = Date.now();
    }
  }

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
    return this.permissionRequests.waitForPermissionDecision(sessionId, timeoutMs, toolName, prompt);
  }

  /** Check if a session has a pending permission request. */
  hasPendingPermission(sessionId: string): boolean {
    return this.permissionRequests.hasPendingPermission(sessionId);
  }

  /** Get info about a pending permission (for API responses). */
  getPendingPermissionInfo(sessionId: string): PendingPermissionInfo | null {
    return this.permissionRequests.getPendingPermissionInfo(sessionId);
  }

  /** Clean up any pending permission for a session (e.g. on session delete). */
  cleanupPendingPermission(sessionId: string): void {
    this.permissionRequests.cleanupPendingPermission(sessionId);
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
  async escape(id: string): Promise<void> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);
    await this.tmux.sendSpecialKey(session.windowId, 'Escape');
  }

  /** Send Ctrl+C. */
  async interrupt(id: string): Promise<void> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);
    await this.tmux.sendSpecialKey(session.windowId, 'C-c');
  }

  /** Read new messages from a session. */
  async readMessages(id: string): Promise<{
    messages: ParsedEntry[];
    status: UIState;
    statusText: string | null;
    interactiveContent: string | null;
  }> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);
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
    windowName: string;
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

    const span = startSessionSpan('kill', id, { windowName: session.windowName });
    const tmuxSpan = startTmuxSpan('kill_window', session.windowId);
    try {
      await this.tmux.killWindow(session.windowId);
      spanOk(tmuxSpan);
    } catch (e) {
      spanError(tmuxSpan, e);
    }
    tmuxSpan.end();

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

      delete this.state.sessions[id];
      this.invalidateSessionsListCache();
      // #357: Cancel any pending debounced save before doing an immediate save
      if (this.saveDebounceTimer !== null) {
        clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = null;
      }
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
