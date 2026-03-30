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
import { type ParsedEntry } from './transcript.js';
import { type UIState } from './terminal-parser.js';
import { type ChannelManager, type SessionEventPayload, type SessionEvent } from './channels/index.js';
import { type SessionEventBus } from './events.js';
import { type JsonlWatcher, type JsonlWatcherEvent } from './jsonl-watcher.js';
import { stopSignalsSchema } from './validation.js';

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
  stallThresholdMs: 5 * 60 * 1000,        // 5 minutes (Issue #4: reduced from 60 min)
  stallCheckIntervalMs: 30 * 1000,        // check every 30 seconds (faster for shorter thresholds)
  deadCheckIntervalMs: 10 * 1000,         // check every 10 seconds (Issue M19: faster dead detection)
  permissionStallMs: 5 * 60 * 1000,       // 5 min waiting for permission = stalled
  unknownStallMs: 3 * 60 * 1000,          // 3 min in unknown state = stalled
  permissionTimeoutMs: 10 * 60 * 1000,    // 10 min → auto-reject permission
};

export class SessionMonitor {
  private running = false;
  private lastStatus = new Map<string, UIState>();
  private lastBytesSeen = new Map<string, { bytes: number; at: number }>();
  private stallNotified = new Set<string>();  // don't spam stall events
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
    this.loop();
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.poll();
      } catch (e) {
        console.error('Monitor poll error:', e);
      }
      // Issue #169 Phase 3: Adaptive polling — use fast interval if any session
      // hasn't received a hook recently (hooks may have stopped working).
      const interval = this.needsFastPolling() ? this.config.fastPollIntervalMs : this.config.pollIntervalMs;
      await sleep(interval);
    }
  }

  /** Check if any active session hasn't received a hook recently. */
  private needsFastPolling(): boolean {
    const now = Date.now();
    for (const session of this.sessions.listSessions()) {
      const lastHook = session.lastHookAt;
      // If a session has never received a hook, always fast-poll (hooks may not be configured)
      if (lastHook === undefined) return true;
      // If no hook for hookQuietMs, switch to fast polling
      if (now - lastHook > this.config.hookQuietMs) return true;
    }
    return false;
  }

  private async poll(): Promise<void> {
    const now = Date.now();
    for (const session of this.sessions.listSessions()) {
      try {
        // Issue #84: Start watching when jsonlPath is discovered
        if (this.jsonlWatcher && session.jsonlPath && !this.jsonlWatcher.isWatching(session.id)) {
          this.jsonlWatcher.watch(session.id, session.jsonlPath, session.monitorOffset);
        }
        await this.checkSession(session);
      } catch {
        // Session may have been killed during poll
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
          this.stallNotified.delete(`${session.id}:stall:jsonl`);
        } else {
          const stallDuration = now - prev.at;
          const threshold = session.stallThresholdMs || this.config.stallThresholdMs;
          if (stallDuration >= threshold && !this.stallNotified.has(`${session.id}:stall:jsonl`)) {
            this.stallNotified.add(`${session.id}:stall:jsonl`);
            const minutes = Math.round(stallDuration / 60000);
            const detail = `Session stalled: "working" for ${minutes}min with no new output. ` +
                `Last activity: ${new Date(session.lastActivity).toISOString()}`;
            this.eventBus?.emitStall(session.id, 'jsonl', detail);
            await this.channels.statusChange(
              this.makePayload('status.stall', session, detail),
            );
          }
        }
      } else {
        // Reset JSONL stall tracking when not working
        this.stallNotified.delete(`${session.id}:stall:jsonl`);
      }

      // --- Type 2: Permission stall (waiting for approval too long) ---
      if (currentStatus === 'permission_prompt' || currentStatus === 'bash_approval') {
        const entry = this.stateSince.get(session.id);
        const permDuration = entry ? now - entry.since : 0;
        if (permDuration >= this.config.permissionStallMs) {
          if (!this.stallNotified.has(`${session.id}:stall:permission`)) {
            this.stallNotified.add(`${session.id}:stall:permission`);
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
          if (!this.stallNotified.has(`${session.id}:stall:permission_timeout`)) {
            this.stallNotified.add(`${session.id}:stall:permission_timeout`);
            const minutes = Math.round(permDuration / 60000);
            console.warn(`Monitor: auto-rejecting permission for session ${session.windowName} after ${minutes}min`);
            try {
              await this.sessions.reject(session.id);
              const detail = `Permission auto-rejected after ${minutes}min timeout (session ${session.windowName})`;
              this.eventBus?.emitStall(session.id, 'permission_timeout', detail);
              await this.channels.statusChange(
                this.makePayload('status.permission_timeout', session, detail),
              );
            } catch (e: unknown) {
              console.error(`Monitor: auto-reject failed for session ${session.id}: ${(e as Error).message}`);
            }
          }
        }
      }

      // --- Type 3: Unknown stall (CC stuck in transition) ---
      if (currentStatus === 'unknown') {
        const entry = this.stateSince.get(session.id);
        const unkDuration = entry ? now - entry.since : 0;
        if (unkDuration >= this.config.unknownStallMs) {
          if (!this.stallNotified.has(`${session.id}:stall:unknown`)) {
            this.stallNotified.add(`${session.id}:stall:unknown`);
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
          if (!this.stallNotified.has(`${session.id}:stall:extended`)) {
            this.stallNotified.add(`${session.id}:stall:extended`);
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

      // Clean up stall notifications on state transitions (using prevStallStatus)
      if (prevStallStatus && prevStallStatus !== currentStatus) {
        const exitedPermission = prevStallStatus === 'permission_prompt' || prevStallStatus === 'bash_approval';
        const exitedUnknown = prevStallStatus === 'unknown';

        if (exitedPermission) {
          this.stallNotified.delete(`${session.id}:stall:permission`);
          this.stallNotified.delete(`${session.id}:stall:permission_timeout`);
        }
        if (exitedUnknown) {
          this.stallNotified.delete(`${session.id}:stall:unknown`);
        }
      }

      // Clean up all state tracking when idle (catch-all)
      if (currentStatus === 'idle') {
        this.rateLimitedSessions.delete(session.id);
        this.stateSince.delete(session.id);
        // Clean stall notifications (session recovered)
        for (const key of this.stallNotified) {
          if (key.startsWith(session.id)) {
            this.stallNotified.delete(key);
          }
        }
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
        console.warn('stop_signals.json failed validation in checkStopSignals');
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
          }
        } else if (signal.event === 'Stop') {
          await this.channels.statusChange(
            this.makePayload('status.stopped', session,
              'Claude Code session ended normally'),
          );
        }
      }
    } catch { /* ignore parse errors */ }
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
          console.error(`Monitor: forwardMessage failed for ${session.id}:`, e),
        );
      }

      // Update last activity
      session.lastActivity = Date.now();
    }

    // Update JSONL stall tracking — always initialize on watcher events
    const now = Date.now();
    const prev = this.lastBytesSeen.get(event.sessionId);
    if (event.newOffset > (prev?.bytes ?? -1)) {
      this.lastBytesSeen.set(event.sessionId, { bytes: event.newOffset, at: now });
      this.stallNotified.delete(`${event.sessionId}:stall:jsonl`);
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
          .catch(e => console.error(`Monitor: broadcastStatusChange failed for ${session.id}:`, e));
      }, STATUS_CHANGE_DEBOUNCE_MS));
    }

    this.lastStatus.set(session.id, result.status);
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

    await this.channels.message(this.makePayload(event, session, msg.text));
  }

  private async broadcastStatusChange(
    session: SessionInfo,
    status: UIState,
    prevStatus: UIState | undefined,
    result: { statusText: string | null; interactiveContent: string | null },
  ): Promise<void> {
    if (status === 'permission_prompt' || status === 'bash_approval') {
      // Issue #32: Emit SSE approval event
      this.eventBus?.emitApproval(session.id, result.interactiveContent || 'Permission requested');

      // Auto-approve if session has a non-default permission mode
      // that auto-approves permission prompts (bypassPermissions, dontAsk,
      // acceptEdits, plan, auto all handle their own permissions).
      const AUTO_APPROVE_MODES = new Set(['bypassPermissions', 'dontAsk', 'acceptEdits', 'plan', 'auto']);
      if (session.permissionMode !== 'default' && AUTO_APPROVE_MODES.has(session.permissionMode)) {
        console.log(`[AUTO-APPROVED] Session ${session.windowName} (${session.id.slice(0, 8)}): ${result.interactiveContent || 'permission prompt'}`);
        try {
          await this.sessions.approve(session.id);
          await this.channels.statusChange(
            this.makePayload('status.permission', session,
              `[AUTO-APPROVED] ${result.interactiveContent || 'Permission auto-approved'}`),
          );
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.error(`[AUTO-APPROVE FAILED] Session ${session.id}: ${errMsg}`);
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
    const sessions = this.sessions.listSessions();
    for (const session of sessions) {
      if (this.deadNotified.has(session.id)) continue;

      const alive = await this.sessions.isWindowAlive(session.id);
      if (!alive) {
        this.deadNotified.add(session.id);
        // Track when the session died so the zombie reaper can clean it up
        session.lastDeadAt = Date.now();
        const detail = `Session "${session.windowName}" died — tmux window no longer exists. ` +
            `Last activity: ${new Date(session.lastActivity).toISOString()}`;
        this.eventBus?.emitDead(session.id, detail);
        await this.channels.statusChange(
          this.makePayload('status.dead', session, detail),
        );
        this.removeSession(session.id);
        // #262: Also remove from SessionManager so dead sessions don't linger
        try {
          await this.sessions.killSession(session.id);
        } catch {
          // Window already gone — that's fine, session is dead
        }
      }
    }
  }

  /** Clean up tracking for a killed session. */
  removeSession(sessionId: string): void {
    // Issue #84: Stop watching JSONL file for this session
    this.jsonlWatcher?.unwatch(sessionId);
    this.lastStatus.delete(sessionId);
    this.lastBytesSeen.delete(sessionId);
    this.deadNotified.delete(sessionId);
    this.rateLimitedSessions.delete(sessionId);
    // Issue #89 L4: Clear pending debounce timer
    const pending = this.statusChangeDebounce.get(sessionId);
    if (pending) {
      clearTimeout(pending);
      this.statusChangeDebounce.delete(sessionId);
    }
    // Clean all stall notifications for this session
    for (const key of this.stallNotified) {
      if (key.startsWith(sessionId)) {
        this.stallNotified.delete(key);
      }
    }
    this.idleNotified.delete(sessionId);
    this.idleSince.delete(sessionId);
    this.stateSince.delete(sessionId);
    this.prevStatusForStall.delete(sessionId);
    // Note: processedStopSignals uses claudeSessionId:timestamp keys, not bridge sessionId.
    // We don't clean them here — they're small and prevent re-processing.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
