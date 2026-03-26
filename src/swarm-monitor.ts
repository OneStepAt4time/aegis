/**
 * swarm-monitor.ts — Monitors Claude Code swarm sockets for teammate sessions.
 *
 * Issue #81: Agent Swarm Awareness.
 *
 * When CC spawns teammates/subagents, it creates them in tmux with:
 *   - Socket: -L claude-swarm-{pid} (isolated from main session)
 *   - Window naming: teammate-{name}
 *   - Env vars: CLAUDE_PARENT_SESSION_ID, --agent-id, --agent-name
 *
 * This module discovers those swarm sockets, lists their windows,
 * cross-references with parent sessions, and tracks teammate status.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SessionManager, SessionInfo } from './session.js';

const execFileAsync = promisify(execFile);

const TMUX_TIMEOUT_MS = 5_000;

/** Information about a single teammate window in a swarm socket. */
export interface TeammateInfo {
  /** Window ID (e.g. "@0") */
  windowId: string;
  /** Window name (e.g. "teammate-explore-agent") */
  windowName: string;
  /** Working directory of the teammate */
  cwd: string;
  /** Current process running in the pane */
  paneCommand: string;
  /** Whether the teammate process is alive (claude/node running) */
  alive: boolean;
  /** Inferred status from pane command */
  status: 'running' | 'idle' | 'dead';
}

/** A detected swarm (parent + its teammates). */
export interface SwarmInfo {
  /** Socket name (e.g. "claude-swarm-12345") */
  socketName: string;
  /** PID extracted from socket name */
  pid: number;
  /** The parent Aegis session, if found */
  parentSession: SessionInfo | null;
  /** Detected teammate windows */
  teammates: TeammateInfo[];
  /** Aggregated swarm status */
  aggregatedStatus: 'all_idle' | 'some_working' | 'all_dead' | 'no_teammates';
  /** When this swarm was last scanned */
  lastScannedAt: number;
}

/** Result of scanning all swarm sockets. */
export interface SwarmScanResult {
  swarms: SwarmInfo[];
  totalSockets: number;
  totalTeammates: number;
  scannedAt: number;
}

export interface SwarmMonitorConfig {
  /** How often to scan for swarm sockets (default: 10s) */
  scanIntervalMs: number;
  /** Glob pattern for swarm socket directories */
  socketGlobPattern: string;
}

export const DEFAULT_SWARM_CONFIG: SwarmMonitorConfig = {
  scanIntervalMs: 10_000,
  socketGlobPattern: 'tmux-claude-swarm-*',
};

export class SwarmMonitor {
  private running = false;
  private lastResult: SwarmScanResult | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private sessions: SessionManager,
    private config: SwarmMonitorConfig = DEFAULT_SWARM_CONFIG,
  ) {}

  /** Start the periodic scan loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.scan();
    this.timer = setInterval(() => {
      void this.scan();
    }, this.config.scanIntervalMs);
  }

  /** Stop the periodic scan loop. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Get the most recent scan result. */
  getLastResult(): SwarmScanResult | null {
    return this.lastResult;
  }

  /** Run a single scan and return the result. */
  async scan(): Promise<SwarmScanResult> {
    const sockets = await this.discoverSwarmSockets();
    const swarms: SwarmInfo[] = [];

    for (const socketName of sockets) {
      const swarm = await this.inspectSwarmSocket(socketName);
      swarms.push(swarm);
    }

    this.lastResult = {
      swarms,
      totalSockets: sockets.length,
      totalTeammates: swarms.reduce((sum, s) => sum + s.teammates.length, 0),
      scannedAt: Date.now(),
    };

    return this.lastResult;
  }

  /** Discover swarm socket directories in /tmp. */
  private async discoverSwarmSockets(): Promise<string[]> {
    try {
      const entries = await readdir(tmpdir());
      const pattern = this.config.socketGlobPattern.replace('tmux-', '');
      // Match "tmux-<socketName>" directories (tmux socket dirs start with "tmux-")
      const socketNames: string[] = [];
      for (const entry of entries) {
        if (entry.startsWith('tmux-') && entry.includes(pattern)) {
          // Extract socket name: tmux-<socketName> → <socketName>
          const socketName = entry.slice(5); // remove "tmux-"
          // Verify it's a claude-swarm-* socket
          if (socketName.startsWith('claude-swarm-')) {
            socketNames.push(socketName);
          }
        }
      }
      return socketNames;
    } catch {
      return [];
    }
  }

  /** Inspect a single swarm socket and return swarm info. */
  async inspectSwarmSocket(socketName: string): Promise<SwarmInfo> {
    const pid = this.extractPid(socketName);
    const teammates = await this.listSwarmWindows(socketName);
    const parentSession = this.findParentSession(pid, teammates);
    const aggregatedStatus = this.computeAggregatedStatus(teammates);

    return {
      socketName,
      pid,
      parentSession,
      teammates,
      aggregatedStatus,
      lastScannedAt: Date.now(),
    };
  }

  /** Extract PID from socket name "claude-swarm-{pid}". */
  private extractPid(socketName: string): number {
    const match = socketName.match(/^claude-swarm-(\d+)$/);
    return match ? parseInt(match[1]!, 10) : 0;
  }

  /** List all windows in a swarm socket. */
  private async listSwarmWindows(socketName: string): Promise<TeammateInfo[]> {
    try {
      const { stdout } = await execFileAsync(
        'tmux',
        ['-L', socketName, 'list-windows', '-F', '#{window_id}\t#{window_name}\t#{pane_current_path}\t#{pane_current_command}'],
        { timeout: TMUX_TIMEOUT_MS },
      );
      const raw = stdout.trim();
      if (!raw) return [];

      return raw.split('\n').filter(Boolean).map(line => {
        const [windowId, windowName, cwd, paneCommand] = line.split('\t');
        const cmd = (paneCommand || '').toLowerCase();
        const alive = cmd === 'claude' || cmd === 'node';
        const status = alive
          ? 'running' as const
          : (paneCommand === '' || paneCommand === 'bash' || paneCommand === 'zsh')
            ? 'idle' as const
            : 'dead' as const;

        return {
          windowId: windowId || '',
          windowName: windowName || '',
          cwd: cwd || '',
          paneCommand: paneCommand || '',
          alive,
          status,
        };
      });
    } catch {
      // Socket may be stale (parent process died)
      return [];
    }
  }

  /** Find the parent Aegis session for a swarm. */
  private findParentSession(pid: number, _teammates: TeammateInfo[]): SessionInfo | null {
    if (pid === 0) return null;

    // Strategy 1: Match by PID — look for a session whose CC process has this PID
    // The swarm socket name contains the PID of the parent CC process
    for (const session of this.sessions.listSessions()) {
      // We can't directly check PIDs from SessionInfo, so match by checking
      // if any session has active subagents (suggesting it's a swarm parent)
      if (session.activeSubagents && session.activeSubagents.length > 0) {
        // Best-effort: return the first session with active subagents
        // A more precise approach would require PID tracking
        return session;
      }
    }

    return null;
  }

  /** Compute aggregated status for a swarm. */
  private computeAggregatedStatus(teammates: TeammateInfo[]): SwarmInfo['aggregatedStatus'] {
    if (teammates.length === 0) return 'no_teammates';

    const allDead = teammates.every(t => t.status === 'dead');
    if (allDead) return 'all_dead';

    const anyWorking = teammates.some(t => t.status === 'running');
    if (anyWorking) return 'some_working';

    return 'all_idle';
  }

  /** Find a specific swarm by parent session ID. */
  findSwarmByParentSessionId(sessionId: string): SwarmInfo | null {
    if (!this.lastResult) return null;
    return this.lastResult.swarms.find(s => s.parentSession?.id === sessionId) ?? null;
  }

  /** Find all swarms associated with any active session. */
  findActiveSwarms(): SwarmInfo[] {
    if (!this.lastResult) return [];
    return this.lastResult.swarms.filter(s => s.parentSession !== null && s.teammates.length > 0);
  }
}
