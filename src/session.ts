/**
 * session.ts — Session state manager.
 * 
 * Manages the lifecycle of CC sessions running in tmux windows.
 * Tracks: session ID, window ID, byte offset for JSONL reading, status.
 */

import { readFile, writeFile, rename, mkdir, stat, readdir, unlink } from 'node:fs/promises';
import { existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { TmuxManager, type TmuxWindow } from './tmux.js';
import { findSessionFile, readNewEntries, type ParsedEntry } from './transcript.js';
import { detectUIState, extractInteractiveContent, parseStatusLine, type UIState } from './terminal-parser.js';
import type { Config } from './config.js';
import { neutralizeBypassPermissions, restoreSettings, cleanOrphanedBackup } from './permission-guard.js';
import { persistedStateSchema, sessionMapSchema } from './validation.js';
import { writeHookSettingsFile, cleanupHookSettingsFile } from './hook-settings.js';

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
}

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
  // Match CC's permission option format: indented "  1. Yes" lines
  // The indentation + short number range distinguishes from output numbered lists
  const numberedOptionPattern = /^\s{2}[1-3]\.\s/m;
  if (numberedOptionPattern.test(paneText)) {
    return 'numbered';
  }
  return 'yes';
}

/** Resolves a pending PermissionRequest hook with a decision. */
export type PermissionDecision = 'allow' | 'deny';

/** Pending permission resolver stored while waiting for client approval. */
interface PendingPermission {
  resolve: (decision: PermissionDecision) => void;
  timer: NodeJS.Timeout;
  toolName?: string;
  prompt?: string;
}

/** Pending answer resolver for AskUserQuestion tool calls (Issue #336). */
interface PendingQuestion {
  resolve: (answer: string | null) => void;
  timer: NodeJS.Timeout;
  toolUseId: string;
  question: string;
  timestamp: number;
}

export class SessionManager {
  private state: SessionState = { sessions: {} };
  private stateFile: string;
  private sessionMapFile: string;
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();
  private saveQueue: Promise<void> = Promise.resolve(); // #218: serialize concurrent saves
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private static readonly SAVE_DEBOUNCE_MS = 5_000; // #357: debounce offset-only saves
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  private pendingQuestions: Map<string, PendingQuestion> = new Map();
  // #357: Cache of all parsed JSONL entries per session to avoid re-reading from offset 0
  // #424: Evict oldest entries when cache exceeds max to prevent unbounded growth
  private static readonly MAX_CACHE_ENTRIES_PER_SESSION = 10_000;
  private parsedEntriesCache = new Map<string, { entries: ParsedEntry[]; offset: number }>();

  constructor(
    private tmux: TmuxManager,
    private config: Config
  ) {
    this.stateFile = join(config.stateDir, 'state.json');
    this.sessionMapFile = join(config.stateDir, 'session_map.json');
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

  /** Load state from disk. */
  async load(): Promise<void> {
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
          this.state = { sessions: parsed.data as Record<string, SessionInfo> };
        } else {
          console.warn('State file failed validation, attempting backup restore');
          // Try loading from backup before resetting
          const backupFile = `${this.stateFile}.bak`;
          if (existsSync(backupFile)) {
            try {
              const backupRaw = await readFile(backupFile, 'utf-8');
              const backupParsed = persistedStateSchema.safeParse(JSON.parse(backupRaw));
              if (backupParsed.success && this.isValidState({ sessions: backupParsed.data })) {
                this.state = { sessions: backupParsed.data as Record<string, SessionInfo> };
                console.log('Restored state from backup');
              } else {
                this.state = { sessions: {} };
              }
            } catch { /* backup state file corrupted — start empty */
              this.state = { sessions: {} };
            }
          } else {
            this.state = { sessions: {} };
          }
        }
      } catch { /* state file corrupted — start empty */
        this.state = { sessions: {} };
      }
    }

    // #357: Convert deserialized activeSubagents arrays to Sets
    for (const session of Object.values(this.state.sessions)) {
      if (Array.isArray(session.activeSubagents)) {
        session.activeSubagents = new Set(session.activeSubagents);
      }
    }

    // Create backup of successfully loaded state
    try {
      await writeFile(`${this.stateFile}.bak`, JSON.stringify(this.state, null, 2));
    } catch { /* non-critical */ }

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
          this.startSessionIdDiscovery(id);
        }
        changed = true;
      } else {
        // Session is alive — restart discovery if needed
        if (!session.claudeSessionId || !session.jsonlPath) {
          console.log(`Reconcile: session ${session.windowName} — restarting JSONL discovery`);
          this.startSessionIdDiscovery(id);
        } else {
          console.log(`Reconcile: session ${session.windowName} — alive, JSONL ready`);
        }
      }
    }

    // P0 fix: On startup, purge session_map entries that don't correspond to active sessions.
    const finalWindowIds = new Set(Object.values(this.state.sessions).map(s => s.windowId));
    const finalWindowNames = new Set(Object.values(this.state.sessions).map(s => s.windowName));
    await this.purgeStaleSessionMapEntries(finalWindowIds, finalWindowNames);

    // Issue #35: Adopt orphaned tmux windows (cc-* prefix) not in state
    const knownWindowIds = new Set(Object.values(this.state.sessions).map(s => s.windowId));
    const knownWindowNames = new Set(Object.values(this.state.sessions).map(s => s.windowName));
    for (const win of windows) {
      if (knownWindowIds.has(win.windowId) || knownWindowNames.has(win.windowName)) continue;
      // Only adopt windows that look like Aegis-created sessions (cc-* prefix or _bridge_ prefix)
      if (!win.windowName.startsWith('cc-') && !win.windowName.startsWith('_bridge_')) continue;

      const id = crypto.randomUUID();
      const session: SessionInfo = {
        id,
        windowId: win.windowId,
        windowName: win.windowName,
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
      console.log(`Reconcile: adopted orphaned window ${win.windowName} (${win.windowId}) as ${id.slice(0, 8)}`);
      this.startSessionIdDiscovery(id);
      this.startFilesystemDiscovery(id, session.workDir);
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
          this.startSessionIdDiscovery(id);
          this.startFilesystemDiscovery(id, session.workDir);
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
      void this.save();
    }, SessionManager.SAVE_DEBOUNCE_MS);
  }

  private async doSave(): Promise<void> {
    const dir = dirname(this.stateFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const tmpFile = `${this.stateFile}.tmp`;
    // #357: Use replacer to serialize Set<string> as arrays
    await writeFile(tmpFile, JSON.stringify(this.state, (_, value) => {
      if (value instanceof Set) return [...value];
      return value;
    }, 2));
    await rename(tmpFile, this.stateFile);
  }

  /** Default stall threshold: 5 minutes (Issue #4: reduced from 60 min). */
  static readonly DEFAULT_STALL_THRESHOLD_MS = 5 * 60 * 1000;
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
        // recognized active state. If CC stays in idle/unknown, the prompt was
        // swallowed — report as undelivered so the retry loop can re-attempt.
        const verified = await this.verifyPromptAccepted(session.windowId);
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
   * by polling for a state transition away from idle/unknown.
   * Returns true if CC transitions to a recognized active state within the timeout.
   */
  private async verifyPromptAccepted(windowId: string): Promise<boolean> {
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
      // idle or unknown — keep polling
      await new Promise(r => setTimeout(r, VERIFY_POLL_MS));
    }

    console.warn(`verifyPromptAccepted: CC did not transition from idle/unknown within ${VERIFY_TIMEOUT_MS}ms`);
    return false;
  }

  async createSession(opts: {
    workDir: string;
    name?: string;
    resumeSessionId?: string;
    claudeCommand?: string;
    env?: Record<string, string>;
    stallThresholdMs?: number;
    permissionStallMs?: number;    // Issue #89 L8: per-session permission stall threshold
    permissionMode?: string;
    /** @deprecated Use permissionMode instead. Maps true→bypassPermissions, false→default. */
    autoApprove?: boolean;
  }): Promise<SessionInfo> {
    const id = crypto.randomUUID();
    const windowName = opts.name || `cc-${id.slice(0, 8)}`;

    // Merge defaultSessionEnv (from config) with per-session env (per-session wins)
    // Security: validate env var names to prevent injection attacks
    const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
    const DANGEROUS_ENV_VARS = new Set([
      'PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'NODE_OPTIONS',
      'DYLD_INSERT_LIBRARIES', 'IFS', 'SHELL', 'ENV', 'BASH_ENV',
      'PYTHONPATH', 'PERL5LIB', 'RUBYLIB', 'CLASSPATH',
      'NODE_PATH', 'PYTHONHOME', 'PYTHONSTARTUP',
    ]);
    const mergedEnv: Record<string, string> = {};
    const allEnv = { ...this.config.defaultSessionEnv, ...opts.env };
    for (const [key, value] of Object.entries(allEnv)) {
      if (!ENV_NAME_RE.test(key)) {
        throw new Error(`Invalid env var name: "${key}" — must match /^[A-Z_][A-Z0-9_]*$/`);
      }
      if (DANGEROUS_ENV_VARS.has(key)) {
        throw new Error(`Forbidden env var: "${key}" — cannot override dangerous environment variables`);
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
      ?? 'bypassPermissions';
    let settingsPatched = false;
    if (effectivePermissionMode !== 'bypassPermissions') {
      settingsPatched = await neutralizeBypassPermissions(opts.workDir, effectivePermissionMode);
    }

    // Issue #169 Phase 2: Generate HTTP hook settings for this session.
    // Writes a temp file with hooks pointing to Aegis's hook receiver.
    let hookSettingsFile: string | undefined;
    try {
      const baseUrl = `http://${this.config.host}:${this.config.port}`;
      hookSettingsFile = await writeHookSettingsFile(baseUrl, id, opts.workDir);
    } catch (e) {
      console.error(`Hook settings: failed to generate settings file: ${(e as Error).message}`);
      // Non-fatal: hooks won't work for this session, but CC still launches
    }

    const { windowId, windowName: finalName, freshSessionId } = await this.tmux.createWindow({
      workDir: opts.workDir,
      windowName,
      resumeSessionId: opts.resumeSessionId,
      claudeCommand: opts.claudeCommand,
      env: hasEnv ? mergedEnv : undefined,
      permissionMode: effectivePermissionMode,
      settingsFile: hookSettingsFile,
    });

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
    };

    this.state.sessions[id] = session;
    await this.save();

    // Issue #353: Fetch CC process PID for swarm parent matching.
    // Fire-and-forget — PID is not needed synchronously.
    void this.tmux.listPanePid(windowId).then(pid => {
      if (pid !== null) {
        session.ccPid = pid;
        void this.save();
      }
    });

    // Start BOTH discovery methods in parallel:
    // 1. Hook-based: fast, relies on SessionStart hook writing session_map.json
    // 2. Filesystem-based: slower, scans for new .jsonl files — works when hooks fail
    // Issue #16: --bare flag skips hooks entirely
    // Field bug (Zeus 2026-03-22): hooks may not fire even without --bare
    //
    // If we already have the claudeSessionId (from --session-id), filesystem discovery
    // will just find the JSONL path. Hook discovery may still run but won't override.
    this.startFilesystemDiscovery(id, opts.workDir);

    // P0 fix: Clean stale entries from session_map.json for BOTH window name AND id.
    // After archiving old .jsonl files, stale session_map entries would point
    // to moved files, causing discovery to pick up ghost session IDs.
    // Also cleans stale windowId entries that could collide after restart.
    await this.cleanSessionMapForWindow(finalName, windowId);

    // Start watching for the CC session ID via hook
    this.startSessionIdDiscovery(id);

    return session;
  }

  /** Get a session by ID. */
  getSession(id: string): SessionInfo | null {
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
        session.status = 'idle';
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
      session.lastHookEventAt = hookTimestamp;
    }

    // Issue #87: Track permission prompt timestamp
    if (hookEvent === 'PermissionRequest') {
      session.permissionPromptAt = now;
    }

    return prevStatus;
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
    let stateChangeDetection: number | null = hookLatency;

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
      // Issue #390: Fast crash detection via stored CC PID
      if (session.ccPid && !this.tmux.isPidAlive(session.ccPid)) return false;

      if (!(await this.tmux.windowExists(session.windowId))) return false;
      // Verify the process inside the pane is still alive
      const panePid = await this.tmux.listPanePid(session.windowId);
      if (panePid !== null && !this.tmux.isPidAlive(panePid)) return false;
      return true;
    } catch { /* tmux query failed — treat as not alive */
      return false;
    }
  }

  /** List all sessions. */
  listSessions(): SessionInfo[] {
    return Object.values(this.state.sessions);
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
    if (windowHealth.windowExists) {
      try {
        const panePid = await this.tmux.listPanePid(session.windowId);
        if (panePid !== null) {
          processAlive = this.tmux.isPidAlive(panePid);
        }
      } catch { /* cannot list pane PID — assume dead */
        processAlive = false;
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
   */
  async sendMessage(id: string, text: string): Promise<{ delivered: boolean; attempts: number }> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);

    const result = await this.tmux.sendKeysVerified(session.windowId, text);
    session.lastActivity = Date.now();
    await this.save();
    return result;
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
    session.lastActivity = Date.now();
    await this.save();
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

    // Issue #284: Resolve pending hook-based permission first
    if (this.resolvePendingPermission(id, 'allow')) {
      session.lastActivity = Date.now();
      if (session.permissionPromptAt) {
        session.permissionRespondedAt = Date.now();
      }
      return;
    }

    // Fallback: tmux send-keys
    const paneText = await this.tmux.capturePane(session.windowId);
    const method = detectApprovalMethod(paneText);
    await this.tmux.sendKeys(session.windowId, method === 'numbered' ? '1' : 'y', true);
    session.lastActivity = Date.now();
    if (session.permissionPromptAt) {
      session.permissionRespondedAt = Date.now();
    }
  }

  /** Reject a permission prompt. Resolves pending hook permission first, falls back to tmux send-keys. */
  async reject(id: string): Promise<void> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);

    // Issue #284: Resolve pending hook-based permission first
    if (this.resolvePendingPermission(id, 'deny')) {
      session.lastActivity = Date.now();
      if (session.permissionPromptAt) {
        session.permissionRespondedAt = Date.now();
      }
      return;
    }

    // Fallback: tmux send-keys
    await this.tmux.sendKeys(session.windowId, 'n', true);
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
    return new Promise<PermissionDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(sessionId);
        console.log(`Hooks: PermissionRequest timeout for session ${sessionId} — auto-rejecting`);
        resolve('deny');
      }, timeoutMs);

      this.pendingPermissions.set(sessionId, { resolve, timer, toolName, prompt });
    });
  }

  /** Check if a session has a pending permission request. */
  hasPendingPermission(sessionId: string): boolean {
    return this.pendingPermissions.has(sessionId);
  }

  /** Get info about a pending permission (for API responses). */
  getPendingPermissionInfo(sessionId: string): { toolName?: string; prompt?: string } | null {
    const pending = this.pendingPermissions.get(sessionId);
    return pending ? { toolName: pending.toolName, prompt: pending.prompt } : null;
  }

  /**
   * Resolve a pending permission. Returns true if there was a pending permission to resolve.
   */
  private resolvePendingPermission(sessionId: string, decision: PermissionDecision): boolean {
    const pending = this.pendingPermissions.get(sessionId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingPermissions.delete(sessionId);
    pending.resolve(decision);
    return true;
  }

  /** Clean up any pending permission for a session (e.g. on session delete). */
  cleanupPendingPermission(sessionId: string): void {
    const pending = this.pendingPermissions.get(sessionId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingPermissions.delete(sessionId);
    }
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
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingQuestions.delete(sessionId);
        console.log(`Hooks: AskUserQuestion timeout for session ${sessionId} — allowing without answer`);
        resolve(null);
      }, timeoutMs);

      this.pendingQuestions.set(sessionId, { resolve, timer, toolUseId, question, timestamp: Date.now() });
    });
  }

  /** Issue #336: Submit an answer to a pending question. Returns true if resolved. */
  submitAnswer(sessionId: string, questionId: string, answer: string): boolean {
    const pending = this.pendingQuestions.get(sessionId);
    if (!pending) return false;
    if (pending.toolUseId !== questionId) return false;
    clearTimeout(pending.timer);
    this.pendingQuestions.delete(sessionId);
    pending.resolve(answer);
    return true;
  }

  /** Issue #336: Check if a session has a pending question. */
  hasPendingQuestion(sessionId: string): boolean {
    return this.pendingQuestions.has(sessionId);
  }

  /** Issue #336: Get info about a pending question. */
  getPendingQuestionInfo(sessionId: string): { toolUseId: string; question: string; timestamp: number } | null {
    const pending = this.pendingQuestions.get(sessionId);
    return pending ? { toolUseId: pending.toolUseId, question: pending.question, timestamp: pending.timestamp } : null;
  }

  /** Issue #336: Clean up any pending question for a session. */
  cleanupPendingQuestion(sessionId: string): void {
    const pending = this.pendingQuestions.get(sessionId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingQuestions.delete(sessionId);
    }
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

    // Detect UI state from terminal
    const paneText = await this.tmux.capturePane(session.windowId);
    const status = detectUIState(paneText);
    const statusText = parseStatusLine(paneText);
    const interactive = extractInteractiveContent(paneText);

    session.status = status;
    session.lastActivity = Date.now();

    // Try to find JSONL if we don't have it yet
    if (!session.jsonlPath && session.claudeSessionId) {
      const path = await findSessionFile(session.claudeSessionId, this.config.claudeProjectsDir);
      if (path) {
        session.jsonlPath = path;
        session.byteOffset = 0;
      }
    }

    // Read JSONL if we have the file path
    let messages: ParsedEntry[] = [];
    if (session.jsonlPath && existsSync(session.jsonlPath)) {
      try {
        const result = await readNewEntries(session.jsonlPath, session.byteOffset);
        messages = result.entries;
        session.byteOffset = result.newOffset;
      } catch {
        // File may not exist yet
      }
    }

    // #357: Debounce saves on GET reads — offsets change frequently but disk
    // writes are expensive. Full save still happens on create/kill/reconcile.
    this.debouncedSave();

    return {
      messages,
      status,
      statusText,
      interactiveContent: interactive?.content || null,
    };
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

    // Detect UI state from terminal
    const paneText = await this.tmux.capturePane(session.windowId);
    const status = detectUIState(paneText);
    const statusText = parseStatusLine(paneText);
    const interactive = extractInteractiveContent(paneText);

    session.status = status;

    // Try to find JSONL if we don't have it yet
    if (!session.jsonlPath && session.claudeSessionId) {
      const path = await findSessionFile(session.claudeSessionId, this.config.claudeProjectsDir);
      if (path) {
        session.jsonlPath = path;
        session.monitorOffset = 0;
      }
    }

    // Read JSONL using monitor offset
    let messages: ParsedEntry[] = [];
    if (session.jsonlPath && existsSync(session.jsonlPath)) {
      try {
        const result = await readNewEntries(session.jsonlPath, session.monitorOffset);
        messages = result.entries;
        session.monitorOffset = result.newOffset;
      } catch {
        // File may not exist yet
      }
    }

    return {
      messages,
      status,
      statusText,
      interactiveContent: interactive?.content || null,
    };
  }

  /** #357: Get all parsed entries for a session, using a cache to avoid full reparse.
   *  Reads only the delta from the last cached offset. */
  private async getCachedEntries(session: SessionInfo): Promise<ParsedEntry[]> {
    if (!session.jsonlPath || !existsSync(session.jsonlPath)) return [];
    const cached = this.parsedEntriesCache.get(session.id);
    try {
      const fromOffset = cached ? cached.offset : 0;
      const result = await readNewEntries(session.jsonlPath, fromOffset);
      if (cached) {
        cached.entries.push(...result.entries);
        cached.offset = result.newOffset;
        // #424: Evict oldest entries when cache exceeds per-session cap
        if (cached.entries.length > SessionManager.MAX_CACHE_ENTRIES_PER_SESSION) {
          cached.entries.splice(0, cached.entries.length - SessionManager.MAX_CACHE_ENTRIES_PER_SESSION);
        }
        return cached.entries;
      }
      // First read — cache it
      this.parsedEntriesCache.set(session.id, { entries: [...result.entries], offset: result.newOffset });
      return result.entries;
    } catch { /* JSONL read failed — return cached entries or empty */
      return cached ? [...cached.entries] : [];
    }
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
  }> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);

    // #357: Use cached entries instead of re-reading from offset 0
    const allMessages = await this.getCachedEntries(session);

    // Take last N messages
    const recent = allMessages.slice(-maxMessages).map(m => ({
      role: m.role,
      contentType: m.contentType,
      text: m.text.slice(0, 500), // Truncate long messages
    }));

    return {
      sessionId: session.id,
      windowName: session.windowName,
      status: session.status,
      totalMessages: allMessages.length,
      messages: recent,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      permissionMode: session.permissionMode,
    };
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

    // Discover JSONL path if not yet known
    if (!session.jsonlPath && session.claudeSessionId) {
      const path = await findSessionFile(session.claudeSessionId, this.config.claudeProjectsDir);
      if (path) {
        session.jsonlPath = path;
        session.byteOffset = 0;
      }
    }

    let allEntries: ParsedEntry[] = [];
    // #357: Use cached entries instead of re-reading from offset 0
    allEntries = await this.getCachedEntries(session);

    if (roleFilter) {
      allEntries = allEntries.filter(e => e.role === roleFilter);
    }

    const total = allEntries.length;
    const start = (page - 1) * limit;
    const messages = allEntries.slice(start, start + limit);
    const hasMore = start + messages.length < total;

    return {
      messages,
      total,
      page,
      limit,
      hasMore,
    };
  }

  /** #405: Clean up all tracking maps for a session to prevent memory leaks. */
  private cleanupSession(id: string): void {
    // Clear polling timers (both regular and filesystem discovery variants)
    for (const key of [id, `fs-${id}`]) {
      const timer = this.pollTimers.get(key);
      if (timer) {
        clearInterval(timer);
        this.pollTimers.delete(key);
      }
    }

    this.cleanupPendingPermission(id);
    this.cleanupPendingQuestion(id);
    this.parsedEntriesCache.delete(id);
  }

  /** Kill a session. */
  async killSession(id: string): Promise<void> {
    const session = this.state.sessions[id];
    if (!session) return;

    await this.tmux.killWindow(session.windowId);

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
    // #357: Cancel any pending debounced save before doing an immediate save
    if (this.saveDebounceTimer !== null) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    await this.save();
  }

  /** Remove stale entries from session_map.json for a given window.
   *  P0 fix: After aegis service restarts, old session_map entries with stale windowIds
   *  can survive and cause new sessions to inherit context from old sessions.
   *  We must clean by BOTH windowName AND windowId to prevent collisions.
   *
   *  After archiving old .jsonl files, old hook entries would cause discovery
   *  to map the new session to a ghost claudeSessionId whose file no longer exists.
   */
  private async cleanSessionMapForWindow(windowName: string, windowId?: string): Promise<void> {
    if (!existsSync(this.sessionMapFile)) return;
    try {
      const raw = await readFile(this.sessionMapFile, 'utf-8');
      const parsed = sessionMapSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        console.warn('session_map.json failed validation in cleanSessionMapForWindow');
        return;
      }
      const mapData = parsed.data;
      let changed = false;
      for (const [key, info] of Object.entries(mapData) as [string, any][]) {
        // Clean by window_name (original behavior)
        if (info.window_name === windowName) {
          delete mapData[key];
          changed = true;
          continue;
        }
        // P0 fix: Also clean entries where key ends with :windowId
        // This prevents stale windowId collisions after restart
        if (windowId && key.endsWith(':' + windowId)) {
          delete mapData[key];
          changed = true;
        }
      }
      if (changed) {
        const tmpFile = `${this.sessionMapFile}.tmp`;
        await writeFile(tmpFile, JSON.stringify(mapData, null, 2));
        await rename(tmpFile, this.sessionMapFile);
      }
    } catch { /* ignore parse/write errors */ }
  }

  /** P0 fix: Purge session_map entries that don't correspond to active aegis sessions.
   *  After aegis restarts, old session_map entries with stale windowIds can survive
   *  and cause new sessions to inherit context from old sessions.
   */
  private async purgeStaleSessionMapEntries(
    activeWindowIds: Set<string>,
    activeWindowNames: Set<string>
  ): Promise<void> {
    if (!existsSync(this.sessionMapFile)) return;
    try {
      const raw = await readFile(this.sessionMapFile, 'utf-8');
      const parsed = sessionMapSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        console.warn('session_map.json failed validation in purgeStaleSessionMapEntries');
        return;
      }
      const mapData = parsed.data;
      let changed = false;
      const activeNamesLower = new Set([...activeWindowNames].map(n => n.toLowerCase()));

      for (const [key, info] of Object.entries(mapData) as [string, any][]) {
        // Extract windowId from key (format: "sessionName:windowId")
        const keyWindowId = key.includes(':') ? key.split(':').pop() : null;
        const windowName = (info.window_name || '').toLowerCase();

        // Keep entry only if it matches an active window
        const windowIdActive = keyWindowId && activeWindowIds.has(keyWindowId);
        const windowNameActive = activeNamesLower.has(windowName);

        if (!windowIdActive && !windowNameActive) {
          console.log(`Reconcile: purging stale session_map entry: ${key}`);
          delete mapData[key];
          changed = true;
        }
      }
      if (changed) {
        const tmpFile = `${this.sessionMapFile}.tmp`;
        await writeFile(tmpFile, JSON.stringify(mapData, null, 2));
        await rename(tmpFile, this.sessionMapFile);
      }
    } catch { /* ignore parse/write errors */ }
  }

  /** Try to discover the CC session ID and JSONL path. */
  private startSessionIdDiscovery(id: string): void {
    const interval = setInterval(async () => {
      const session = this.state.sessions[id];
      if (!session) {
        clearInterval(interval);
        this.pollTimers.delete(id);
        return;
      }

      // Stop when we have both session ID and JSONL path
      if (session.claudeSessionId && session.jsonlPath) {
        clearInterval(interval);
        this.pollTimers.delete(id);
        return;
      }

      try {
        await this.syncSessionMap();
        
        // If we have claudeSessionId but no jsonlPath, try finding it
        if (session.claudeSessionId && !session.jsonlPath) {
          const jsonlPath = await findSessionFile(session.claudeSessionId, this.config.claudeProjectsDir);
          if (jsonlPath) {
            session.jsonlPath = jsonlPath;
            session.byteOffset = 0;
            await this.save();
          }
        }
      } catch { /* ignore */ }
    }, 2000);

    this.pollTimers.set(id, interval);

    // P3 fix: Stop after 5 minutes if not found, log timeout
    setTimeout(() => {
      const timer = this.pollTimers.get(id);
      const session = this.state.sessions[id];
      if (timer) {
        clearInterval(timer);
        this.pollTimers.delete(id);
        // P3 fix: Log when discovery times out
        if (session && !session.claudeSessionId) {
          console.log(`Discovery: session ${session.windowName} — timed out after 5min, no session_id found`);
        }
      }
    }, 5 * 60 * 1000);
  }

  /** Issue #16: Filesystem-based discovery for --bare mode (no hooks).
   *  Scans the Claude projects directory for new .jsonl files created after the session.
   */
  private startFilesystemDiscovery(id: string, workDir: string): void {
    const projectHash = '-' + workDir.replace(/^\//, '').replace(/\//g, '-');
    const projectDir = join(this.config.claudeProjectsDir, projectHash);

    const interval = setInterval(async () => {
      const session = this.state.sessions[id];
      if (!session) {
        clearInterval(interval);
        this.pollTimers.delete(`fs-${id}`);
        return;
      }

      if (session.claudeSessionId && session.jsonlPath) {
        clearInterval(interval);
        this.pollTimers.delete(`fs-${id}`);
        return;
      }

      try {
        if (!existsSync(projectDir)) return;
        const { readdir } = await import('node:fs/promises');
        const files = await readdir(projectDir);
        const jsonlFiles = files.filter(f =>
          f.endsWith('.jsonl') && !f.startsWith('.')
        );

        for (const file of jsonlFiles) {
          const filePath = join(projectDir, file);
          const fileStat = await stat(filePath);

          // Only consider files created after the session
          if (fileStat.mtimeMs < session.createdAt) continue;

          // Extract session ID from filename (filename = sessionId.jsonl)
          const sessionId = file.replace('.jsonl', '');
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sessionId)) continue;

          session.claudeSessionId = sessionId;
          session.jsonlPath = filePath;
          session.byteOffset = 0;
          console.log(`Discovery (filesystem): session ${session.windowName} mapped to ${sessionId.slice(0, 8)}...`);
          await this.save();
          break;
        }
      } catch { /* ignore */ }
    }, 3000);

    this.pollTimers.set(`fs-${id}`, interval);

    // Timeout after 5 minutes
    setTimeout(() => {
      const timer = this.pollTimers.get(`fs-${id}`);
      if (timer) {
        clearInterval(timer);
        this.pollTimers.delete(`fs-${id}`);
      }
    }, 5 * 60 * 1000);
  }

  /** Sync CC session IDs from the hook-written session_map.json. */
  private async syncSessionMap(): Promise<void> {
    if (!existsSync(this.sessionMapFile)) return;

    try {
      const mapRaw = await readFile(this.sessionMapFile, 'utf-8');
      const mapParsed = sessionMapSchema.safeParse(JSON.parse(mapRaw));
      if (!mapParsed.success) {
        console.warn('session_map.json failed validation in syncSessionMap');
        return;
      }
      const mapData = mapParsed.data;

      for (const session of Object.values(this.state.sessions) as SessionInfo[]) {
        if (session.claudeSessionId) continue;

        // Find matching entry by window ID (exact match to avoid @1 matching @10, @11, etc.)
        for (const [key, info] of Object.entries(mapData) as [string, any][]) {
          // P0 fix: Match by exact windowId suffix (e.g., "aegis:@5"), not substring
          // This prevents @5 from matching @15, @50, etc.
          const keyWindowId = key.includes(':') ? key.split(':').pop() : null;
          const matchesWindowId = keyWindowId === session.windowId;
          const matchesWindowName = info.window_name === session.windowName;

          if (matchesWindowId || matchesWindowName) {
            // GUARD 1: Timestamp — reject session_map entries written before this session was created.
            // After service restarts, old entries survive with stale windowIds that collide
            // with newly assigned tmux window IDs (tmux reuses @N identifiers).
            // Issue #6: Zeus D51 got claudeSessionId from D18/D19/D20 due to this.
            const writtenAt = info.written_at || 0;
            if (writtenAt > 0 && writtenAt < session.createdAt) {
              console.log(`Discovery: session ${session.windowName} — rejecting stale entry ` +
                `(written_at ${new Date(writtenAt).toISOString()} < createdAt ${new Date(session.createdAt).toISOString()})`);
              continue;
            }

            // Use transcript_path from hook if available (M3: eliminates filesystem scan)
            // Falls back to findSessionFile for backward compat with old hook versions
            let jsonlPath: string | null = null;
            if (info.transcript_path && existsSync(info.transcript_path)) {
              jsonlPath = info.transcript_path;
            } else {
              jsonlPath = await findSessionFile(info.session_id, this.config.claudeProjectsDir);
            }

            // GUARD 2: Reject paths in _archived/ directory — these are stale sessions
            if (jsonlPath && (jsonlPath.includes('/_archived/') || jsonlPath.includes('\\_archived\\'))) {
              console.log(`Discovery: session ${session.windowName} — rejecting archived path: ${jsonlPath}`);
              continue;
            }

            if (!jsonlPath) {
              // No JSONL file found — mapping is stale or CC hasn't written it yet.
              // Don't break — there may be a fresher entry. Continue searching.
              continue;
            }

            // GUARD 3: JSONL mtime — reject if file was last modified before session creation.
            // Catches cases where session_map has no written_at (old hook without timestamp)
            // but the JSONL is clearly from a previous session.
            try {
              const fileStat = await stat(jsonlPath);
              if (fileStat.mtimeMs < session.createdAt) {
                console.log(`Discovery: session ${session.windowName} — rejecting stale JSONL ` +
                  `(mtime ${new Date(fileStat.mtimeMs).toISOString()} < createdAt ${new Date(session.createdAt).toISOString()})`);
                continue;
              }
            } catch {
              // stat failed — file removed between find and stat
              continue;
            }

            session.claudeSessionId = info.session_id;
            session.jsonlPath = jsonlPath;
            session.byteOffset = 0;
            console.log(`Discovery: session ${session.windowName} mapped to ` +
              `${info.session_id.slice(0, 8)}... (verified: timestamp + mtime)`);
            break;
          }
        }
      }
      await this.save();
    } catch { /* ignore parse errors */ }
  }
}
