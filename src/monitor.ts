/**
 * monitor.ts — Background monitor that polls sessions and routes events to channels.
 *
 * Runs a polling loop that:
 * 1. Checks each active session for new JSONL entries
 * 2. Detects status changes (working → idle, permission prompts, etc.)
 * 3. Routes events to the ChannelManager (which fans out to Telegram, webhooks, etc.)
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { type SessionManager, type SessionInfo } from './session.js';
import { type TmuxManager } from './tmux.js';
import { type ParsedEntry } from './transcript.js';
import { type UIState, parseCogitatedDuration } from './terminal-parser.js';
import { type ChannelManager, type SessionEventPayload, type SessionEvent } from './channels/index.js';
import { type SessionEventBus } from './events.js';
import { type JsonlWatcher, type JsonlWatcherEvent } from './jsonl-watcher.js';
import { stopSignalsSchema } from './validation.js';
import { suppressedCatch } from './suppress.js';
import { logger } from './logger.js';
import { maybeInjectFault } from './fault-injection.js';
import { type AlertManager } from './alerting.js';

export interface MonitorConfig {
  pollIntervalMs: number;       // Base poll interval (default: 30000 — hooks are primary signal)
  fastPollIntervalMs: number;   // Poll interval when hooks haven't fired recently (default: 5000)
  hookQuietMs: number;          // If no hook received for this long, switch to fast polling (default: 60000)
  stallThresholdMs: number;     // Emit stall event after this long without new JSONL bytes while "working" (default: 5min)
  stallCheckIntervalMs: number; // How often to run stall checks (default: 30000)
  deadCheckIntervalMs: number;  // How often to check for dead tmux windows (default: 10000)
  permissionStallMs: number;    // Permission prompt stall threshold (default: 5min)
  unknownStallMs: number;       // Unknown state stall threshold (default: 3min)
  permissionTimeoutMs: number;  // Auto-reject permission after this long (default: 10min)
}

/** Issue #89 L4: Debounce interval for status change broadcasts (ms). */
const STATUS_CHANGE_DEBOUNCE_MS = 500;

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  pollIntervalMs: 30_000,               // 30s base — hooks are the primary signal (Issue #169 Phase 3)
  fastPollIntervalMs: 5_000,            // 5s when hooks are quiet — fallback safety net
  hookQuietMs: 60_000,                  // 60s without a hook → switch to fast polling
  stallThresholdMs: 2 * 60 * 1000,          // 2 minutes (Issue #392: reduced from 5 min)
  stallCheckIntervalMs: 30 * 1000,        // check every 30 seconds (faster for shorter thresholds)
  deadCheckIntervalMs: 10 * 1000,         // check every 10 seconds (Issue M19: faster dead detection)
  permissionStallMs: 5 * 60 * 1000,       // 5 min waiting for permission = stalled
  unknownStallMs: 3 * 60 * 1000,          // 3 min in unknown state = stalled
  permissionTimeoutMs: 10 * 60 * 1000,    // 10 min → auto-reject permission
};

const SIGNAL_BY_NUMBER: Record<number, string> = {
  1: 'SIGHUP',
  2: 'SIGINT',
  3: 'SIGQUIT',
  6: 'SIGABRT',
  9: 'SIGKILL',
  11: 'SIGSEGV',
  13: 'SIGPIPE',
  14: 'SIGALRM',
  15: 'SIGTERM',
};

function signalFromExitCode(exitCode: number | null): string | null {
  if (exitCode === null || exitCode < 129) return null;
  return SIGNAL_BY_NUMBER[exitCode - 128] ?? `SIG${exitCode - 128}`;
}

export class SessionMonitor {
  private running = false;
  private lastStatus = new Map<string, UIState>();
  private lastBytesSeen = new Map<string, { bytes: number; at: number }>();
  // Issue #663: Nested Map for O(1) per-session stall lookup (was Set with O(n) prefix scan)
  private stallNotified = new Map<string, Set<string>>();  // sessionId → Set<stallType>

  /** Issue #663: O(1) stall notification check. */
  private stallHas(sessionId: string, stallType: string): boolean {
    return this.stallNotified.get(sessionId)?.has(stallType) ?? false;
  }

  /** Issue #663: O(1) stall notification add. */
  private stallAdd(sessionId: string, stallType: string): void {
    const set = this.stallNotified.get(sessionId);
    if (set) { set.add(stallType); } else { this.stallNotified.set(sessionId, new Set([stallType])); }
  }

  /** Issue #663: O(1) stall notification delete. */
  private stallDelete(sessionId: string, stallType: string): void {
    this.stallNotified.get(sessionId)?.delete(stallType);
  }

  /** Issue #663: Delete all stall notifications for a session. */
  private stallDeleteAll(sessionId: string): void {
    this.stallNotified.delete(sessionId);
  }

  /** Issue #663: Delete specific stall types for a session. */
  private stallDeleteTypes(sessionId: string, types: string[]): void {
    const set = this.stallNotified.get(sessionId);
    if (!set) return;
    for (const t of types) set.delete(t);
  }
  private lastStallCheck = 0;
  private lastDeadCheck = 0;
  private idleNotified = new Set<string>();       // prevent idle spam
  private idleSince = new Map<string, number>();  // debounce: when idle started
  private processedStopSignals = new Set<string>(); // Issue #15: don't re-process signals
  private static readonly MAX_PROCESSED_STOP_SIGNALS = 1000; // #220: prevent unbounded growth
  // Smart stall detection: track when each non-working state started
  private stateSince = new Map<string, { state: string; since: number }>();  // sessionId → { state, since } (one entry per session)
  private deadNotified = new Set<string>();  // don't spam dead session events
  private prevStatusForStall = new Map<string, UIState>();  // track previous status for stall transition detection
  private rateLimitedSessions = new Set<string>();  // sessions in rate-limit backoff
  // Issue #1324: Track statusText per session to detect extended thinking ("Cogitated for Xm Ys")
  private lastStatusText = new Map<string, string | null>();
  /** Thinking stall threshold multiplier — CC extended thinking gets 5x the normal stall threshold. */
  private static readonly THINKING_STALL_MULTIPLIER = 5;
  // Issue #397: Track tmux server health for crash recovery
  private tmuxWasDown = false;
  private lastTmuxHealthCheck = 0;
  private static readonly TMUX_HEALTH_CHECK_INTERVAL_MS = 10_000; // check every 10s

  /** Issue #89 L4: Debounce status change broadcasts per session.
   *  If multiple status changes happen within 500ms, only emit the last one.
   *  Prevents rapid-fire notifications during state transitions. */
  private statusChangeDebounce = new Map<string, NodeJS.Timeout>();

  /** Issue #32: Optional SSE event bus for real-time streaming. */
  private eventBus?: SessionEventBus;

  /** Issue #84: fs.watch-based JSONL watcher for near-instant message detection. */
  private jsonlWatcher?: JsonlWatcher;

  constructor(
    private sessions: SessionManager,
    private channels: ChannelManager,
    private config: MonitorConfig = DEFAULT_MONITOR_CONFIG,
  ) {
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...config };
  }

  /** Issue #32: Set the event bus for SSE streaming. */
  setEventBus(bus: SessionEventBus): void {
    this.eventBus = bus;
  }

  /** Issue #397: Set the TmuxManager reference for tmux health checks. */
  private tmux?: TmuxManager;

  /** Issue #1418: Alert manager for production alerting. */
  private alertManager?: AlertManager;

  setTmuxManager(tmuxManager: TmuxManager): void {
    this.tmux = tmuxManager;
  }

  /** Issue #1418: Set the AlertManager for production alerting. */
  setAlertManager(alertManager: AlertManager): void {
    this.alertManager = alertManager;
  }

  /** Issue #84: Set the JSONL watcher for fs.watch-based message detection. */
  setJsonlWatcher(watcher: JsonlWatcher): void {
    this.jsonlWatcher = watcher;
    watcher.onEntries((event: JsonlWatcherEvent) => {
      this.handleWatcherEvent(event);
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.poll();
      } catch (e) {
        logger.error({
          component: 'monitor',
          operation: 'poll',
          errorCode: 'MONITOR_POLL_ERROR',
          attributes: { error: e instanceof Error ? e.message : String(e) },
        });
      }
      // Issue #169 Phase 3: Adaptive polling — use fast interval if any session
      // hasn't received a hook recently (hooks may have stopped working).
      const interval = this.needsFastPolling() ? this.config.fastPollIntervalMs : this.config.pollIntervalMs;
      await sleep(interval);
    }
  }

  /** Check if any active session hasn't received a hook recently.
   *  Issue #1097: Only fast-poll if hooks are configured (at least one session
   *  has received a hook). If no session has ever received a hook, hooks are
   *  likely not configured — use slow polling. */
  private needsFastPolling(): boolean {
    const now = Date.now();
    for (const session of this.sessions.listSessions()) {
      const lastHook = session.lastHookAt;
      if (lastHook === undefined) continue; // session with no hook, skip
      // Session received a hook but is now quiet — need fast polling
      if (now - lastHook > this.config.hookQuietMs) return true;
    }
    // If no session has ever received a hook, hooks are not configured — slow poll
    return false;
  }

  private async poll(): Promise<void> {
    const now = Date.now();

    // Issue #397: Run tmux health checks before dead-session reaping.
    // This prevents false "status.dead" events when tmux is temporarily
    // unreachable and windows still exist once the server recovers.
    if (now - this.lastTmuxHealthCheck >= SessionMonitor.TMUX_HEALTH_CHECK_INTERVAL_MS) {
      this.lastTmuxHealthCheck = now;
      await this.checkTmuxHealth();
    }

    for (const session of this.sessions.listSessions()) {
      try {
        // Issue #84: Start watching when jsonlPath is discovered
        if (this.jsonlWatcher && session.jsonlPath && !this.jsonlWatcher.isWatching(session.id)) {
          this.jsonlWatcher.watch(session.id, session.jsonlPath, session.monitorOffset);
        }
        await this.checkSession(session);
      } catch (e) {
        suppressedCatch(e, 'monitor.checkSession');
      }
    }

    // Stall detection: run less frequently than message polling
    if (now - this.lastStallCheck >= this.config.stallCheckIntervalMs) {
      this.lastStallCheck = now;
      await this.checkForStalls(now);
      await this.checkStopSignals();
    }

    // Dead session detection: independent timer (M19: 10s default)
    if (now - this.lastDeadCheck >= this.config.deadCheckIntervalMs) {
      this.lastDeadCheck = now;
      await this.checkDeadSessions();
    }
  }

  /** Smart stall detection: multiple stall types with graduated thresholds.
   *
   * Detects 4 types of stalls:
   * 1. JSONL stall: "working" but no new JSONL bytes for stallThresholdMs
   * 2. Permission stall: permission_prompt/bash_approval for permissionStallMs
   * 3. Unknown stall: unknown state for unknownStallMs (CC stuck in transition)
   * 4. State duration stall: any non-idle state for 2x its threshold
   */
  private async checkForStalls(now: number): Promise<void> {
    for (const session of this.sessions.listSessions()) {
      const currentStatus = this.lastStatus.get(session.id);
      const prevStallStatus = this.prevStatusForStall.get(session.id);

      // Track state transitions — one entry per session, preserving timer across
      // permission_prompt ↔ bash_approval transitions (both are "permission" states)
      if (currentStatus && currentStatus !== 'idle') {
        const entry = this.stateSince.get(session.id);
        if (!entry) {
          this.stateSince.set(session.id, { state: currentStatus, since: now });
        } else if (entry.state !== currentStatus) {
          const isPermState = (s: string): boolean => s === 'permission_prompt' || s === 'bash_approval';
          if (isPermState(entry.state) && isPermState(currentStatus)) {
            entry.state = currentStatus; // preserve since across permission sub-type transitions
          } else {
            this.stateSince.set(session.id, { state: currentStatus, since: now });
          }
        }
      }

      // --- Type 1: JSONL stall (working but no output) ---
      if (currentStatus === 'working') {
        // Skip stall detection for rate-limited sessions — CC is in backoff
        if (this.rateLimitedSessions.has(session.id)) {
          continue;
        }

        const prev = this.lastBytesSeen.get(session.id);
        const currentBytes = session.monitorOffset;

        if (!prev) {
          this.lastBytesSeen.set(session.id, { bytes: currentBytes, at: now });
          continue;
        }

        if (currentBytes > prev.bytes) {
          this.lastBytesSeen.set(session.id, { bytes: currentBytes, at: now });
          this.stallDelete(session.id, 'jsonl');
          this.stallDelete(session.id, 'thinking');
        } else {
          const stallDuration = now - prev.at;
          const baseThreshold = session.stallThresholdMs || this.config.stallThresholdMs;

          // Issue #1324: CC extended thinking ("Cogitated for Xm Ys") is legitimate work
          // but produces no JSONL bytes. Use a longer threshold before flagging as stalled.
          const statusText = this.lastStatusText.get(session.id) ?? null;
          const thinkingDuration = statusText ? parseCogitatedDuration(statusText) : null;

          if (thinkingDuration !== null) {
            // CC is in extended thinking mode — use 5x the normal stall threshold
            const thinkingThreshold = baseThreshold * SessionMonitor.THINKING_STALL_MULTIPLIER;
            if (stallDuration >= thinkingThreshold && !this.stallHas(session.id, 'thinking')) {
              this.stallAdd(session.id, 'thinking');
              const minutes = Math.round(thinkingDuration / 60000);
              const detail = `Session stalled: CC extended thinking for ${minutes}min with no output. ` +
                  `Status: "${statusText}". Consider: POST /v1/sessions/${session.id}/interrupt or /kill`;
              this.eventBus?.emitStall(session.id, 'thinking', detail);
              await this.channels.statusChange(
                this.makePayload('status.stall', session, detail),
              );
            }
          } else {
            // Normal JSONL stall detection
            if (stallDuration >= baseThreshold && !this.stallHas(session.id, 'jsonl')) {
              this.stallAdd(session.id, 'jsonl');
              const minutes = Math.round(stallDuration / 60000);
              const detail = `Session stalled: "working" for ${minutes}min with no new output. ` +
                  `Last activity: ${new Date(session.lastActivity).toISOString()}`;
              this.eventBus?.emitStall(session.id, 'jsonl', detail);
              await this.channels.statusChange(
                this.makePayload('status.stall', session, detail),
              );
            }
          }
        }
      } else {
        // Reset JSONL and thinking stall tracking when not working
        this.stallDelete(session.id, 'jsonl');
        this.stallDelete(session.id, 'thinking');
      }

      // --- Type 2: Permission stall (waiting for approval too long) ---
      if (currentStatus === 'permission_prompt' || currentStatus === 'bash_approval') {
        const entry = this.stateSince.get(session.id);
        const permDuration = entry ? now - entry.since : 0;
        if (permDuration >= this.config.permissionStallMs) {
          if (!this.stallHas(session.id, 'permission')) {
            this.stallAdd(session.id, 'permission');
            const minutes = Math.round(permDuration / 60000);
            const detail = `Session stalled: waiting for permission approval for ${minutes}min. ` +
                `Auto-approve this session or POST /v1/sessions/${session.id}/approve`;
            this.eventBus?.emitStall(session.id, 'permission', detail);
            await this.channels.statusChange(
              this.makePayload('status.stall', session, detail),
            );
          }
        }
        // L9: Auto-reject permission after timeout
        if (permDuration >= this.config.permissionTimeoutMs) {
          if (!this.stallHas(session.id, 'permission_timeout')) {
            this.stallAdd(session.id, 'permission_timeout');
            const minutes = Math.round(permDuration / 60000);
            logger.warn({
              component: 'monitor',
              operation: 'permission_timeout_auto_reject',
              sessionId: session.id,
              errorCode: 'PERMISSION_TIMEOUT',
              attributes: { windowName: session.windowName, timeoutMinutes: minutes },
            });
            try {
              await this.sessions.reject(session.id);
              const detail = `Permission auto-rejected after ${minutes}min timeout (session ${session.windowName})`;
              this.eventBus?.emitStall(session.id, 'permission_timeout', detail);
              await this.channels.statusChange(
                this.makePayload('status.permission_timeout', session, detail),
              );
            } catch (e: unknown) {
              logger.error({
                component: 'monitor',
                operation: 'permission_timeout_auto_reject',
                sessionId: session.id,
                errorCode: 'AUTO_REJECT_FAILED',
                attributes: { error: e instanceof Error ? e.message : String(e) },
              });
            }
          }
        }
      }

      // --- Type 3: Unknown stall (CC stuck in transition) ---
      if (currentStatus === 'unknown') {
        const entry = this.stateSince.get(session.id);
        const unkDuration = entry ? now - entry.since : 0;
        if (unkDuration >= this.config.unknownStallMs) {
          if (!this.stallHas(session.id, 'unknown')) {
            this.stallAdd(session.id, 'unknown');
            const minutes = Math.round(unkDuration / 60000);
            const detail = `Session stalled: in "unknown" state for ${minutes}min. ` +
                `CC may be stuck. Try: POST /v1/sessions/${session.id}/interrupt or /kill`;
            this.eventBus?.emitStall(session.id, 'unknown', detail);
            await this.channels.statusChange(
              this.makePayload('status.stall', session, detail),
            );
          }
        }
      }

      // --- Type 4: Extended state stall (any state held too long) ---
      if (currentStatus && currentStatus !== 'idle' && currentStatus !== 'working') {
        const entry = this.stateSince.get(session.id);
        const stateDuration = entry ? now - entry.since : 0;
        const extendedThreshold = this.config.stallThresholdMs * 2;
        if (stateDuration >= extendedThreshold) {
          if (!this.stallHas(session.id, 'extended')) {
            this.stallAdd(session.id, 'extended');
            const minutes = Math.round(stateDuration / 60000);
            const detail = `Session stalled: "${currentStatus}" state for ${minutes}min. ` +
                `May need intervention: /interrupt, /approve, or /kill`;
            this.eventBus?.emitStall(session.id, 'extended', detail);
            await this.channels.statusChange(
              this.makePayload('status.stall', session, detail),
            );
          }
        }
      }

      // --- Type 5: Extended working stall (working too long regardless of byte changes, ---
      // Catches CC stuck in "Misting" state where internal loop detection
      if (currentStatus === 'working') {
        const entry = this.stateSince.get(session.id);
        if (entry && entry.state === 'working') {
          const workingDuration = now - entry.since;
          const maxWorkingMs = this.config.stallThresholdMs * 3; // 15 min default
          if (workingDuration >= maxWorkingMs && !this.stallHas(session.id, 'extended_working')) {
            this.stallAdd(session.id, 'extended_working');
            const minutes = Math.round(workingDuration / 60000);
            const detail = `Session stalled: in "working" state for ${minutes}min. ` +
              `CC may be stuck in an internal loop (e.g., Misting). Consider: POST /v1/sessions/${session.id}/interrupt or /kill`;
            this.eventBus?.emitStall(session.id, 'extended_working', detail);
            await this.channels.statusChange(
              this.makePayload('status.stall', session, detail),
            );
          }
        }
      }

      // Clean up stall notifications on state transitions (using prevStallStatus)
      if (prevStallStatus && prevStallStatus !== currentStatus) {
        const exitedPermission = prevStallStatus === 'permission_prompt' || prevStallStatus === 'bash_approval';
        const exitedUnknown = prevStallStatus === 'unknown';

        if (exitedPermission) {
          this.stallDeleteTypes(session.id, ['permission', 'permission_timeout']);
        }
        if (exitedUnknown) {
          this.stallDelete(session.id, 'unknown');
        }
      }

      // Clean up all state tracking when idle (catch-all)
      if (currentStatus === 'idle') {
        this.rateLimitedSessions.delete(session.id);
        this.stateSince.delete(session.id);
        // Clean stall notifications (session recovered) — O(1) with Map
        this.stallDeleteAll(session.id);
      }

      // Update prevStatusForStall for next cycle
      if (currentStatus) {
        this.prevStatusForStall.set(session.id, currentStatus);
      } else {
        this.prevStatusForStall.delete(session.id);
      }
    }
  }

  /** Issue #15: Check for Stop/StopFailure signals written by hook.ts. */
  private async checkStopSignals(): Promise<void> {
    // Check both aegis and manus dirs for backward compat
    const aegisDir = join(homedir(), '.aegis');
    const manusDir = join(homedir(), '.manus');
    const signalFile = existsSync(join(aegisDir, 'stop_signals.json'))
      ? join(aegisDir, 'stop_signals.json')
      : join(manusDir, 'stop_signals.json');

    if (!existsSync(signalFile)) return;

    try {
      const raw = await readFile(signalFile, 'utf-8');
      const parsed = stopSignalsSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        logger.warn({
          component: 'monitor',
          operation: 'check_stop_signals',
          errorCode: 'STOP_SIGNALS_INVALID',
        });
        return;
      }
      const signals = parsed.data;

      for (const session of this.sessions.listSessions()) {
        if (!session.claudeSessionId) continue;
        const signal = signals[session.claudeSessionId] as {
          event?: string;
          timestamp?: number;
          error?: string;
          stop_reason?: string;
        } | undefined;

        if (!signal) continue;

        const signalKey = `${session.claudeSessionId}:${signal.timestamp}`;
        if (this.processedStopSignals.has(signalKey)) continue;
        this.processedStopSignals.add(signalKey);

        // #220: Prune oldest entries when Set exceeds max size
        // #510: Collect keys first, then delete — avoid mutation during iteration
        if (this.processedStopSignals.size > SessionMonitor.MAX_PROCESSED_STOP_SIGNALS) {
          const toRemove = this.processedStopSignals.size - SessionMonitor.MAX_PROCESSED_STOP_SIGNALS;
          const keysToDelete = [...this.processedStopSignals].slice(0, toRemove);
          for (const key of keysToDelete) {
            this.processedStopSignals.delete(key);
          }
        }

        if (signal.event === 'StopFailure') {
          logger.warn({
            component: 'monitor',
            operation: 'check_stop_signals',
            sessionId: session.id,
            errorCode: 'STOP_FAILURE_SIGNAL',
            attributes: {
              stopReason: signal.stop_reason ?? null,
              error: signal.error ?? null,
              signalTimestamp: signal.timestamp ?? null,
            },
          });
          const stopReason = signal.stop_reason || '';
          if (stopReason === 'rate_limit' || stopReason === 'overloaded') {
            this.rateLimitedSessions.add(session.id);
            await this.channels.statusChange(
              this.makePayload('status.rate_limited', session,
                `Claude API rate limited (${stopReason}). Session will resume when the backoff window expires.`),
            );
          } else {
            const errorDetail = signal.error || signal.stop_reason || 'Unknown API error';
            await this.channels.statusChange(
              this.makePayload('status.error', session,
                `⚠️ Claude Code error: ${errorDetail}`),
            );
            // Issue #1418: Report session failure to alerting
            this.alertManager?.recordFailure('session_failure',
              `Session "${session.windowName}" failed: ${errorDetail}`);
          }
        } else if (signal.event === 'Stop') {
          logger.info({
            component: 'monitor',
            operation: 'check_stop_signals',
            sessionId: session.id,
            errorCode: 'STOP_SIGNAL',
            attributes: {
              signalTimestamp: signal.timestamp ?? null,
            },
          });
          await this.channels.statusChange(
            this.makePayload('status.stopped', session,
              'Claude Code session ended normally'),
          );
        }
      }
    } catch (e) { suppressedCatch(e, 'monitor.checkStopSignals.parseEntry'); }
  }

  /** Issue #84: Handle new entries from the fs.watch-based JSONL watcher.
   *  Forwards messages to channels and updates stall tracking. */
  private handleWatcherEvent(event: JsonlWatcherEvent): void {
    const session = this.sessions.getSession(event.sessionId);
    if (!session) return;

    // Update monitor offset from watcher
    session.monitorOffset = event.newOffset;

    if (event.messages.length > 0) {
      // Clear rate-limited state — CC resumed producing real output
      this.rateLimitedSessions.delete(event.sessionId);

      for (const msg of event.messages) {
        // Forward asynchronously (fire-and-forget) — catch to prevent unhandled rejection (#404)
        void this.forwardMessage(session, msg).catch(e =>
          logger.error({
            component: 'monitor',
            operation: 'forward_message',
            sessionId: session.id,
            errorCode: 'FORWARD_MESSAGE_FAILED',
            attributes: { error: e instanceof Error ? e.message : String(e) },
          }),
        );
      }

      // Update last activity
      session.lastActivity = Date.now();
    }

    // Update JSONL stall tracking — only reset stall timer when real messages arrive
    // When no messages, only update bytes tracking (keep timestamp)
    const now = Date.now();
    const prev = this.lastBytesSeen.get(event.sessionId);
    if (event.newOffset > (prev?.bytes ?? -1)) {
      if (event.messages.length > 0) {
        // Real output — reset stall timer
        this.lastBytesSeen.set(event.sessionId, { bytes: event.newOffset, at: now });
        this.stallDelete(event.sessionId, 'jsonl');
      } else {
        // File grew but no messages — only update bytes, keep timestamp
        this.lastBytesSeen.set(event.sessionId, { bytes: event.newOffset, at: prev?.at ?? now });
      }
    }
  }

  private async checkSession(session: SessionInfo): Promise<void> {
    // When the JSONL watcher is active, messages are forwarded via handleWatcherEvent.
    // Here we only need to capture the terminal UI state (permission prompts, idle, etc.)
    const result = await this.sessions.readMessagesForMonitor(session.id);
    const prevStatus = this.lastStatus.get(session.id);

    // Forward messages only when watcher is NOT active (fallback polling path)
    if (!this.jsonlWatcher && result.messages.length > 0) {
      this.rateLimitedSessions.delete(session.id);
      for (const msg of result.messages) {
        await this.forwardMessage(session, msg);
      }
    }

    // Idle debounce: only emit idle after 10s of continuous idle
    if (result.status === 'idle') {
      if (!this.idleSince.has(session.id)) {
        this.idleSince.set(session.id, Date.now());
      }
    } else {
      this.idleSince.delete(session.id);
      // Reset idle notification guard when genuinely not idle
      if (result.status === 'working' || result.status === 'unknown') {
        this.idleNotified.delete(session.id);
      }
    }

    // Detect and broadcast status changes (debounced)
    if (result.status !== prevStatus) {
      // Issue #89 L4: Debounce rapid status changes per session.
      // If multiple transitions happen within STATUS_CHANGE_DEBOUNCE_MS,
      // only the last one triggers a broadcast.
      const existing = this.statusChangeDebounce.get(session.id);
      if (existing) clearTimeout(existing);

      const latestStatus = result.status;
      const latestPrevStatus = prevStatus;
      const latestResult = { statusText: result.statusText, interactiveContent: result.interactiveContent };

      this.statusChangeDebounce.set(session.id, setTimeout(() => {
        this.statusChangeDebounce.delete(session.id);
        // #511: Skip broadcast if session was killed while debounce was pending
        if (!this.lastStatus.has(session.id)) return;
        void this.broadcastStatusChange(session, latestStatus, latestPrevStatus, latestResult)
          .catch(e => logger.error({
            component: 'monitor',
            operation: 'broadcast_status_change',
            sessionId: session.id,
            errorCode: 'BROADCAST_STATUS_CHANGE_FAILED',
            attributes: { error: e instanceof Error ? e.message : String(e) },
          }));
      }, STATUS_CHANGE_DEBOUNCE_MS));
    }

    this.lastStatus.set(session.id, result.status);
    this.lastStatusText.set(session.id, result.statusText);
  }

  private async forwardMessage(session: SessionInfo, msg: ParsedEntry): Promise<void> {
    const eventMap: Record<string, SessionEvent> = {
      'user:text': 'message.user',
      'assistant:text': 'message.assistant',
      'assistant:thinking': 'message.thinking',
      'assistant:tool_use': 'message.tool_use',
      'assistant:tool_result': 'message.tool_result',
    };

    const key = `${msg.role}:${msg.contentType}`;

    // Issue #89 L33: System entries get a different SSE event type
    if (msg.role === 'system') {
      this.eventBus?.emitSystem(session.id, msg.text, msg.contentType);
      return;
    }

    const event = eventMap[key];
    if (!event) return;

    // Issue #32: Emit SSE message event (L11: include tool metadata)
    this.eventBus?.emitMessage(session.id, msg.role, msg.text, msg.contentType,
      msg.toolName || msg.toolUseId ? { tool_name: msg.toolName, tool_id: msg.toolUseId } : undefined);

    await maybeInjectFault('monitor.forwardMessage.channels.message');
    await this.channels.message(this.makePayload(event, session, msg.text));
  }

  private async broadcastStatusChange(
    session: SessionInfo,
    status: UIState,
    prevStatus: UIState | undefined,
    result: { statusText: string | null; interactiveContent: string | null },
  ): Promise<void> {
    await maybeInjectFault('monitor.broadcastStatusChange.start');

    if (status === 'permission_prompt' || status === 'bash_approval') {
      // Issue #32: Emit SSE approval event
      this.eventBus?.emitApproval(session.id, result.interactiveContent || 'Permission requested');

      // Auto-approve if session has a non-default permission mode
      // that auto-approves permission prompts (bypassPermissions, dontAsk,
      // acceptEdits, plan, auto all handle their own permissions).
      const AUTO_APPROVE_MODES = new Set(['bypassPermissions', 'dontAsk', 'acceptEdits', 'plan', 'auto']);
      if (session.permissionMode !== 'default' && AUTO_APPROVE_MODES.has(session.permissionMode)) {
        logger.info({
          component: 'monitor',
          operation: 'auto_approve_permission',
          sessionId: session.id,
          attributes: { windowName: session.windowName, mode: session.permissionMode },
        });
        try {
          await this.sessions.approve(session.id);
          await this.channels.statusChange(
            this.makePayload('status.permission', session,
              `[AUTO-APPROVED] ${result.interactiveContent || 'Permission auto-approved'}`),
          );
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          logger.error({
            component: 'monitor',
            operation: 'auto_approve_permission',
            sessionId: session.id,
            errorCode: 'AUTO_APPROVE_FAILED',
            attributes: { error: errMsg },
          });
          await this.channels.statusChange(
            this.makePayload('status.permission', session,
              `[AUTO-APPROVE FAILED] ${result.interactiveContent || 'Permission requested'}: ${errMsg}`),
          );
        }
      } else {
        await this.channels.statusChange(
          this.makePayload('status.permission', session, result.interactiveContent || 'Permission requested'),
        );
      }
    } else if (status === 'plan_mode') {
      this.eventBus?.emitStatus(session.id, 'plan_mode', result.interactiveContent || 'Plan review requested');
      await this.channels.statusChange(
        this.makePayload('status.plan', session, result.interactiveContent || 'Plan review requested'),
      );
    } else if (status === 'idle') {
      const idleStart = this.idleSince.get(session.id) || Date.now();
      const idleDuration = Date.now() - idleStart;
      // Only notify after 3s of continuous idle, and only once (M23: reduced from 10s)
      if (idleDuration >= 3_000 && !this.idleNotified.has(session.id)) {
        this.idleNotified.add(session.id);
        this.eventBus?.emitStatus(session.id, 'idle', result.statusText || 'Session finished working, awaiting input');
        await this.channels.statusChange(
          this.makePayload('status.idle', session, result.statusText || 'Session finished working, awaiting input'),
        );
      }
    } else if (status === 'ask_question' && prevStatus !== 'ask_question') {
      this.eventBus?.emitStatus(session.id, 'ask_question', result.interactiveContent || 'Session is asking a question');
      await this.channels.statusChange(
        this.makePayload('status.question', session, result.interactiveContent || 'Session is asking a question'),
      );
    }

    // Issue #32: Emit working status via SSE
    if (status === 'working' && prevStatus !== 'working') {
      this.eventBus?.emitStatus(session.id, 'working', 'Claude is working');
    }
  }

  private makePayload(event: SessionEvent, session: SessionInfo, detail: string): SessionEventPayload {
    return {
      event,
      timestamp: new Date().toISOString(),
      session: {
        id: session.id,
        name: session.windowName,
        workDir: session.workDir,
      },
      detail: detail.slice(0, 2000),
    };
  }

  /** Check for dead tmux windows and notify via channels. */
  private async checkDeadSessions(): Promise<void> {
    // Issue #397: While tmux server is down, defer dead-session cleanup.
    // tmux commands can fail transiently and make healthy sessions look dead.
    if (this.tmuxWasDown) return;

    const sessions = this.sessions.listSessions();
    for (const session of sessions) {
      if (this.deadNotified.has(session.id)) continue;

      await maybeInjectFault('monitor.checkDeadSessions.isWindowAlive');
      const alive = await this.sessions.isWindowAlive(session.id);
      if (!alive) {
        let windowExists: boolean | null = null;
        let paneDead: boolean | null = null;
        let paneCommand: string | null = null;
        let exitCode: number | null = null;

        try {
          if (this.tmux) {
            const health = await this.tmux.getWindowHealth(session.windowId);
            windowExists = health.windowExists;
            paneDead = health.paneDead;
            paneCommand = health.paneCommand;
            if (health.windowExists && health.paneDead) {
              const paneText = await this.tmux.capturePane(session.windowId);
              const statusMatch = paneText.match(/Pane is dead \(status\s+(\d+)\)/i);
              if (statusMatch) {
                const parsed = parseInt(statusMatch[1] ?? '', 10);
                exitCode = Number.isFinite(parsed) ? parsed : null;
              }
            }
          }
        } catch {
          // best-effort diagnostics only
        }

        const cause = windowExists === false
          ? 'window_missing'
          : paneDead
            ? 'pane_dead'
            : 'process_not_alive_or_unknown';

        logger.warn({
          component: 'monitor',
          operation: 'check_dead_sessions',
          sessionId: session.id,
          errorCode: 'SESSION_TERMINATED_UNEXPECTEDLY',
          attributes: {
            cause,
            windowName: session.windowName,
            windowId: session.windowId,
            claudeSessionId: session.claudeSessionId,
            ccPid: session.ccPid ?? null,
            paneCommand,
            windowExists,
            paneDead,
            paneAlive: paneDead === null ? null : !paneDead,
            exitCode,
            signal: signalFromExitCode(exitCode),
            uptimeMs: Date.now() - session.createdAt,
            lastActivityAt: new Date(session.lastActivity).toISOString(),
            detectedAt: new Date().toISOString(),
          },
        });

        this.deadNotified.add(session.id);
        // Track when the session died so the zombie reaper can clean it up
        session.lastDeadAt = Date.now();
        const detail = `Session "${session.windowName}" died — tmux window no longer exists. ` +
            `Last activity: ${new Date(session.lastActivity).toISOString()}`;
        this.eventBus?.emitDead(session.id, detail);
        await this.channels.statusChange(
          this.makePayload('status.dead', session, detail),
        );
        // Issue #1418: Report dead session to alerting
        this.alertManager?.recordFailure('session_failure',
          `Session "${session.windowName}" died unexpectedly: ${cause}`);
        this.removeSession(session.id);
        // #262: Also remove from SessionManager so dead sessions don't linger
        try {
          await this.sessions.killSession(session.id);
        } catch (e) {
          suppressedCatch(e, 'monitor.checkDeadSessions.killSession');
        }
      }
    }
  }

  /** Issue #397: Check tmux server health. Detect crashes and trigger reconciliation. */
  private async checkTmuxHealth(): Promise<void> {
    if (!this.tmux) return;
    let healthy = true;
    let error: string | null = null;
    try {
      ({ healthy, error } = await this.tmux.isServerHealthy());
    } catch (e: unknown) {
      healthy = false;
      error = e instanceof Error ? e.message : String(e);
    }

    if (!healthy) {
      // Only treat known server/socket failures as "tmux down".
      // Other tmux errors can be transient command failures.
      const serverDown = this.tmux.isTmuxServerError(new Error(error ?? 'tmux unavailable'));
      if (!serverDown) {
        logger.warn({
          component: 'monitor',
          operation: 'tmux_health_check',
          errorCode: 'TMUX_HEALTH_CHECK_ERROR',
          attributes: { error: error ?? 'unknown tmux health error' },
        });
        return;
      }
      if (!this.tmuxWasDown) {
        logger.warn({
          component: 'monitor',
          operation: 'tmux_health_check',
          errorCode: 'TMUX_UNREACHABLE',
          attributes: { error: error ?? 'tmux server unavailable' },
        });
        this.tmuxWasDown = true;
        // Issue #1418: Report tmux crash to alerting
        this.alertManager?.recordFailure('tmux_crash',
          `tmux server unreachable: ${error ?? 'unknown error'}`);
      }
      return;
    }

    // Tmux is healthy now
    if (this.tmuxWasDown) {
      logger.info({
        component: 'monitor',
        operation: 'tmux_health_check',
        errorCode: 'TMUX_RECOVERED',
      });
      this.tmuxWasDown = false;
      // Trigger crash reconciliation to re-attach or mark orphaned sessions
      const result = await this.sessions.reconcileTmuxCrash();
      if (result.recovered > 0 || result.orphaned > 0) {
        logger.info({
          component: 'monitor',
          operation: 'tmux_crash_reconciliation',
          attributes: { recovered: result.recovered, orphaned: result.orphaned },
        });
        // Notify channels about recovery
        for (const session of this.sessions.listSessions()) {
          await this.channels.statusChange(
            this.makePayload('status.recovered', session,
              `tmux server recovered. Session ${session.windowName} re-attached.`),
          );
        }
      }
    }
  }

  /** Clean up tracking for a killed session. */
  removeSession(sessionId: string): void {
    // Issue #84: Stop watching JSONL file for this session
    this.jsonlWatcher?.unwatch(sessionId);
    this.lastStatus.delete(sessionId);
    this.lastStatusText.delete(sessionId);
    this.lastBytesSeen.delete(sessionId);
    this.deadNotified.delete(sessionId);
    this.rateLimitedSessions.delete(sessionId);
    // Issue #89 L4: Clear pending debounce timer
    const pending = this.statusChangeDebounce.get(sessionId);
    if (pending) {
      clearTimeout(pending);
      this.statusChangeDebounce.delete(sessionId);
    }
    // Clean all stall notifications for this session — O(1) with Map
    this.stallDeleteAll(sessionId);
    this.idleNotified.delete(sessionId);
    this.idleSince.delete(sessionId);
    this.stateSince.delete(sessionId);
    this.prevStatusForStall.delete(sessionId);
    // Note: processedStopSignals uses claudeSessionId:timestamp keys, not bridge sessionId.
    // We don't clean them here — they're small and prevent re-processing.
  }

  /** Return active stall types for a session, or null if not stalled.
   *  Used by send_message to surface stall feedback to callers. */
  getStallInfo(sessionId: string): { stalled: true; types: string[] } | { stalled: false } {
    const types = this.stallNotified.get(sessionId);
    if (!types || types.size === 0) return { stalled: false };
    return { stalled: true, types: [...types] };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
