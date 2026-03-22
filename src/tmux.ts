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

  /** Ensure our tmux session exists. */
  async ensureSession(): Promise<void> {
    try {
      await this.tmux('has-session', '-t', this.sessionName);
    } catch {
      // Session doesn't exist — create it.
      // KillMode=process in the systemd service ensures only the node server
      // is killed on restart, not tmux or Claude Code processes inside.
      await this.tmux(
        'new-session', '-d', '-s', this.sessionName,
        '-n', '_bridge_main',
        '-x', '220', '-y', '50'
      );
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

  /** Create a new window, start claude, return window info. */
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
    const windowId = idRaw.trim();

    // P1 fix: Verify the window actually exists after creation.
    // After prolonged uptime, tmux may fail to create windows properly.
    const verifyWindows = await this.listWindows();
    const created = verifyWindows.find(w => w.windowId === windowId);
    if (!created) {
      throw new Error(`Failed to create tmux window: ${finalName} (windowId ${windowId} not found after creation)`);
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

    // Send the command
    await this.sendKeys(windowId, cmd, true);

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
