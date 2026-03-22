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

export interface TmuxWindow {
  windowId: string;      // e.g. "@0", "@12"
  windowName: string;
  cwd: string;
  paneCommand: string;   // current process in active pane
}

export class TmuxManager {
  constructor(private sessionName: string = 'manus') {}

  /** Run a tmux command and return stdout. */
  private async tmux(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('tmux', args);
    return stdout.trim();
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
    } catch {
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
  }): Promise<{ windowId: string; windowName: string }> {
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
          await sleep(500 * attempt); // Backoff: 500ms, 1000ms
        }
      }
    }

    if (lastError) {
      throw new Error(`Failed to create tmux window after ${MAX_RETRIES} attempts: ${finalName} — ${lastError.message}`);
    }

    // Set env vars if provided
    if (opts.env) {
      for (const [key, val] of Object.entries(opts.env)) {
        await this.sendKeys(windowId, `export ${key}="${val}"`, true);
        // Small delay between exports
        await sleep(100);
      }
    }

    // Ensure Claude starts a fresh session by archiving old JSONL files.
    // Claude CLI interactive mode always auto-resumes the latest session in
    // ~/.claude/projects/<project-hash>/. There is NO flag to disable this.
    // --session-id only sets the save ID but still loads the old context.
    // The only reliable fix: move old .jsonl files out of the way before spawn.
    if (!opts.resumeSessionId && !opts.claudeCommand) {
      await this.archiveStaleSessionFiles(opts.workDir);
    }

    // Build the claude command
    let cmd = opts.claudeCommand || 'claude';
    if (opts.resumeSessionId) {
      cmd += ` --resume ${opts.resumeSessionId}`;
    }

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

    return { windowId, windowName: finalName };
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

  /** P1 fix: Check if a window exists. Returns true if window is in the session. */
  async windowExists(windowId: string): Promise<boolean> {
    try {
      const windows = await this.listWindows();
      return windows.some(w => w.windowId === windowId);
    } catch {
      return false;
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

  /** Verify that a message was delivered to Claude Code.
   *  Issue #1: ~20% of prompts don't arrive due to tmux send-keys being fire-and-forget.
   *
   *  Strategy: after sending text + Enter, capture the pane and check for evidence
   *  that CC received the input. Evidence includes:
   *  1. The sent text (or a significant prefix) visible in the pane
   *  2. CC transitioning from idle to working (spinner visible, prompt gone)
   *  3. A status line showing CC is processing
   *
   *  Returns true if delivery is confirmed, false if we can't confirm.
   */
  async verifyDelivery(windowId: string, sentText: string): Promise<boolean> {
    const paneText = await this.capturePane(windowId);

    // Evidence 1: CC is now working (spinner or status line visible, no idle prompt)
    // Import inline to avoid circular dependency issues
    const { detectUIState } = await import('./terminal-parser.js');
    const state = detectUIState(paneText);
    if (state === 'working') {
      return true; // CC is processing — delivery confirmed
    }

    // Evidence 2: CC is asking a question or showing permission prompt
    // (means it already processed input and is acting on it)
    if (state === 'permission_prompt' || state === 'bash_approval' || state === 'plan_mode' || state === 'ask_question') {
      return true;
    }

    // Evidence 3: The sent text appears in the pane
    // Use a significant prefix (first 40 chars) to match — CC may have reformatted
    const searchText = sentText.slice(0, 40).trim();
    if (searchText.length >= 5 && paneText.includes(searchText)) {
      return true;
    }

    // Evidence 4: Pane is NOT idle (unknown state could mean CC is loading/processing)
    // Only return false if pane is clearly idle — the ❯ prompt is visible
    if (state === 'idle') {
      return false; // Pane is idle with no trace of input — delivery failed
    }

    // Unknown state — give benefit of the doubt
    return true;
  }

  /** Send text and verify delivery with retry.
   *  Issue #1: Returns delivery status for API response.
   */
  async sendKeysVerified(
    windowId: string,
    text: string,
    maxAttempts: number = 3,
  ): Promise<{ delivered: boolean; attempts: number }> {
    const delays = [500, 1500, 3000]; // Exponential-ish backoff for verification checks

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Send the text
      if (attempt > 1) {
        console.log(`Tmux: delivery retry ${attempt}/${maxAttempts} for ${text.slice(0, 50)}...`);
      }
      await this.sendKeys(windowId, text, true);

      // Wait before checking delivery
      const checkDelay = delays[attempt - 1] || 3000;
      await sleep(checkDelay);

      // Verify delivery
      const delivered = await this.verifyDelivery(windowId, text);
      if (delivered) {
        return { delivered: true, attempts: attempt };
      }

      // Not delivered — if we have more attempts, the next sendKeys call will resend
      if (attempt < maxAttempts) {
        console.warn(`Tmux: delivery not confirmed for ${text.slice(0, 50)}... (attempt ${attempt})`);
        // Small delay before retry
        await sleep(500);
      }
    }

    console.error(`Tmux: delivery FAILED after ${maxAttempts} attempts for ${text.slice(0, 50)}...`);
    return { delivered: false, attempts: maxAttempts };
  }

  /** Send a special key (Escape, C-c, etc.) */
  async sendSpecialKey(windowId: string, key: string): Promise<void> {
    const target = `${this.sessionName}:${windowId}`;
    await this.tmux('send-keys', '-t', target, key);
  }

  /** Capture the visible pane content. */
  async capturePane(windowId: string): Promise<string> {
    const target = `${this.sessionName}:${windowId}`;
    return this.tmux('capture-pane', '-t', target, '-p');
  }

  /** Kill a window. */
  async killWindow(windowId: string): Promise<void> {
    try {
      const target = `${this.sessionName}:${windowId}`;
      await this.tmux('kill-window', '-t', target);
    } catch {
      // Window may already be gone
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
