/**
 * tmux.ts — Low-level tmux interaction layer.
 * 
 * Wraps tmux CLI commands to manage windows inside a named session.
 * Port of CCBot's tmux_manager.py to TypeScript.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, rename as fsRename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const execFileAsync = promisify(execFile);

/** Default timeout for tmux commands (ms). Prevents hung commands from blocking the server. */
const TMUX_DEFAULT_TIMEOUT_MS = 10_000;

/** Thrown when a tmux command exceeds its timeout. */
export class TmuxTimeoutError extends Error {
  constructor(args: string[], timeoutMs: number) {
    super(`tmux command timed out after ${timeoutMs}ms: tmux ${args.join(' ')}`);
    this.name = 'TmuxTimeoutError';
  }
}

export interface TmuxWindow {
  windowId: string;      // e.g. "@0", "@12"
  windowName: string;
  cwd: string;
  paneCommand: string;   // current process in active pane
}

export class TmuxManager {
  /** tmux socket name (-L flag). Isolates sessions from other tmux instances. */
  readonly socketName: string;

  constructor(private sessionName: string = 'aegis', socketName?: string) {
    this.socketName = socketName ?? `aegis-${process.pid}`;
  }

  /** Promise-chain queue that serializes all tmux CLI calls to prevent race conditions. */
  private queue: Promise<void> = Promise.resolve(undefined as unknown as void);

  /** Run `fn` sequentially after all previously-queued operations complete. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    let resolve!: () => void;
    const next = new Promise<void>(r => { resolve = r; });
    const prev = this.queue;
    this.queue = next;
    return prev.then(async () => {
      try { return await fn(); }
      finally { resolve(); }
    });
  }

  /** Run a tmux command and return stdout (serialized through the queue).
   *  Issue #66: All tmux commands have a timeout to prevent hangs.
   *  A single hung tmux command would otherwise block the entire Aegis server.
   */
  private async tmux(...args: string[]): Promise<string> {
    return this.serialize(() => this.tmuxInternal(...args));
  }

  private async tmuxInternal(...args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('tmux', ['-L', this.socketName, ...args], {
        timeout: TMUX_DEFAULT_TIMEOUT_MS,
      });
      return stdout.trim();
    } catch (e: unknown) {
      // Node.js sets `killed` on the error when the process was killed due to timeout
      if (e && typeof e === 'object' && 'killed' in e && (e as { killed: boolean }).killed) {
        throw new TmuxTimeoutError(args, TMUX_DEFAULT_TIMEOUT_MS);
      }
      throw e;
    }
  }

  /** Ensure our tmux session exists and is healthy.
   *  Issue #7: After prolonged uptime, tmux session may exist but be degraded.
   *  We verify by listing windows — if that fails, recreate the session.
   */
  async ensureSession(): Promise<void> {
    try {
      await this.tmux('has-session', '-t', this.sessionName);
      // Session exists — verify it's healthy by listing windows
      await this.tmux('list-windows', '-t', this.sessionName, '-F', '#{window_id}');
    } catch {
      // Session doesn't exist or is unhealthy — (re)create it.
      // KillMode=process in the systemd service ensures only the node server
      // is killed on restart, not tmux or Claude Code processes inside.
      try {
        // Kill the broken session first if it exists
        await this.tmux('kill-session', '-t', this.sessionName);
      } catch { /* session may not exist */ }
      await this.tmux(
        'new-session', '-d', '-s', this.sessionName,
        '-n', '_bridge_main',
        '-x', '220', '-y', '50'
      );
      console.log(`Tmux: session '${this.sessionName}' (re)created`);
    }
  }

  /** List all windows (excluding the placeholder _bridge_main). */
  async listWindows(): Promise<TmuxWindow[]> {
    await this.ensureSession();
    try {
      const raw = await this.tmux(
        'list-windows', '-t', this.sessionName,
        '-F', '#{window_id}\t#{window_name}\t#{pane_current_path}\t#{pane_current_command}'
      );
      if (!raw) return [];
      return raw.split('\n').filter(Boolean).map(line => {
        const [windowId, windowName, cwd, paneCommand] = line.split('\t');
        return { windowId, windowName, cwd, paneCommand };
      }).filter(w => w.windowName !== '_bridge_main');
    } catch (e: unknown) {
      console.warn(`Tmux: listWindows failed: ${(e as Error).message}`);
      return [];
    }
  }

  /** Create a new window, start claude, return window info.
   *  Issue #7: Retries up to 3x on failure, with tmux session health check between retries.
   */
  async createWindow(opts: {
    workDir: string;
    windowName: string;
    claudeCommand?: string;
    resumeSessionId?: string;
    env?: Record<string, string>;
    permissionMode?: string;
    /** Path to a CC settings JSON file (via --settings flag). */
    settingsFile?: string;
    /** @deprecated Use permissionMode instead. Maps true→bypassPermissions, false→default. */
    autoApprove?: boolean;
  }): Promise<{ windowId: string; windowName: string; freshSessionId?: string }> {
    await this.ensureSession();

    // Check for name collision, add suffix if needed
    let finalName = opts.windowName;
    const existing = await this.listWindows();
    const existingNames = new Set(existing.map(w => w.windowName));
    let counter = 2;
    while (existingNames.has(finalName)) {
      finalName = `${opts.windowName}-${counter++}`;
    }

    // Issue #7: Retry window creation up to 3 times.
    // After prolonged uptime, tmux may fail to create windows.
    // Between retries, re-verify the tmux session health.
    const MAX_RETRIES = 3;
    let windowId = '';
    let lastError: Error | null = null;

    // Issue #31: Ensure workDir exists before creating tmux window.
    // If it doesn't exist, tmux uses $HOME and CC starts in wrong directory.
    await mkdir(opts.workDir, { recursive: true });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Create the window
        await this.tmux(
          'new-window', '-t', this.sessionName,
          '-n', finalName,
          '-c', opts.workDir,
          '-d' // don't switch to it
        );

        // Prevent CC from renaming the window
        await this.tmux(
          'set-window-option', '-t', `${this.sessionName}:${finalName}`,
          'allow-rename', 'off'
        );

        // Issue #82: Set pane title to session name (visible in tmux list-panes)
        await this.tmux(
          'select-pane', '-t', `${this.sessionName}:${finalName}`,
          '-T', `aegis:${finalName}`
        );

        // Get the window ID
        const idRaw = await this.tmux(
          'display-message', '-t', `${this.sessionName}:${finalName}`,
          '-p', '#{window_id}'
        );
        windowId = idRaw.trim();

        // Verify the window actually exists after creation
        const verifyWindows = await this.listWindows();
        const created = verifyWindows.find(w => w.windowId === windowId);
        if (!created) {
          throw new Error(`Window ${finalName} (${windowId}) not found after creation`);
        }

        // Success — break out of retry loop
        if (attempt > 1) {
          console.log(`Tmux: window ${finalName} created on attempt ${attempt}`);
        }
        lastError = null;
        break;
      } catch (e) {
        lastError = e as Error;
        console.error(`Tmux: createWindow attempt ${attempt}/${MAX_RETRIES} failed: ${(e as Error).message}`);

        if (attempt < MAX_RETRIES) {
          // Clean up any partial window before retry
          try { await this.tmux('kill-window', '-t', `${this.sessionName}:${finalName}`); } catch { /* may not exist */ }
          // Re-verify tmux session health before retry
          await this.ensureSession();
          // Exponential backoff: 1s, 2s, 4s… capped at 5s
          await sleep(Math.min(500 * Math.pow(2, attempt), 5_000));
        }
      }
    }

    if (lastError) {
      throw new Error(`Failed to create tmux window after ${MAX_RETRIES} attempts: ${finalName} — ${lastError.message}`);
    }

    // Set env vars if provided.
    // Issue #23: Use temp file + source instead of send-keys export to prevent
    // env var values (tokens, secrets) from appearing in tmux pane history.
    if (opts.env && Object.keys(opts.env).length > 0) {
      await this.setEnvSecure(windowId, opts.env);
    }

    // Ensure Claude starts a fresh session.
    // Two-layer defense against CC auto-resuming stale sessions:
    //
    // Layer 1 (primary): --session-id <fresh-uuid>
    //   Forces CC to create a new session with this ID instead of auto-resuming
    //   the latest .jsonl file. This is the reliable fix — no race conditions.
    //
    // Layer 2 (backup): archive old .jsonl files
    //   Moves existing session files to _archived/. Belt-and-suspenders —
    //   even if --session-id somehow fails, there's nothing to resume.
    //
    // History: v1 relied solely on archival, but had a race condition where CC
    // could scan the directory before archival completed, resuming a stale session.
    let freshSessionId: string | undefined;
    if (!opts.resumeSessionId && !opts.claudeCommand) {
      freshSessionId = crypto.randomUUID();
      await this.archiveStaleSessionFiles(opts.workDir);
    }

    // Build the claude command
    let cmd = opts.claudeCommand || 'claude';
    if (opts.resumeSessionId) {
      cmd += ` --resume ${opts.resumeSessionId}`;
    } else if (freshSessionId) {
      cmd += ` --session-id ${freshSessionId}`;
    }

    // Set permission mode
    // Resolve legacy autoApprove boolean to permissionMode string
    const resolvedMode = opts.permissionMode
      ?? (opts.autoApprove === true ? 'bypassPermissions' : opts.autoApprove === false ? 'default' : undefined);
    if (resolvedMode) {
      cmd += ` --permission-mode ${resolvedMode}`;
    }

    // Issue #169 Phase 2: Inject hook settings file if provided.
    // This tells CC to POST hook events to Aegis's HTTP receiver.
    // P0 fix: Always provide --settings to ensure CC loads proxy config
    // (z.ai) and avoids workspace trust dialog in untrusted directories.
    const settingsPath = opts.settingsFile
      ?? join(opts.workDir, '.claude', 'settings.local.json');
    if (existsSync(settingsPath)) {
      cmd += ` --settings ${settingsPath}`;
    }

    // Issue #68: Unset $TMUX and $TMUX_PANE before launching Claude Code.
    // If Aegis itself runs inside tmux, CC inherits these vars and:
    //   - Teammate spawns attempt split-pane in Aegis session (not isolated)
    //   - Color capabilities reduced to 256
    //   - Clipboard passthrough via tmux load-buffer instead of OSC 52
    // Prefixing with 'unset' ensures CC gets a clean environment.
    cmd = `unset TMUX TMUX_PANE && ${cmd}`;

    // Send the command to start Claude
    await this.sendKeys(windowId, cmd, true);

    // Issue #7: Verify Claude process started by checking pane command after a delay.
    // Zeus reported sessions where claude never started — byteOffset stayed 0 forever.
    await sleep(2000);
    try {
      const windows = await this.listWindows();
      const win = windows.find(w => w.windowId === windowId);
      if (win) {
        const paneCmd = win.paneCommand.toLowerCase();
        // After sending 'claude', the pane command should be 'claude' or 'node' (CC runs as node)
        // If it's still 'bash' or 'zsh', Claude didn't start
        if (paneCmd === 'bash' || paneCmd === 'zsh' || paneCmd === 'sh') {
          console.warn(`Tmux: Claude may not have started in ${finalName} — pane command is '${win.paneCommand}', retrying...`);
          // Retry sending the command once
          await this.sendKeys(windowId, cmd, true);
        }
      }
    } catch {
      // Non-fatal: verification failed but session may still work
    }

    return { windowId, windowName: finalName, freshSessionId };
  }

  /**
   * Archive old Claude session files so interactive mode starts fresh.
   *
   * Claude CLI computes a project hash from the workDir path:
   *   /home/user/projects/foo → -home-user-projects-foo
   * and stores sessions at ~/.claude/projects/<hash>/*.jsonl.
   *
   * In interactive mode, Claude always auto-resumes the latest .jsonl file.
   * There is no CLI flag to disable this. The only reliable way to force a
   * fresh session is to move existing .jsonl files out of the way.
   *
   * Files are moved to an `_archived/` subfolder (not deleted), so they can
   * be recovered if needed.
   */
  private async archiveStaleSessionFiles(workDir: string): Promise<void> {
    // Compute the project hash the same way Claude CLI does
    const projectHash = '-' + workDir.replace(/^\//, '').replace(/\//g, '-');
    const projectDir = join(homedir(), '.claude', 'projects', projectHash);

    if (!existsSync(projectDir)) return;

    try {
      const files = await readdir(projectDir);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

      if (jsonlFiles.length === 0) return;

      // Create archive dir
      const archiveDir = join(projectDir, '_archived');
      if (!existsSync(archiveDir)) {
        await mkdir(archiveDir, { recursive: true });
      }

      // Move all .jsonl files to archive
      for (const file of jsonlFiles) {
        const src = join(projectDir, file);
        const dst = join(archiveDir, `${Date.now()}-${file}`);
        await fsRename(src, dst);
      }

      console.log(`Archived ${jsonlFiles.length} stale session file(s) for ${workDir}`);
    } catch (e) {
      // Non-fatal: if archiving fails, Claude may auto-resume but the session still works
      console.warn(`Failed to archive stale sessions for ${workDir}:`, e);
    }
  }

  /** Issue #23: Set env vars securely without exposing values in tmux pane.
   *  Writes vars to a temp file, sources it, then deletes it.
   *  Values never appear in terminal scrollback or capture-pane output.
   */
  private async setEnvSecure(windowId: string, env: Record<string, string>): Promise<void> {
    const crypto = await import('node:crypto');
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');

    // Write env vars to a temp file with restrictive permissions
    const tmpFile = path.join(os.tmpdir(), `.aegis-env-${crypto.randomUUID().slice(0, 8)}`);
    const lines = Object.entries(env).map(([key, val]) => {
      // Escape single quotes in value
      const escaped = val.replace(/'/g, "'\\''");
      return `export ${key}='${escaped}'`;
    });
    await fs.writeFile(tmpFile, lines.join('\n') + '\n', { mode: 0o600 });

    // Source the file and delete it — all in one command so the values
    // appear in the process environment but not in the terminal history.
    // The 'source' line is visible but only shows the temp file path, not the values.
    await this.sendKeys(windowId, `source ${tmpFile} && rm -f ${tmpFile}`, true);
    await sleep(500);

    // Belt and suspenders: delete the file from our side too
    try { await fs.unlink(tmpFile); } catch { /* already deleted by shell */ }
  }

  /** P1 fix: Check if a window exists. Returns true if window is in the session. */
  async windowExists(windowId: string): Promise<boolean> {
    try {
      const windows = await this.listWindows();
      return windows.some(w => w.windowId === windowId);
    } catch (e: unknown) {
      console.warn(`Tmux: windowExists check failed for ${windowId}: ${(e as Error).message}`);
      return false;
    }
  }

  /** Issue #69: Get the PID of the first pane in a window. Returns null on error. */
  async listPanePid(windowId: string): Promise<number | null> {
    try {
      const target = `${this.sessionName}:${windowId}`;
      const raw = await this.tmux('list-panes', '-t', target, '-F', '#{pane_pid}');
      if (!raw) return null;
      const pid = parseInt(raw.split('\n')[0]!, 10);
      return Number.isFinite(pid) ? pid : null;
    } catch (e: unknown) {
      console.warn(`Tmux: listPanePid failed for ${windowId}: ${(e as Error).message}`);
      return null;
    }
  }

  /** Issue #69: Check if a PID is alive using kill -0. */
  isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** Get detailed window info for health checks.
   *  Issue #2: Returns window existence, pane command, and whether Claude is running.
   */
  async getWindowHealth(windowId: string): Promise<{
    windowExists: boolean;
    paneCommand: string | null;
    claudeRunning: boolean;
  }> {
    try {
      const windows = await this.listWindows();
      const win = windows.find(w => w.windowId === windowId);
      if (!win) {
        return { windowExists: false, paneCommand: null, claudeRunning: false };
      }
      const paneCmd = win.paneCommand.toLowerCase();
      // Claude runs as 'claude' or 'node' process
      const claudeRunning = paneCmd === 'claude' || paneCmd === 'node';
      return { windowExists: true, paneCommand: win.paneCommand, claudeRunning };
    } catch (e: unknown) {
      console.warn(`Tmux: getWindowHealth failed for ${windowId}: ${(e as Error).message}`);
      return { windowExists: false, paneCommand: null, claudeRunning: false };
    }
  }

  /** Send text to a window's active pane. */
  async sendKeys(windowId: string, text: string, enter: boolean = true): Promise<void> {
    // P1 fix: Verify window exists before sending keys
    if (!(await this.windowExists(windowId))) {
      throw new Error(`Tmux window ${windowId} does not exist — cannot send keys`);
    }

    const target = `${this.sessionName}:${windowId}`;

    if (enter) {
      // CC's ! command mode: send "!" first so the TUI switches to bash mode,
      // wait 1s, then send the rest.
      if (text.startsWith('!')) {
        await this.tmux('send-keys', '-t', target, '-l', '!');
        const rest = text.slice(1);
        if (rest) {
          await sleep(1000);
          await this.tmux('send-keys', '-t', target, '-l', rest);
        }
      } else {
        // Send text literally first (no Enter)
        await this.tmux('send-keys', '-t', target, '-l', text);
      }
      // P2 fix: Adaptive delay based on message length
      const delay = text.length > 500 ? 2000 : 1000;
      await sleep(delay);
      // Send Enter
      await this.tmux('send-keys', '-t', target, 'Enter');
    } else {
      await this.tmux('send-keys', '-t', target, '-l', text);
    }
  }

  /** Check if a pane state indicates CC has received input (non-idle). */
  private isActiveState(state: string): boolean {
    return state === 'working' || state === 'permission_prompt' ||
      state === 'bash_approval' || state === 'plan_mode' || state === 'ask_question';
  }

  /** Verify that a message was delivered to Claude Code.
   *  Issue #1 v2: Compares pre-send and post-send pane state to detect delivery.
   *
   *  Strategy:
   *  1. If CC transitioned from idle → active state → confirmed
   *  2. If CC is in any active state (working, permission, etc.) → confirmed
   *  3. If sent text (prefix) is visible in the pane → confirmed
   *  4. If CC is still idle with no trace of input → NOT confirmed
   *  5. Unknown state → benefit of the doubt (confirmed)
   *
   *  The `preSendState` parameter enables state-change detection to avoid
   *  false negatives during transitional moments.
   */
  async verifyDelivery(
    windowId: string,
    sentText: string,
    preSendState?: string,
  ): Promise<boolean> {
    const paneText = await this.capturePane(windowId);
    const { detectUIState } = await import('./terminal-parser.js');
    const state = detectUIState(paneText);

    // Evidence 1: CC is in an active state — delivery confirmed
    if (this.isActiveState(state)) {
      return true;
    }

    // Evidence 2: State changed from idle to anything else (even unknown = transitioning)
    if (preSendState === 'idle' && state !== 'idle') {
      return true;
    }

    // Evidence 3: The sent text appears in the pane
    const searchText = sentText.slice(0, 60).trim();
    if (searchText.length >= 5 && paneText.includes(searchText)) {
      return true;
    }

    // Evidence 4: Pane is clearly idle — delivery likely failed
    if (state === 'idle') {
      return false;
    }

    // Unknown state — give benefit of the doubt
    return true;
  }

  /** Send text and verify delivery with retry.
   *  Issue #1 v2: Captures pre-send state and only re-sends if pane is still idle.
   *  Prevents duplicate prompt delivery that plagued v1.
   */
  async sendKeysVerified(
    windowId: string,
    text: string,
    maxAttempts: number = 3,
  ): Promise<{ delivered: boolean; attempts: number }> {
    const { detectUIState } = await import('./terminal-parser.js');

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Capture pane state BEFORE sending
      const prePaneText = await this.capturePane(windowId);
      const preState = detectUIState(prePaneText);

      // Only send if pane is idle (or first attempt).
      // If CC is already active/working, don't re-send — just verify.
      if (attempt === 1 || preState === 'idle') {
        if (attempt > 1) {
          console.log(`Tmux: delivery retry ${attempt}/${maxAttempts} — pane is idle, re-sending`);
        }
        await this.sendKeys(windowId, text, true);
      } else {
        // CC is not idle — it may have received the text but is in transition.
        // Don't re-send (would duplicate the prompt).
        console.log(`Tmux: delivery check ${attempt}/${maxAttempts} — pane is '${preState}', skipping re-send`);
      }

      // Graduated verification: check multiple times with increasing delays.
      // CC needs time to process input and transition states.
      const checkDelays = attempt === 1 ? [800, 1500, 2500] : [500, 1500];
      for (const delay of checkDelays) {
        await sleep(delay);
        const delivered = await this.verifyDelivery(windowId, text, preState);
        if (delivered) {
          if (attempt > 1) {
            console.log(`Tmux: delivery confirmed on attempt ${attempt}`);
          }
          return { delivered: true, attempts: attempt };
        }
      }

      if (attempt < maxAttempts) {
        console.warn(`Tmux: delivery not confirmed for "${text.slice(0, 50)}..." (attempt ${attempt}/${maxAttempts})`);
      }
    }

    console.error(`Tmux: delivery FAILED after ${maxAttempts} attempts for "${text.slice(0, 50)}..."`);
    return { delivered: false, attempts: maxAttempts };
  }

  /** Send a special key (Escape, C-c, etc.) */
  async sendSpecialKey(windowId: string, key: string): Promise<void> {
    const target = `${this.sessionName}:${windowId}`;
    await this.tmux('send-keys', '-t', target, key);
  }

  /** Capture the visible pane content.
   *  Issue #89 L23: Strips DCS passthrough sequences (ESC P ... ESC \\)
   *  that can leak through tmux's capture-pane into the output.
   */
  async capturePane(windowId: string): Promise<string> {
    const target = `${this.sessionName}:${windowId}`;
    const raw = await this.tmux('capture-pane', '-t', target, '-p');
    return raw.replace(/\x1bP[^\x1b]*\x1b\\/g, '');
  }

  /** Capture pane content WITHOUT going through the serialize queue.
   *  Used for critical-path operations (e.g., sendInitialPrompt) that should
   *  not be delayed by monitor polls. The queue is for preventing race conditions
   *  in monitor/concurrent reads, but sendInitialPrompt is the ONLY writer at
   *  session creation time.
   */
  async capturePaneDirect(windowId: string): Promise<string> {
    const target = `${this.sessionName}:${windowId}`;
    try {
      const { stdout } = await execFileAsync('tmux', ['-L', this.socketName, 'capture-pane', '-t', target, '-p'], {
        timeout: TMUX_DEFAULT_TIMEOUT_MS,
      });
      // Issue #89 L23: Strip DCS passthrough sequences
      return stdout.trim().replace(/\x1bP[^\x1b]*\x1b\\/g, '');
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'killed' in e && (e as { killed: boolean }).killed) {
        throw new TmuxTimeoutError(['capture-pane', '-t', target, '-p'], TMUX_DEFAULT_TIMEOUT_MS);
      }
      throw e;
    }
  }

  /** Send keys WITHOUT going through the serialize queue.
   *  Used for critical-path operations (e.g., sendInitialPrompt).
   *  Simplified version: sends literal text + Enter (no ! command mode handling).
   */
  async sendKeysDirect(windowId: string, text: string, enter: boolean = true): Promise<void> {
    const target = `${this.sessionName}:${windowId}`;
    if (enter) {
      await execFileAsync('tmux', ['-L', this.socketName, 'send-keys', '-t', target, '-l', text], {
        timeout: TMUX_DEFAULT_TIMEOUT_MS,
      });
      // Adaptive delay based on message length
      const delay = text.length > 500 ? 2000 : 1000;
      await new Promise(r => setTimeout(r, delay));
      await execFileAsync('tmux', ['-L', this.socketName, 'send-keys', '-t', target, 'Enter'], {
        timeout: TMUX_DEFAULT_TIMEOUT_MS,
      });
    } else {
      await execFileAsync('tmux', ['-L', this.socketName, 'send-keys', '-t', target, '-l', text], {
        timeout: TMUX_DEFAULT_TIMEOUT_MS,
      });
    }
  }

  /** Kill a window. */
  async killWindow(windowId: string): Promise<void> {
    const target = `${this.sessionName}:${windowId}`;
    try {
      await this.tmux('kill-window', '-t', target);
    } catch (e: unknown) {
      console.warn(`Tmux: killWindow failed for ${target}: ${(e as Error).message}`);
    }
  }

  /** Kill the entire tmux session. Used for cleanup on shutdown. */
  async killSession(sessionName?: string): Promise<void> {
    const target = sessionName ?? this.sessionName;
    try {
      await this.tmux('kill-session', '-t', target);
      console.log(`Tmux: session '${target}' killed`);
    } catch (e: unknown) {
      console.warn(`Tmux: killSession failed for '${target}': ${(e as Error).message}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
