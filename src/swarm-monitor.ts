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

/** Events emitted by SwarmMonitor when teammate state changes. */
export type SwarmEvent =
  | { type: 'teammate_spawned'; swarm: SwarmInfo; teammate: TeammateInfo }
  | { type: 'teammate_finished'; swarm: SwarmInfo; teammate: TeammateInfo };

/** Callback for swarm events. */
export type SwarmEventHandler = (event: SwarmEvent) => void;

export class SwarmMonitor {
  private running = false;
  private lastResult: SwarmScanResult | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private eventHandlers: SwarmEventHandler[] = [];

  constructor(
    private sessions: SessionManager,
    private config: SwarmMonitorConfig = DEFAULT_SWARM_CONFIG,
  ) {}

  /** Register an event handler for teammate lifecycle events. */
  onEvent(handler: SwarmEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emitEvent(event: SwarmEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (e) {
        console.error('SwarmMonitor event handler error:', e);
      }
    }
  }

  /** Start the periodic scan loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.scan();
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
    try {
      const sockets = await this.discoverSwarmSockets();

      // Issue #353: Inspect sockets in parallel to avoid N×timeout accumulation.
      const results = await Promise.allSettled(
        sockets.map(socketName => this.inspectSwarmSocket(socketName)),
      );

      const swarms: SwarmInfo[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          swarms.push(result.value);
        }
      }

      this.lastResult = {
        swarms,
        totalSockets: sockets.length,
        totalTeammates: swarms.reduce((sum, s) => sum + s.teammates.length, 0),
        scannedAt: Date.now(),
      };

      this.detectChanges();
      return this.lastResult;
    } catch (e) {
      // Issue #353: Prevent unhandled rejection from setInterval fire-and-forget.
      console.error('SwarmMonitor scan error:', e);
      return this.lastResult ?? {
        swarms: [],
        totalSockets: 0,
        totalTeammates: 0,
        scannedAt: Date.now(),
      };
    }
  }

  /** Compare current scan result against previous to detect teammate changes. */
  private detectChanges(): void {
    if (!this.lastResult) return;

    for (const swarm of this.lastResult.swarms) {
      // Issue #353: Always update previous snapshot, even without a parent session,
      // to prevent repeated spawn events on every scan cycle.
      const prevSwarm = this.previousTeammates.get(swarm.socketName);
      this.previousTeammates.set(swarm.socketName, swarm.teammates.map(t => ({ ...t })));

      if (!swarm.parentSession) continue;

      const prevNames = new Set(prevSwarm?.map(t => t.windowName) ?? []);

      // New teammates
      for (const teammate of swarm.teammates) {
        if (!prevNames.has(teammate.windowName) && teammate.status !== 'dead') {
          this.emitEvent({ type: 'teammate_spawned', swarm, teammate });
        }
      }

      // Finished teammates (previously seen, now dead)
      if (prevSwarm) {
        for (const prev of prevSwarm) {
          const current = swarm.teammates.find(t => t.windowName === prev.windowName);
          if (!current) {
            // Teammate window gone entirely
            this.emitEvent({ type: 'teammate_finished', swarm, teammate: { ...prev, status: 'dead', alive: false } });
          } else if (prev.status === 'running' && current.status === 'dead') {
            this.emitEvent({ type: 'teammate_finished', swarm, teammate: current });
          }
        }
      }
    }

    // Clean up stale socket tracking
    for (const socketName of this.previousTeammates.keys()) {
      if (!this.lastResult.swarms.find(s => s.socketName === socketName)) {
        this.previousTeammates.delete(socketName);
      }
    }
  }

  /** Snapshot of teammates from previous scan for diffing. */
  private previousTeammates = new Map<string, TeammateInfo[]>();

  /** Cached /tmp listing to avoid redundant I/O on every scan. */
  private cachedSocketNames: string[] = [];
  private cachedSocketAt = 0;
  private static readonly SOCKET_CACHE_TTL_MS = 5_000;

  /** Discover swarm socket directories in /tmp. */
  private async discoverSwarmSockets(): Promise<string[]> {
    try {
      // Issue #353: Cache /tmp listing for 5s to avoid redundant I/O.
      const now = Date.now();
      if (this.cachedSocketNames.length > 0 && now - this.cachedSocketAt < SwarmMonitor.SOCKET_CACHE_TTL_MS) {
        return this.cachedSocketNames;
      }

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

      this.cachedSocketNames = socketNames;
      this.cachedSocketAt = now;
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

  /** Find the parent Aegis session for a swarm by matching the CC process PID. */
  private findParentSession(pid: number, _teammates: TeammateInfo[]): SessionInfo | null {
    if (pid === 0) return null;

    // Issue #353: Match swarm socket PID against session.ccPid.
    // The swarm socket name (claude-swarm-{pid}) contains the PID of the parent CC process.
    for (const session of this.sessions.listSessions()) {
      if (session.ccPid === pid) {
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
