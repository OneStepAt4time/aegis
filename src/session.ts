/**
 * session.ts — Session state manager.
 * 
 * Manages the lifecycle of CC sessions running in tmux windows.
 * Tracks: session ID, window ID, byte offset for JSONL reading, status.
 */

import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { TmuxManager } from './tmux.js';
import { findSessionFile, readNewEntries, type ParsedEntry } from './transcript.js';
import { detectUIState, extractInteractiveContent, parseStatusLine, type UIState } from './terminal-parser.js';
import type { Config } from './config.js';
import { neutralizeBypassPermissions, restoreSettings, cleanOrphanedBackup } from './permission-guard.js';
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
  permissionMode: string;        // Permission mode: "default"|"plan"|"acceptEdits"|"bypassPermissions"|"dontAsk"|"auto"
  settingsPatched?: boolean;     // Permission guard: settings.local.json was patched
  hookSettingsFile?: string;     // Temp file with HTTP hook settings (Issue #169)
  lastHookAt?: number;           // Unix timestamp of last received hook event (Issue #169 Phase 3)
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

export class SessionManager {
  private state: SessionState = { sessions: {} };
  private stateFile: string;
  private sessionMapFile: string;
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private tmux: TmuxManager,
    private config: Config
  ) {
    this.stateFile = join(config.stateDir, 'state.json');
    this.sessionMapFile = join(config.stateDir, 'session_map.json');
  }

  /** Load state from disk. */
  async load(): Promise<void> {
    const dir = dirname(this.stateFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    if (existsSync(this.stateFile)) {
      try {
        const data = JSON.parse(await readFile(this.stateFile, 'utf-8'));
        this.state = data;
      } catch {
        this.state = { sessions: {} };
      }
    }

    // Reconcile: verify tmux windows still exist, clean up dead sessions
    await this.reconcile();
  }

  /** Reconcile state with actual tmux windows. Remove dead sessions, restart discovery for live ones. */
  private async reconcile(): Promise<void> {
    const windows = await this.tmux.listWindows();
    const windowIds = new Set(windows.map(w => w.windowId));
    const windowNames = new Set(windows.map(w => w.windowName));

    let changed = false;
    for (const [id, session] of Object.entries(this.state.sessions)) {
      const alive = windowIds.has(session.windowId) || windowNames.has(session.windowName);
      if (!alive) {
        console.log(`Reconcile: session ${session.windowName} (${id.slice(0, 8)}) — tmux window gone, removing`);
        // Restore patched settings before removing dead session
        if (session.settingsPatched) {
          await cleanOrphanedBackup(session.workDir);
        }
        delete this.state.sessions[id];
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
    await this.purgeStaleSessionMapEntries(windowIds, windowNames);

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

  /** Save state to disk atomically (write to temp, then rename). */
  async save(): Promise<void> {
    const dir = dirname(this.stateFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const tmpFile = `${this.stateFile}.tmp`;
    await writeFile(tmpFile, JSON.stringify(this.state, null, 2));
    await rename(tmpFile, this.stateFile);
  }

  /** Default stall threshold: 5 minutes (Issue #4: reduced from 60 min). */
  static readonly DEFAULT_STALL_THRESHOLD_MS = 5 * 60 * 1000;

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

    const pollInterval = 500;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // Use capturePaneDirect to bypass the serialize queue.
      // At session creation, no other code is writing to this pane,
      // so queue serialization is unnecessary and adds latency.
      const paneText = await this.tmux.capturePaneDirect(session.windowId);
      // CC shows ❯ when ready for input
      if (paneText && (paneText.includes('❯') || paneText.includes('>'))) {
        return this.sendMessageDirect(sessionId, prompt);
      }
      await new Promise(r => setTimeout(r, pollInterval));
    }
    return { delivered: false, attempts: 0 };
  }

  async createSession(opts: {
    workDir: string;
    name?: string;
    resumeSessionId?: string;
    claudeCommand?: string;
    env?: Record<string, string>;
    stallThresholdMs?: number;
    permissionMode?: string;
    /** @deprecated Use permissionMode instead. Maps true→bypassPermissions, false→default. */
    autoApprove?: boolean;
  }): Promise<SessionInfo> {
    const id = crypto.randomUUID();
    const windowName = opts.name || `cc-${id.slice(0, 8)}`;

    // Merge defaultSessionEnv (from config) with per-session env (per-session wins)
    const mergedEnv = {
      ...this.config.defaultSessionEnv,
      ...opts.env,
    };
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

    // Issue #169 Phase 2: Generate HTTP hook settings for this session.
    // Writes a temp file with hooks pointing to Aegis's hook receiver.
    let hookSettingsFile: string | undefined;
    try {
      const baseUrl = `http://${this.config.host}:${this.config.port}`;
      hookSettingsFile = await writeHookSettingsFile(baseUrl, id);
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
      permissionMode: effectivePermissionMode,
      settingsPatched,
      hookSettingsFile,
    };

    this.state.sessions[id] = session;
    await this.save();

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
   *  Returns the previous status for change detection. */
  updateStatusFromHook(id: string, hookEvent: string): UIState | null {
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
        session.status = 'ask_question';
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

    return prevStatus;
  }

  /** Check if a session's tmux window still exists and has a live process.
   *  Issue #69: A window can exist with a crashed/zombie CC process (zombie window).
   *  After checking window exists, also verify the pane PID is alive. */
  async isWindowAlive(id: string): Promise<boolean> {
    const session = this.state.sessions[id];
    if (!session) return false;
    try {
      if (!(await this.tmux.windowExists(session.windowId))) return false;
      // Verify the process inside the pane is still alive
      const panePid = await this.tmux.listPanePid(session.windowId);
      if (panePid !== null && !this.tmux.isPidAlive(panePid)) return false;
      return true;
    } catch {
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
      } catch {
        processAlive = false;
      }
    }

    if (windowHealth.windowExists && processAlive) {
      try {
        const paneText = await this.tmux.capturePane(session.windowId);
        status = detectUIState(paneText);
        session.status = status;
      } catch {
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
   *  Uses sendKeysDirect instead of sendKeysVerified — simpler, faster,
   *  acceptable because at session creation there are no race conditions.
   */
  private async sendMessageDirect(id: string, text: string): Promise<{ delivered: boolean; attempts: number }> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);

    await this.tmux.sendKeysDirect(session.windowId, text);
    session.lastActivity = Date.now();
    await this.save();
    return { delivered: true, attempts: 1 };
  }

  /** Approve a permission prompt. Sends "1" for numbered options, "y" otherwise. */
  async approve(id: string): Promise<void> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);

    const paneText = await this.tmux.capturePane(session.windowId);
    const method = detectApprovalMethod(paneText);
    await this.tmux.sendKeys(session.windowId, method === 'numbered' ? '1' : 'y', true);
    session.lastActivity = Date.now();
  }

  /** Reject a permission prompt (send "n"). */
  async reject(id: string): Promise<void> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);
    await this.tmux.sendKeys(session.windowId, 'n', true);
    session.lastActivity = Date.now();
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

    await this.save();

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

    // Read ALL messages from the beginning for summary
    let allMessages: ParsedEntry[] = [];
    if (session.jsonlPath && existsSync(session.jsonlPath)) {
      try {
        const result = await readNewEntries(session.jsonlPath, 0);
        allMessages = result.entries;
      } catch { /* file may be corrupted */ }
    }

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
  async readTranscript(id: string, offset = 0, limit = 50): Promise<{
    entries: ParsedEntry[];
    nextOffset: number;
    totalEntries: number;
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
    if (session.jsonlPath && existsSync(session.jsonlPath)) {
      try {
        const result = await readNewEntries(session.jsonlPath, 0);
        allEntries = result.entries;
      } catch { /* file may be corrupted */ }
    }

    const page = allEntries.slice(offset, offset + limit);
    return {
      entries: page,
      nextOffset: offset + page.length < allEntries.length ? offset + limit : -1,
      totalEntries: allEntries.length,
    };
  }

  /** Kill a session. */
  async killSession(id: string): Promise<void> {
    const session = this.state.sessions[id];
    if (!session) return;

    // Stop polling
    const timer = this.pollTimers.get(id);
    if (timer) {
      clearInterval(timer);
      this.pollTimers.delete(id);
    }

    await this.tmux.killWindow(session.windowId);

    // Permission guard: restore original settings.local.json if we patched it
    if (session.settingsPatched) {
      await restoreSettings(session.workDir);
    }

    // Issue #169 Phase 2: Clean up temp hook settings file
    if (session.hookSettingsFile) {
      await cleanupHookSettingsFile(session.hookSettingsFile);
    }

    delete this.state.sessions[id];
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
      const mapData = JSON.parse(await readFile(this.sessionMapFile, 'utf-8'));
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
      const mapData = JSON.parse(await readFile(this.sessionMapFile, 'utf-8'));
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
      const mapData = JSON.parse(await readFile(this.sessionMapFile, 'utf-8'));

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
