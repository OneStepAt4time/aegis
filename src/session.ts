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
  autoApprove: boolean;          // Issue #26: auto-approve permission prompts
}

export interface SessionState {
  sessions: Record<string, SessionInfo>;
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
    if (changed) {
      await this.save();
    }

    // P0 fix: On startup, purge session_map entries that don't correspond to active sessions.
    // This prevents stale windowId collisions after aegis restarts where old @5 entries
    // could match newly assigned @5 windows pointing to completely different sessions.
    await this.purgeStaleSessionMapEntries(windowIds, windowNames);
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
  /**
   * Wait for CC to show its idle prompt in the tmux pane, then send the initial prompt.
   * Returns delivery result or undefined if CC didn't become ready in time.
   */
  async sendInitialPrompt(sessionId: string, prompt: string, timeoutMs = 15_000): Promise<{ delivered: boolean; attempts: number }> {
    const session = this.getSession(sessionId);
    if (!session) return { delivered: false, attempts: 0 };

    const pollInterval = 500;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const paneText = await this.tmux.capturePane(session.windowId);
      // CC shows ❯ when ready for input
      if (paneText && (paneText.includes('❯') || paneText.includes('>'))) {
        return this.sendMessage(sessionId, prompt);
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

    const { windowId, windowName: finalName } = await this.tmux.createWindow({
      workDir: opts.workDir,
      windowName,
      resumeSessionId: opts.resumeSessionId,
      claudeCommand: opts.claudeCommand,
      env: hasEnv ? mergedEnv : undefined,
    });

    const session: SessionInfo = {
      id,
      windowId,
      windowName: finalName,
      workDir: opts.workDir,
      byteOffset: 0,
      monitorOffset: 0,
      status: 'unknown',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      stallThresholdMs: opts.stallThresholdMs || SessionManager.DEFAULT_STALL_THRESHOLD_MS,
      autoApprove: opts.autoApprove ?? this.config.defaultAutoApprove ?? false,
    };

    this.state.sessions[id] = session;
    await this.save();

    // Start BOTH discovery methods in parallel:
    // 1. Hook-based: fast, relies on SessionStart hook writing session_map.json
    // 2. Filesystem-based: slower, scans for new .jsonl files — works when hooks fail
    // Issue #16: --bare flag skips hooks entirely
    // Field bug (Zeus 2026-03-22): hooks may not fire even without --bare
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
    if (windowHealth.windowExists) {
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
    // Alive = window exists AND (Claude running OR recently active)
    const recentlyActive = lastActivityAgo < 5 * 60 * 1000; // 5 minutes
    const alive = windowHealth.windowExists && (windowHealth.claudeRunning || recentlyActive);

    // Human-readable detail
    let details: string;
    if (!windowHealth.windowExists) {
      details = 'Tmux window does not exist — session is dead';
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

  /** Approve a permission prompt (send "y"). */
  async approve(id: string): Promise<void> {
    const session = this.state.sessions[id];
    if (!session) throw new Error(`Session ${id} not found`);
    await this.tmux.sendKeys(session.windowId, 'y', true);
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

            // Verify the JSONL file actually exists before accepting this mapping.
            const jsonlPath = await findSessionFile(info.session_id, this.config.claudeProjectsDir);

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
