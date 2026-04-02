/**
 * tmux.ts — Low-level tmux interaction layer.
 * 
 * Wraps tmux CLI commands to manage windows inside a named session.
 * Port of CCBot's tmux_manager.py to TypeScript.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, rename as fsRename, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

/** Shell-escape a string by wrapping in single quotes and escaping embedded single quotes. */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Validate that an env var key contains only safe characters. */
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

  /** #357: Cache for window existence checks — avoids repeated tmux CLI calls. */
  private windowExistsCache = new Map<string, { exists: boolean; timestamp: number }>();
  private static readonly WINDOW_CACHE_TTL_MS = 2_000;

  constructor(private sessionName: string = 'aegis', socketName?: string) {
    this.socketName = socketName ?? `aegis-${process.pid}`;
  }

  /** Promise-chain queue that serializes all tmux CLI calls to prevent race conditions. */
  private queue: Promise<void> = Promise.resolve();

  /** #403: Counter of in-flight createWindow calls — direct methods must queue when > 0. */
  private _creatingCount = 0;

  /** #357: Short-lived cache for window existence checks to reduce CLI calls. */
  private windowCache = new Map<string, { exists: boolean; timestamp: number }>();

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
    return this.ensureSessionInternal();
  }

  /** #403: Internal version that calls tmuxInternal directly (safe inside serialize). */
  private async ensureSessionInternal(): Promise<void> {
    try {
      await this.tmuxInternal('has-session', '-t', this.sessionName);
      // Session exists — verify it's healthy by listing windows
      await this.tmuxInternal('list-windows', '-t', this.sessionName, '-F', '#{window_id}');
    } catch { /* session missing or unhealthy — (re)create below */
      // Session doesn't exist or is unhealthy — (re)create it.
      // KillMode=process in the systemd service ensures only the node server
      // is killed on restart, not tmux or Claude Code processes inside.
      try {
        // Kill the broken session first if it exists
        await this.tmuxInternal('kill-session', '-t', this.sessionName);
      } catch { /* session may not exist */ }
      await this.tmuxInternal(
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
    // #403: Wrap the entire ensureSession + mkdir + name check + window creation
    // in a single serialize() scope so concurrent createWindow calls cannot
    // interleave between the name availability check and window creation.
    // Previous fix (#363) only wrapped name-check+creation but left ensureSession
    // and mkdir outside — the gap between ensureSession completing and the
    // serialize block entering allowed concurrent calls to interleave.
    this._creatingCount++;
    let windowId = '';
    let finalName = '';

    try {
      const creationResult = await this.serialize(async () => {
        // #403: ensureSession and mkdir inside serialize so the whole
        // sequence is atomic with respect to other createWindow calls.
        // Uses ensureSessionInternal (tmuxInternal) to avoid re-entering serialize.
        await this.ensureSessionInternal();

        // Issue #31: Ensure workDir exists before creating tmux window.
        // If it doesn't exist, tmux uses $HOME and CC starts in wrong directory.
        await mkdir(opts.workDir, { recursive: true });

        // Check for name collision, add suffix if needed
        let name = opts.windowName;
        // #393 fix: use tmuxInternal directly (not listWindows) to avoid
        // re-entering serialize() from inside a serialize() callback → deadlock.
        const rawWindows = await this.tmuxInternal(
          'list-windows', '-t', this.sessionName,
          '-F', '#{window_id}\t#{window_name}\t#{pane_current_path}\t#{pane_current_command}'
        );
        const existing = (rawWindows ?? '').split('\n').filter(Boolean).map(line => {
          const [windowId, windowName, cwd, paneCommand] = line.split('\t');
          return { windowId, windowName, cwd, paneCommand };
        }).filter((w: { windowName: string }) => w.windowName !== '_bridge_main');
        const existingNames = new Set(existing.map(w => w.windowName));
        let counter = 2;
        while (existingNames.has(name)) {
          name = `${opts.windowName}-${counter++}`;
        }

        // Issue #7: Retry window creation up to 3 times.
        const MAX_RETRIES = 3;
        let id = '';
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            // Create the window
            await this.tmuxInternal(
              'new-window', '-t', this.sessionName,
              '-n', name,
              '-c', opts.workDir,
              '-d',
            );

            // Prevent CC from renaming the window
            await this.tmuxInternal(
              'set-window-option', '-t', `${this.sessionName}:${name}`,
              'allow-rename', 'off',
            );

            // Issue #82: Set pane title to session name
            await this.tmuxInternal(
              'select-pane', '-t', `${this.sessionName}:${name}`,
              '-T', `aegis:${name}`,
            );

            // Get the window ID
            const idRaw = await this.tmuxInternal(
              'display-message', '-t', `${this.sessionName}:${name}`,
              '-p', '#{window_id}',
            );
            id = idRaw.trim();

            // Verify the window actually exists after creation
            const verifyRaw = await this.tmuxInternal(
              'list-windows', '-t', this.sessionName,
              '-F', '#{window_id}\t#{window_name}\t#{pane_current_path}\t#{pane_current_command}',
            );
            const verified = verifyRaw.split('\n').filter(Boolean).some(line => {
              const [wid] = line.split('\t');
              return wid === id;
            });
            if (!verified) {
              throw new Error(`Window ${name} (${id}) not found after creation`);
            }

            if (attempt > 1) {
              console.log(`Tmux: window ${name} created on attempt ${attempt}`);
            }
            lastError = null;
            break;
          } catch (e) {
            lastError = e as Error;
            console.error(`Tmux: createWindow attempt ${attempt}/${MAX_RETRIES} failed: ${(e as Error).message}`);

            if (attempt < MAX_RETRIES) {
              try { await this.tmuxInternal('kill-window', '-t', `${this.sessionName}:${name}`); } catch { /* may not exist */ }
              // Re-check session health inside the serialize scope
              try {
                await this.tmuxInternal('has-session', '-t', this.sessionName);
              } catch { /* session lost — recreate */
                try { await this.tmuxInternal('kill-session', '-t', this.sessionName); } catch { /* may not exist */ }
                await this.tmuxInternal(
                  'new-session', '-d', '-s', this.sessionName,
                  '-n', '_bridge_main', '-x', '220', '-y', '50',
                );
              }
              await sleep(Math.min(500 * Math.pow(2, attempt), 5_000));
            }
          }
        }

        if (lastError) {
          throw new Error(`Failed to create tmux window after ${MAX_RETRIES} attempts: ${name} — ${lastError.message}`);
        }

        // #837: Set env vars INSIDE the serialize block to prevent race.
        // Previously setEnvSecure ran after serialize() returned, so concurrent
        // createWindow calls could interleave send-keys between window creation
        // and env injection, corrupting the environment.
        // Uses setEnvSecureDirect (sendKeysDirectInternal) to avoid re-entering
        // serialize from within an active serialize callback.
        if (opts.env && Object.keys(opts.env).length > 0) {
          await this.setEnvSecureDirect(id, opts.env);
        }

        return { windowId: id, windowName: name };
      });

      windowId = creationResult.windowId;
      finalName = creationResult.windowName;
    } finally {
      this._creatingCount--;
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

    // Issue #89 L27: Warn when autoApprove is redundant with bypassPermissions.
    // When permissionMode is already bypassPermissions, the autoApprove flag has
    // no additional effect — both tell CC to skip all permission prompts.
    if (opts.permissionMode === 'bypassPermissions' && opts.autoApprove === true) {
      console.warn('Tmux: autoApprove=true is redundant with permissionMode=bypassPermissions — autoApprove has no additional effect');
    }

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
      cmd += ` --settings ${shellEscape(settingsPath)}`;
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

    // Issue #7: Verify Claude process started by checking pane command.
    // #357: Poll for pane command change instead of fixed 2s sleep.
    // Zeus reported sessions where claude never started — byteOffset stayed 0 forever.
    const CLAUDE_START_POLL_MS = 200;
    const CLAUDE_START_TIMEOUT_MS = 3000;
    const started = await this.pollUntil(
      async () => {
        try {
          const windows = await this.listWindows();
          const win = windows.find(w => w.windowId === windowId);
          if (!win) return false;
          const paneCmd = win.paneCommand.toLowerCase();
          return paneCmd !== 'bash' && paneCmd !== 'zsh' && paneCmd !== 'sh';
        } catch { return false; }
      },
      CLAUDE_START_POLL_MS,
      CLAUDE_START_TIMEOUT_MS,
    );
    if (!started) {
      console.warn(`Tmux: Claude may not have started in ${finalName} — retrying...`);
      try { await this.sendKeys(windowId, cmd, true); } catch { /* best effort */ }
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
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    // Validate env var keys before interpolation
    for (const key of Object.keys(env)) {
      if (!ENV_KEY_RE.test(key)) {
        throw new Error(`Invalid env var key: '${key}' — must match ${ENV_KEY_RE.source}`);
      }
    }

    // Write env vars to a temp file with restrictive permissions.
    // Use crypto.randomBytes for unpredictable path (not UUID slice).
    const tmpFile = path.join(tmpdir(), `.aegis-env-${randomBytes(16).toString('hex')}`);
    const lines = Object.entries(env).map(([key, val]) => {
      // Escape single quotes in value
      const escaped = val.replace(/'/g, "'\\''");
      return `export ${key}='${escaped}'`;
    });
    await fs.writeFile(tmpFile, lines.join('\n') + '\n', { mode: 0o600 });

    // Source the file and delete it — all in one command so the values
    // appear in the process environment but not in the terminal history.
    // The 'source' line is visible but only shows the temp file path, not the values.
    await this.sendKeys(windowId, `source ${shellEscape(tmpFile)} && rm -f ${shellEscape(tmpFile)}`, true);
    // #357: Brief poll for shell to process the source command (was fixed 500ms sleep)
    await this.pollUntil(
      async () => { try { await stat(tmpFile); return false; } catch { return true; } },
      50, 500,
    );

    // Belt and suspenders: delete the file from our side too
    try { await fs.unlink(tmpFile); } catch { /* already deleted by shell */ }
  }

  /** #837: Direct variant of setEnvSecure that uses sendKeysDirectInternal instead of
   *  sendKeys, safe to call from inside a serialize() callback without deadlocking.
   *  Identical logic otherwise. */
  private async setEnvSecureDirect(windowId: string, env: Record<string, string>): Promise<void> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    for (const key of Object.keys(env)) {
      if (!ENV_KEY_RE.test(key)) {
        throw new Error(`Invalid env var key: '${key}' — must match ${ENV_KEY_RE.source}`);
      }
    }

    const tmpFile = path.join(tmpdir(), `.aegis-env-${randomBytes(16).toString('hex')}`);
    const lines = Object.entries(env).map(([key, val]) => {
      const escaped = val.replace(/'/g, "'\\''");
      return `export ${key}='${escaped}'`;
    });
    await fs.writeFile(tmpFile, lines.join('\n') + '\n', { mode: 0o600 });

    // Use sendKeysDirectInternal to avoid re-entering serialize()
    const cmd = `source ${shellEscape(tmpFile)} && rm -f ${shellEscape(tmpFile)}`;
    await this.sendKeysDirectInternal(windowId, cmd, true);
    await this.pollUntil(
      async () => { try { await stat(tmpFile); return false; } catch { return true; } },
      50, 500,
    );

    try { await fs.unlink(tmpFile); } catch { /* already deleted by shell */ }
  }

  /** P1 fix: Check if a window exists. Returns true if window is in the session.
   *  #357: Uses a short-lived cache to avoid repeated tmux CLI calls. */
  async windowExists(windowId: string): Promise<boolean> {
    const now = Date.now();
    const cached = this.windowCache.get(windowId);
    if (cached && now - cached.timestamp < TmuxManager.WINDOW_CACHE_TTL_MS) {
      return cached.exists;
    }
    try {
      const windows = await this.listWindows();
      const exists = windows.some(w => w.windowId === windowId);
      this.windowCache.set(windowId, { exists, timestamp: now });
      return exists;
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
    } catch { /* ESRCH — process does not exist */
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
      // then send the rest after TUI acknowledges the mode switch.
      if (text.startsWith('!')) {
        await this.tmux('send-keys', '-t', target, '-l', '!');
        const rest = text.slice(1);
        if (rest) {
          // #357: Poll for `!` to be absorbed instead of fixed 1s sleep
          await this.pollUntil(
            async () => {
              try {
                const pane = await this.capturePaneDirect(windowId);
                return pane.includes('!');
              } catch { return false; }
            },
            100, 1000,
          );
          await this.tmux('send-keys', '-t', target, '-l', rest);
        }
      } else {
        // Send text literally first (no Enter)
        await this.tmux('send-keys', '-t', target, '-l', text);
      }
      // P2 fix: Short delay for tmux to register text before Enter
      // #357: Reduced from 1000/2000ms to 200/500ms
      const delay = text.length > 500 ? 500 : 200;
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

      // #357: Poll for delivery confirmation instead of graduated fixed sleeps.
      // CC needs time to process input and transition states.
      const pollInterval = 400;
      const pollTimeout = attempt === 1 ? 5000 : 3000;
      const delivered = await this.pollUntil(
        () => this.verifyDelivery(windowId, text, preState),
        pollInterval,
        pollTimeout,
      );
      if (delivered) {
        if (attempt > 1) {
          console.log(`Tmux: delivery confirmed on attempt ${attempt}`);
        }
        return { delivered: true, attempts: attempt };
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
    return raw.replace(/\x1bP[\s\S]*?\x1b\\/g, '');
  }

  /** Capture pane content through the serialize queue.
   *  #824: Always serialize to prevent race conditions with concurrent reads
   *  from monitor polls and ! command mode. The previous _creatingCount guard
   *  only queued during window creation, leaving a race window at other times.
   */
  async capturePaneDirect(windowId: string): Promise<string> {
    return this.serialize(() => this.capturePaneDirectInternal(windowId));
  }

  private async capturePaneDirectInternal(windowId: string): Promise<string> {
    const target = `${this.sessionName}:${windowId}`;
    try {
      const { stdout } = await execFileAsync('tmux', ['-L', this.socketName, 'capture-pane', '-t', target, '-p'], {
        timeout: TMUX_DEFAULT_TIMEOUT_MS,
      });
      // Issue #89 L23: Strip DCS passthrough sequences
      return stdout.trim().replace(/\x1bP[\s\S]*?\x1b\\/g, '');
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'killed' in e && (e as { killed: boolean }).killed) {
        throw new TmuxTimeoutError(['capture-pane', '-t', target, '-p'], TMUX_DEFAULT_TIMEOUT_MS);
      }
      // Issue #845: Handle tmux server crash (ECONNREFUSED) gracefully.
      // Return empty string instead of crashing the request handler.
      if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'ECONNREFUSED') {
        return '';
      }
      throw e;
    }
  }

  /** Send keys WITHOUT going through the serialize queue.
   *  Used for critical-path operations (e.g., sendInitialPrompt).
   *  Simplified version: sends literal text + Enter (no ! command mode handling).
   *  #403: During window creation (_creatingCount > 0), queues behind serialize
   *  to avoid racing with the creation sequence.
   */
  async sendKeysDirect(windowId: string, text: string, enter: boolean = true): Promise<void> {
    if (this._creatingCount > 0) {
      return this.serialize(() => this.sendKeysDirectInternal(windowId, text, enter));
    }
    return this.sendKeysDirectInternal(windowId, text, enter);
  }

  private async sendKeysDirectInternal(windowId: string, text: string, enter: boolean = true): Promise<void> {
    const target = `${this.sessionName}:${windowId}`;
    if (enter) {
      await execFileAsync('tmux', ['-L', this.socketName, 'send-keys', '-t', target, '-l', text], {
        timeout: TMUX_DEFAULT_TIMEOUT_MS,
      });
      // #357: Reduced adaptive delay (was 1000/2000ms)
      const delay = text.length > 500 ? 500 : 200;
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

  /** Resize a window's pane to the given dimensions. */
  async resizePane(windowId: string, cols: number, rows: number): Promise<void> {
    const target = `${this.sessionName}:${windowId}`;
    await this.tmux('resize-pane', '-t', target, '-x', String(cols), '-y', String(rows));
  }

  /** Kill a window. */
  async killWindow(windowId: string): Promise<void> {
    const target = `${this.sessionName}:${windowId}`;
    this.windowCache.delete(windowId);
    try {
      await this.tmux('kill-window', '-t', target);
    } catch (e: unknown) {
      console.warn(`Tmux: killWindow failed for ${target}: ${(e as Error).message}`);
    }
  }

  /** Issue #397: Check if the tmux server is reachable and healthy.
   *  Returns { healthy, error } — does not throw. */
  async isServerHealthy(): Promise<{ healthy: boolean; error: string | null }> {
    try {
      await this.tmuxInternal('list-sessions');
      return { healthy: true, error: null };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { healthy: false, error: msg };
    }
  }

  /** Issue #397: Check if a tmux error indicates the server crashed (vs window-not-found).
   *  Server crash errors contain specific patterns from tmux CLI. */
  isTmuxServerError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    // "no server running" = tmux server not started
    // "failed to connect to server" = socket/protocol error
    // "connection refused" = server died mid-operation
    return msg.includes('no server running')
      || msg.includes('failed to connect')
      || msg.includes('connection refused')
      || msg.includes('no tmux server');
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

  /** #357: Poll until condition returns true or timeout elapses. */
  private async pollUntil(
    condition: () => Promise<boolean>,
    intervalMs: number,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) return true;
      await sleep(intervalMs);
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
