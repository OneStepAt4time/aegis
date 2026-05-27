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
import { type UIState } from './session.js';
import { type ParsedEntry } from './transcript.js';
import { type ChannelManager, type SessionEventPayload, type SessionEvent } from './channels/index.js';
import { type SessionEventBus } from './events.js';
import { type JsonlWatcher, type JsonlWatcherEvent } from './jsonl-watcher.js';
import { stopSignalsSchema } from './validation.js';
import { type AcpBackend } from './services/acp/backend.js';
import { SYSTEM_TENANT } from './config.js';
import { suppressedCatch } from './suppress.js';
import { logger } from './logger.js';
import { maybeInjectFault } from './fault-injection.js';

import { StallDetector, type StallDetectorConfig, type StallDetectorDeps } from './stall-detector.js';

import { type AlertManager } from './alerting.js';
import { type MetricsCollector } from './metrics.js';
import { startToolSpan, setToolResult, spanOk } from './tracing.js';
import type { Span } from '@opentelemetry/api';
import { computeDelayMs, retryWithJitter } from './retry.js';
import { RateLimitCoordinator } from './rate-limit-coordinator.js';

export interface MonitorConfig {
  pollIntervalMs: number;       // Base poll interval (default: 30000 — hooks are primary signal)
  fastPollIntervalMs: number;   // Poll interval when hooks haven't fired recently (default: 5000)
  hookQuietMs: number;          // If no hook received for this long, switch to fast polling (default: 60000)
  stallThresholdMs: number;     // Emit stall event after this long without new JSONL bytes while "working" (default: 5min)
  stallCheckIntervalMs: number; // How often to run stall checks (default: 30000)
  deadCheckIntervalMs: number;  // How often to check for dead sessions (default: 10000)
  permissionStallMs: number;    // Permission prompt stall threshold (default: 5min)
  unknownStallMs: number;       // Unknown state stall threshold (default: 3min)
  permissionTimeoutMs: number;  // Auto-reject permission after this long (default: 10min)
  rateLimitMaxRetries: number;     // Max retry attempts for rate-limited sessions (default: 3)
  rateLimitBaseDelayMs: number;    // Base delay for exponential backoff on retry (default: 5000)
  rateLimitMaxDelayMs: number;     // Max delay cap for exponential backoff (default: 60000)
  stallRecoveryEnabled: boolean;      // Auto-recover stalled sessions via restart (default: true)
  stallRecoveryMaxRetries: number;    // Max restart attempts for stall recovery (default: 1)
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
  rateLimitMaxRetries: 3,                  // Issue #3754: retry up to 3 times on rate limit
  rateLimitBaseDelayMs: 5_000,             // Issue #3754: 5s base backoff
  rateLimitMaxDelayMs: 60_000,             // Issue #3754: 60s max backoff
  stallRecoveryEnabled: true,              // Issue #3752: auto-recover stalled sessions
  stallRecoveryMaxRetries: 1,              // Issue #3752: single restart attempt
};

export class SessionMonitor {
  private running = false;
  private lastStatus = new Map<string, UIState>();
  /** Active tool spans for OTel lifecycle tracking (#2807) */
  private _activeToolSpans = new Map<string, Span>();
  /** Stall detector — encapsulates all stall detection logic and state. */
  private stallDetector: StallDetector;

  // -- Forwarding accessors for backward-compatible test access (via `as any`) --

  /** @internal Backward compat: expose stallNotified for tests. */
  get lastBytesSeen() { return this.stallDetector.lastBytesSeen; }
  /** @internal Backward compat: expose stateSince for tests. */
  get stateSince() { return this.stallDetector.stateSince; }
  /** @internal Backward compat: expose prevStatusForStall for tests. */
  get prevStatusForStall() { return this.stallDetector.prevStatusForStall; }
  /** @internal Backward compat: expose rateLimitedSessions for tests. */
  get rateLimitedSessions() { return this.stallDetector.rateLimitedSessions; }
  /** @internal Backward compat: expose stallNotified for tests. */
  get stallNotified() { return this.stallDetector.stallNotified; }

  /** @internal Backward compat: forward to stallDetector. */
  stallHas(sessionId: string, stallType: string): boolean {
    return this.stallDetector.stallHas(sessionId, stallType);
  }
  /** @internal Backward compat: forward to stallDetector. */
  stallAdd(sessionId: string, stallType: string): void {
    this.stallDetector.stallAdd(sessionId, stallType);
  }
  /** @internal Backward compat: forward to stallDetector. */
  stallDelete(sessionId: string, stallType: string): void {
    this.stallDetector.stallDelete(sessionId, stallType);
  }
  /** @internal Backward compat: forward to stallDetector. */
  stallDeleteAll(sessionId: string): void {
    this.stallDetector.stallDeleteAll(sessionId);
  }
  /** @internal Backward compat: forward to stallDetector. */
  stallDeleteTypes(sessionId: string, types: string[]): void {
    this.stallDetector.stallDeleteTypes(sessionId, types);
  }
  private lastStallCheck = 0;
  private lastDeadCheck = 0;
  private idleNotified = new Set<string>();       // prevent idle spam
  // Issue #1808: Track sessions that have already received auto-compact for context_warning
  private contextWarningCompacted = new Set<string>();
  private idleSince = new Map<string, number>();  // debounce: when idle started
  private processedStopSignals = new Set<string>(); // Issue #15: don't re-process signals
  private static readonly MAX_PROCESSED_STOP_SIGNALS = 1000; // #220: prevent unbounded growth
  private deadNotified = new Set<string>();  // don't spam dead session events
  /** Issue #3931: Cross-session rate-limit retry coordinator. */
  private rateLimitCoordinator = new RateLimitCoordinator();
  // Issue #1324: Track statusText per session to detect extended thinking ("Cogitated for Xm Ys")
  private lastStatusText = new Map<string, string | null>();
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
    this.stallDetector = new StallDetector(
      {
        stallThresholdMs: this.config.stallThresholdMs,
        permissionStallMs: this.config.permissionStallMs,
        unknownStallMs: this.config.unknownStallMs,
        permissionTimeoutMs: this.config.permissionTimeoutMs,
        stallRecoveryEnabled: this.config.stallRecoveryEnabled,
        stallRecoveryMaxRetries: this.config.stallRecoveryMaxRetries,
      },
      {
        rejectSession: (sid) => this.sessions.reject(sid),
        emitStall: (sid, type, detail) => this.eventBus?.emitStall(sid, type, detail),
        statusChange: (payload) => { void this.channels.statusChange(payload); },
        makePayload: (event, session, detail) => this.makePayload(event, session, detail),
        alertFailure: (type, detail) => this.alertManager?.recordFailure(type as import('./alerting.js').AlertType, detail),
        metricsFailed: (sid) => this.metrics?.sessionFailed(sid),
        restartSession: undefined, // set later via setAcpBackend
        onSessionIdle: (sid) => this.contextWarningCompacted.delete(sid),
      },
    );
  }

  /** Issue #32: Set the event bus for SSE streaming. */
  setEventBus(bus: SessionEventBus): void {
    this.eventBus = bus;
  }

  /** Issue #1418: Alert manager for production alerting. */
  private alertManager?: AlertManager;
  /** Issue #2067: MetricsCollector for completed/failed session counters. */
  private metrics?: MetricsCollector;
  /** Issue #1418: Set the AlertManager for production alerting. */
  setAlertManager(alertManager: AlertManager): void {
    this.alertManager = alertManager;
  }

  /** Issue #2067: Set the MetricsCollector for completed/failed session counters. */
  setMetrics(metrics: MetricsCollector): void {
    this.metrics = metrics;
  }

  /** Issue #3754: ACP backend for session restart on rate limit. */
  private acpBackend?: AcpBackend;
  /** Issue #3754: Track retry attempts per session for rate-limit retries. */
  private rateLimitRetryAttempts = new Map<string, number>();
  /** Issue #3754: Set the ACP backend for rate-limit retry support. */
  setAcpBackend(acpBackend: AcpBackend): void {
    this.acpBackend = acpBackend;
    // Wire up restartSession callback without discarding accumulated stall state.
    this.stallDetector.setRestartSession((params) => acpBackend.restartSession(params));
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

    for (const session of this.sessions.listSessions()) {
      try {
        // Issue #84: Start watching when jsonlPath is discovered
        if (this.jsonlWatcher && session.jsonlPath && !this.jsonlWatcher.isWatching(session.id)) {
          const initialOffset = typeof session.monitorOffset === 'number' ? session.monitorOffset : 0;
        this.jsonlWatcher.watch(session.id, session.jsonlPath, initialOffset);
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

  /** Stall detection: delegates to StallDetector. */
  private async checkForStalls(now: number): Promise<void> {
    await this.stallDetector.check(
      this.sessions.listSessions(),
      this.lastStatus,
      this.lastStatusText,
      now,
    );
  }

  /** Issue #15: Check for Stop/StopFailure signals written by hook.ts. */
  /**
   * Issue #3754: Handle a rate-limit StopFailure signal.
   * Attempts automatic retry with exponential backoff via ACP backend restart.
   * Extracted for testability.
   */
  /** Delegate stall recovery to StallDetector. */
  attemptStallRecovery(session: SessionInfo, stallType: string): void {
    this.stallDetector.attemptStallRecovery(session, stallType);
  }

  async handleRateLimitSignal(session: SessionInfo, stopReason: string): Promise<void> {
    this.stallDetector.rateLimitedSessions.add(session.id);
    // Issue #3754: Attempt automatic retry with exponential backoff.
    const retryAttempt = (this.rateLimitRetryAttempts.get(session.id) ?? 0) + 1;
    const maxRetries = this.config.rateLimitMaxRetries;
    if (this.acpBackend && retryAttempt <= maxRetries) {
      const baseDelay = this.config.rateLimitBaseDelayMs;
      const maxDelay = this.config.rateLimitMaxDelayMs;
      // Exponential backoff with jitter (shared computeDelayMs from retry.ts)
      const delayMs = computeDelayMs(retryAttempt, baseDelay, maxDelay);
      this.rateLimitRetryAttempts.set(session.id, retryAttempt);
      this.channels.statusChange(
        this.makePayload('status.rate_limited', session,
          `Claude API rate limited (${stopReason}). Retrying (${retryAttempt}/${maxRetries}) in ${Math.round(delayMs / 1000)}s…`),
      );
      logger.info({
        component: 'monitor',
        operation: 'rate_limit_retry',
        sessionId: session.id,
        attributes: { attempt: retryAttempt, maxRetries, delayMs, stopReason },
      });
      // Issue #3931: Coordinate retry with other sessions to avoid concurrent
      // rate-limit retries that amplify the problem. Acquire a slot, wait for
      // the backoff delay, then restart. Release the slot when done.
      const backend = this.acpBackend;
      const sid = session.id;
      const cwd = session.workDir;
      const tenantId = session.tenantId ?? SYSTEM_TENANT;
      const ownerKeyId = session.ownerKeyId ?? 'master';
      const coordinator = this.rateLimitCoordinator;
      // Fire-and-forget: acquire slot → delay → restart → release
      coordinator.acquire(sid).then(() => {
        return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }).then(() => {
        return backend.restartSession({
          sessionId: sid,
          cwd,
          tenantId,
          ownerKeyId,
          reason: `rate_limit_retry_${retryAttempt}`,
        });
      }).then((result) => {
        logger.info({
          component: 'monitor',
          operation: 'rate_limit_retry_success',
          sessionId: sid,
          attributes: { attempt: retryAttempt, backoffDelayMs: result.backoffDelayMs },
        });
        this.stallDetector.rateLimitedSessions.delete(sid);
        coordinator.release(sid);
      }).catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error({
          component: 'monitor',
          operation: 'rate_limit_retry_failed',
          sessionId: sid,
          errorCode: 'RATE_LIMIT_RETRY_ERROR',
          attributes: { attempt: retryAttempt, error: errMsg },
        });
        coordinator.release(sid);
        // If this was the last attempt, notify the user and clean up
        if (retryAttempt >= maxRetries) {
          this.rateLimitRetryAttempts.delete(sid);
          this.channels.statusChange(
            this.makePayload('status.error', { ...session, status: 'error' } as SessionInfo,
              `Rate-limit retry exhausted (${maxRetries}/${maxRetries}). Session requires manual intervention.`),
            );
          this.alertManager?.recordFailure('session_failure',
            `Session "${session.displayName}" rate-limit retries exhausted: ${errMsg}`);
          this.metrics?.sessionFailed(sid);
        }
      });
    } else if (!this.acpBackend) {
      // No ACP backend available — legacy notification only
      this.channels.statusChange(
        this.makePayload('status.rate_limited', session,
          `Claude API rate limited (${stopReason}). Session will resume when the backoff window expires.`),
      );
    } else {
      // Retries exhausted
      this.rateLimitRetryAttempts.delete(session.id);
      this.channels.statusChange(
        this.makePayload('status.error', session,
          `Rate-limit retry exhausted (${maxRetries}/${maxRetries}). Session requires manual intervention.`),
      );
      this.alertManager?.recordFailure('session_failure',
        `Session "${session.displayName}" rate-limit retries exhausted`);
      this.metrics?.sessionFailed(session.id);
    }
  }

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
            await this.handleRateLimitSignal(session, stopReason);
          } else {
            const errorDetail = signal.error || signal.stop_reason || 'Unknown API error';
            this.channels.statusChange(
              this.makePayload('status.error', session,
                `⚠️ Claude Code error: ${errorDetail}`),
            );
            // Issue #1418: Report session failure to alerting
            this.alertManager?.recordFailure('session_failure',
              `Session "${session.displayName}" failed: ${errorDetail}`);
            // Issue #2067: record session as failed
            this.metrics?.sessionFailed(session.id);
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
          // Issue #2538: Update session status to idle so the API returns
          // the correct state and the monitor doesn't re-broadcast stale
          // working status on the next poll cycle.
          session.status = 'idle';
          this.lastStatus.set(session.id, 'idle');
          // Clean up stall tracking so the session doesn't appear stalled
          this.stallDetector.stallDeleteAll(session.id);
          this.stallDetector.stateSince.delete(session.id);
          this.idleNotified.add(session.id);

          this.channels.statusChange(
            this.makePayload('status.stopped', session,
              'Claude Code session ended normally'),
          );
          // Issue #2067: record session as completed
          this.metrics?.sessionCompleted(session.id);
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
      this.stallDetector.rateLimitedSessions.delete(event.sessionId);
      // Issue #3754: Reset retry tracking when session resumes activity
      this.rateLimitRetryAttempts.delete(event.sessionId);

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
    const prev = this.stallDetector.lastBytesSeen.get(event.sessionId);
    if (event.newOffset > (prev?.bytes ?? -1)) {
      if (event.messages.length > 0) {
        // Real output — reset stall timer
        this.stallDetector.lastBytesSeen.set(event.sessionId, { bytes: event.newOffset, at: now });
        this.stallDetector.stallDelete(event.sessionId, 'jsonl');
      } else {
        // File grew but no messages — only update bytes, keep timestamp
        this.stallDetector.lastBytesSeen.set(event.sessionId, { bytes: event.newOffset, at: prev?.at ?? now });
      }
    }
  }

  private async checkSession(session: SessionInfo): Promise<void> {
    // When the JSONL watcher is active, messages are forwarded via handleWatcherEvent.
    // Here we only need to capture the terminal UI state (permission prompts, idle, etc.)
    const result = await this.sessions.readMessagesForMonitor(session.id);
    const prevStatus = this.lastStatus.get(session.id);

    // Forward messages only when watcher is NOT active for THIS session (#3286).
    // Checking the watcher instance alone misses the discovery poll where the
    // fallback just set jsonlPath but the watcher hasn't started yet — entries
    // read here would otherwise be dropped before the watcher subscribes.
    if (!this.jsonlWatcher?.isWatching(session.id) && result.messages.length > 0) {
      this.stallDetector.rateLimitedSessions.delete(session.id);
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

    const idleSince = this.idleSince.get(session.id);
    const idleReadyToBroadcast = result.status === 'idle'
      && idleSince !== undefined
      && Date.now() - idleSince >= 3_000
      && !this.idleNotified.has(session.id);

    // Detect and broadcast status changes (debounced)
    if (result.status !== prevStatus || idleReadyToBroadcast) {
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

    // Issue #2807: Create OTel spans for tool events from CC output stream
    if (event === 'message.tool_use' && msg.toolName) {
      const span = startToolSpan('invoke', {
        sessionId: session.id,
        toolName: msg.toolName,
        toolUseId: msg.toolUseId,
      });
      // Store span for closing on tool_result — use a simple class field
      this._activeToolSpans.set(`${session.id}:${msg.toolUseId}`, span);
    }
    if (event === 'message.tool_result' && msg.toolUseId) {
      const spanKey = `${session.id}:${msg.toolUseId}`;
      const span = this._activeToolSpans.get(spanKey);
      if (span) {
        setToolResult(span, { success: true });
        spanOk(span);
        span.end();
        this._activeToolSpans.delete(spanKey);
      }
    }

    await maybeInjectFault('monitor.forwardMessage.channels.message');
    this.channels.message(this.makePayload(event, session, msg.text));
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
      // acceptEdits, and auto handle their own permissions). Plan mode must
      // surface an approval step so the client can review before execution.
      const AUTO_APPROVE_MODES = new Set(['bypassPermissions', 'dontAsk', 'acceptEdits', 'auto']);
      if (session.permissionMode !== 'default' && AUTO_APPROVE_MODES.has(session.permissionMode)) {
        logger.info({
          component: 'monitor',
          operation: 'auto_approve_permission',
          sessionId: session.id,
          attributes: { displayName: session.displayName, mode: session.permissionMode },
        });
        try {
          await this.sessions.approve(session.id);
          this.channels.statusChange(
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
          this.channels.statusChange(
            this.makePayload('status.permission', session,
              `[AUTO-APPROVE FAILED] ${result.interactiveContent || 'Permission requested'}: ${errMsg}`),
          );
        }
      } else {
        this.channels.statusChange(
          this.makePayload('status.permission', session, result.interactiveContent || 'Permission requested'),
        );
      }
    } else if (status === 'plan_mode') {
      this.eventBus?.emitStatus(session.id, 'plan_mode', result.interactiveContent || 'Plan review requested');
      this.channels.statusChange(
        this.makePayload('status.plan', session, result.interactiveContent || 'Plan review requested'),
      );
    } else if (status === 'idle') {
      const idleStart = this.idleSince.get(session.id) || Date.now();
      const idleDuration = Date.now() - idleStart;
      // Only notify after 3s of continuous idle, and only once (M23: reduced from 10s)
      if (idleDuration >= 3_000 && !this.idleNotified.has(session.id)) {
        this.idleNotified.add(session.id);
        this.eventBus?.emitStatus(session.id, 'idle', result.statusText || 'Session finished working, awaiting input');
        this.channels.statusChange(
          this.makePayload('status.idle', session, result.statusText || 'Session finished working, awaiting input'),
        );
      }
    } else if (status === 'context_warning' && prevStatus !== 'context_warning') {
      // Issue #1808: Auto-inject /compact to prevent context window overflow.
      // Only trigger once per context_warning episode to avoid duplicate compactions.
      if (!this.contextWarningCompacted.has(session.id)) {
        this.contextWarningCompacted.add(session.id);
        logger.info({
          component: 'monitor',
          operation: 'auto_compact_context_warning',
          sessionId: session.id,
          attributes: { displayName: session.displayName },
        });
        try {
          this.channels.statusChange(
            this.makePayload('status.context_warning', session,
              'Context window nearing limit — auto-injected /compact to prevent overflow'),
          );
        } catch (e: unknown) {
          logger.error({
            component: 'monitor',
            operation: 'auto_compact_context_warning',
            sessionId: session.id,
            errorCode: 'AUTO_COMPACT_FAILED',
            attributes: { error: e instanceof Error ? e.message : String(e) },
          });
        }
      }
    } else if (status === 'ask_question' && prevStatus !== 'ask_question') {
      this.eventBus?.emitStatus(session.id, 'ask_question', result.interactiveContent || 'Session is asking a question');
      this.channels.statusChange(
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
        name: session.displayName,
        workDir: session.workDir,
      },
      detail: detail.slice(0, 2000),
    };
  }

  /** Check for dead sessions and notify via channels. */
  private async checkDeadSessions(): Promise<void> {

    const sessions = this.sessions.listSessions();
    for (const session of sessions) {
      if (this.deadNotified.has(session.id)) continue;

      await maybeInjectFault('monitor.checkDeadSessions.isWindowAlive');
      const alive = await this.sessions.isWindowAlive(session.id);
      if (!alive) {
        const cause = 'process_not_alive_or_unknown';

        logger.warn({
          component: 'monitor',
          operation: 'check_dead_sessions',
          sessionId: session.id,
          errorCode: 'SESSION_TERMINATED_UNEXPECTEDLY',
          attributes: {
            cause,
            displayName: session.displayName,
            windowId: session.windowId,
            claudeSessionId: session.claudeSessionId,
            ccPid: session.ccPid ?? null,
            uptimeMs: Date.now() - session.createdAt,
            lastActivityAt: new Date(session.lastActivity).toISOString(),
            detectedAt: new Date().toISOString(),
          },
        });

        this.deadNotified.add(session.id);
        // Track when the session died so the zombie reaper can clean it up
        session.lastDeadAt = Date.now();
        const detail = `Session "${session.displayName}" died — session process no longer alive. ` +
            `Last activity: ${new Date(session.lastActivity).toISOString()}`;
        this.eventBus?.emitDead(session.id, detail);
        this.channels.statusChange(
          this.makePayload('status.dead', session, detail),
        );
        // Issue #1418: Report dead session to alerting
        this.alertManager?.recordFailure('session_failure',
          `Session "${session.displayName}" died unexpectedly: ${cause}`);
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

  /** Clean up tracking for a killed session. */
  removeSession(sessionId: string): void {
    // Issue #84: Stop watching JSONL file for this session
    this.jsonlWatcher?.unwatch(sessionId);
    this.lastStatus.delete(sessionId);
    this.lastStatusText.delete(sessionId);
    this.deadNotified.delete(sessionId);
    // Issue #3754: Clear retry tracking
    this.rateLimitRetryAttempts.delete(sessionId);
    // Issue #3931: Remove from rate-limit coordinator queue.
    this.rateLimitCoordinator.dequeue(sessionId);
    // Issue #89 L4: Clear pending debounce timer
    const pending = this.statusChangeDebounce.get(sessionId);
    if (pending) {
      clearTimeout(pending);
      this.statusChangeDebounce.delete(sessionId);
    }
    // Delegate all stall-related cleanup to StallDetector
    this.stallDetector.removeSession(sessionId);
    this.idleNotified.delete(sessionId);
    this.contextWarningCompacted.delete(sessionId);
    this.idleSince.delete(sessionId);
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
