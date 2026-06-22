/**
 * monitor.ts — Background monitor that polls sessions and routes events to channels.
 *
 * Runs a polling loop that:
 * 1. Checks each active session for new JSONL entries
 * 2. Detects status changes (working → idle, permission prompts, etc.)
 * 3. Routes events to the ChannelManager (which fans out to Telegram, webhooks, etc.)
 *
 * Refactored: dead detection, rate-limit retry, and status broadcasting
 * extracted into dedicated modules under monitor/.
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
import { suppressedCatch } from './suppress.js';
import { logger } from './logger.js';
import { maybeInjectFault } from './fault-injection.js';
import { redactStallDetail } from './utils/redact-stall-detail.js';
import { StallDetector, type StallDetectorConfig, type StallDetectorDeps } from './stall-detector.js';

import { type AlertManager } from './alerting.js';
import { type MetricsCollector } from './metrics.js';
import { startToolSpan, setToolResult, spanOk } from './tracing.js';
import type { Span } from '@opentelemetry/api';

import { DeadDetector } from './monitor/dead-detector.js';
import { RateLimitRetryHandler, type RateLimitRetryConfig } from './monitor/rate-limit-retry.js';
import { StatusBroadcaster } from './monitor/status-broadcaster.js';

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
  rateLimitMaxDelayMs: number;     // Max delay cap for exponential backoff on retry (default: 60000)
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

  // -- Extracted modules --
  private deadDetector: DeadDetector;
  private rateLimitHandler: RateLimitRetryHandler;
  private statusBroadcaster: StatusBroadcaster;

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
  /** @internal Backward compat: expose idleNotified via statusBroadcaster. */
  get idleNotified() { return this.statusBroadcaster.getIdleNotified(); }
  /** @internal Backward compat: expose idleSince via statusBroadcaster. */
  get idleSince() { return this.statusBroadcaster.getIdleSince(); }
  /** @internal Backward compat: expose deadNotified via deadDetector. */
  get deadNotified() { return this.deadDetector.getDeadNotified(); }
  /** @internal Backward compat: expose rateLimitRetryAttempts via rateLimitHandler. */
  get rateLimitRetryAttempts() { return this.rateLimitHandler.getRetryAttempts(); }
  /** @internal Backward compat: expose rateLimitCoordinator via rateLimitHandler. */
  get rateLimitCoordinator() { return this.rateLimitHandler.rateLimitCoordinator; }
  /** @internal Backward compat: expose statusChangeDebounce via statusBroadcaster. */
  get statusChangeDebounce() { return this.statusBroadcaster.getDebounceMap(); }

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
  private processedStopSignals = new Set<string>(); // Issue #15: don't re-process signals
  private static readonly MAX_PROCESSED_STOP_SIGNALS = 1000; // #220: prevent unbounded growth
  // Issue #1324: Track statusText per session to detect extended thinking ("Cogitated for Xm Ys")
  private lastStatusText = new Map<string, string | null>();

  /** Issue #32: Optional SSE event bus for real-time streaming. */
  private eventBus?: SessionEventBus;

  /** Issue #84: fs.watch-based JSONL watcher for near-instant message detection. */
  private jsonlWatcher?: JsonlWatcher;

  /** Issue #1418: Alert manager for production alerting. */
  private alertManager?: AlertManager;
  /** Issue #2067: MetricsCollector for completed/failed session counters. */
  private metrics?: MetricsCollector;
  /** Issue #3754: ACP backend for session restart on rate limit. */
  private acpBackend?: AcpBackend;

  constructor(
    private sessions: SessionManager,
    private channels: ChannelManager,
    private config: MonitorConfig = DEFAULT_MONITOR_CONFIG,
  ) {
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...config };

    // -- Wire up status broadcaster --
    this.statusBroadcaster = new StatusBroadcaster({
      sessions,
      makePayload: (event, session, detail) => this.makePayload(event, session, detail),
      statusChange: (payload) => { void this.channels.statusChange(payload); },
      emitApproval: (sid, content) => this.eventBus?.emitApproval(sid, content),
      emitStatus: (sid, status, detail) => this.eventBus?.emitStatus(sid, status, detail),
    });

    // -- Wire up dead detector --
    this.deadDetector = new DeadDetector({
      sessions,
      makePayload: (event, session, detail) => this.makePayload(event, session, detail),
      emitDead: (sid, detail) => this.eventBus?.emitDead(sid, detail),
      alertFailure: (type, detail) => this.alertManager?.recordFailure(type, detail),
      statusChange: (payload) => { void this.channels.statusChange(payload); },
      removeSession: (sid) => this.removeSession(sid),
    });

    // -- Wire up rate-limit retry handler --
    this.rateLimitHandler = new RateLimitRetryHandler(
      {
        makePayload: (event, session, detail) => this.makePayload(event, session, detail),
        statusChange: (payload) => { void this.channels.statusChange(payload); },
        alertFailure: (type, detail) => this.alertManager?.recordFailure(type, detail),
        metricsFailed: (sid) => this.metrics?.sessionFailed(sid),
        markRateLimited: (sid) => { this.stallDetector.rateLimitedSessions.add(sid); },
        unmarkRateLimited: (sid) => { this.stallDetector.rateLimitedSessions.delete(sid); },
      },
      {
        maxRetries: this.config.rateLimitMaxRetries,
        baseDelayMs: this.config.rateLimitBaseDelayMs,
        maxDelayMs: this.config.rateLimitMaxDelayMs,
      },
    );

    // -- Wire up stall detector --
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
        onSessionIdle: (sid) => this.statusBroadcaster.clearContextWarningCompact(sid),
      },
    );
  }

  /** Issue #32: Set the event bus for SSE streaming. */
  setEventBus(bus: SessionEventBus): void {
    this.eventBus = bus;
    // Re-wire event bus callbacks via public updateDeps methods
    this.statusBroadcaster.updateDeps({
      emitApproval: (sid, content) => bus.emitApproval(sid, content),
      emitStatus: (sid, status, detail) => bus.emitStatus(sid, status, detail),
    });
    this.deadDetector.updateDeps({
      emitDead: (sid, detail) => bus.emitDead(sid, detail),
    });
    this.stallDetector.updateDeps({
      emitStall: (sid, type, detail) => bus.emitStall(sid, type, detail),
    });
  }

  /** Issue #1418: Set the AlertManager for production alerting. */
  setAlertManager(alertManager: AlertManager): void {
    this.alertManager = alertManager;
    // Re-wire alert callbacks via public updateDeps methods
    this.deadDetector.updateDeps({
      alertFailure: (type, detail) => alertManager.recordFailure(type as import('./alerting.js').AlertType, detail),
    });
    this.rateLimitHandler.updateDeps({
      alertFailure: (type, detail) => alertManager.recordFailure(type as import('./alerting.js').AlertType, detail),
    });
    this.stallDetector.updateDeps({
      alertFailure: (type, detail) => alertManager.recordFailure(type as import('./alerting.js').AlertType, detail),
    });
  }

  /** Issue #2067: Set the MetricsCollector for completed/failed session counters. */
  setMetrics(metrics: MetricsCollector): void {
    this.metrics = metrics;
    this.rateLimitHandler.updateDeps({ metricsFailed: (sid) => metrics.sessionFailed(sid) });
    this.stallDetector.updateDeps({ metricsFailed: (sid) => metrics.sessionFailed(sid) });
  }

  /** Issue #3754: Set the ACP backend for rate-limit retry support. */
  setAcpBackend(acpBackend: AcpBackend): void {
    this.acpBackend = acpBackend;
    this.rateLimitHandler.setAcpBackend(acpBackend);
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
      const interval = this.needsFastPolling() ? this.config.fastPollIntervalMs : this.config.pollIntervalMs;
      await sleep(interval);
    }
  }

  /** Check if any active session hasn't received a hook recently. */
  private needsFastPolling(): boolean {
    const now = Date.now();
    for (const session of this.sessions.listSessions()) {
      const lastHook = session.lastHookAt;
      if (lastHook === undefined) continue;
      if (now - lastHook > this.config.hookQuietMs) return true;
    }
    return false;
  }

  private async poll(): Promise<void> {
    const now = Date.now();

    for (const session of this.sessions.listSessions()) {
      try {
        if (this.jsonlWatcher && session.jsonlPath && !this.jsonlWatcher.isWatching(session.id)) {
          const initialOffset = typeof session.monitorOffset === 'number' ? session.monitorOffset : 0;
          this.jsonlWatcher.watch(session.id, session.jsonlPath, initialOffset);
        }
        await this.checkSession(session);
      } catch (e) {
        suppressedCatch(e, 'monitor.checkSession');
      }
    }

    if (now - this.lastStallCheck >= this.config.stallCheckIntervalMs) {
      this.lastStallCheck = now;
      await this.checkForStalls(now);
      await this.checkStopSignals();
    }

    if (now - this.lastDeadCheck >= this.config.deadCheckIntervalMs) {
      this.lastDeadCheck = now;
      await this.checkDeadSessions();
    }
  }

  /** @internal Forward to deadDetector for backward compat with tests. */
  async checkDeadSessions(): Promise<void> {
    return this.deadDetector.checkDeadSessions();
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

  /** Delegate stall recovery to StallDetector. */
  attemptStallRecovery(session: SessionInfo, stallType: string): void {
    this.stallDetector.attemptStallRecovery(session, stallType);
  }

  async handleRateLimitSignal(session: SessionInfo, stopReason: string): Promise<void> {
    await this.rateLimitHandler.handleRateLimitSignal(session, stopReason);
  }

  /** Issue #15: Check for Stop/StopFailure signals written by hook.ts. */
  private async checkStopSignals(): Promise<void> {
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
            this.alertManager?.recordFailure('session_failure' as import('./alerting.js').AlertType,
              `Session "${session.displayName}" failed: ${errorDetail}`);
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
          session.status = 'idle';
          this.lastStatus.set(session.id, 'idle');
          this.stallDetector.stallDeleteAll(session.id);
          this.stallDetector.stateSince.delete(session.id);
          this.statusBroadcaster.getIdleNotified().add(session.id);

          this.channels.statusChange(
            this.makePayload('status.stopped', session,
              'Claude Code session ended normally'),
          );
          this.metrics?.sessionCompleted(session.id);
        }
      }
    } catch (e) { suppressedCatch(e, 'monitor.checkStopSignals.parseEntry'); }
  }

  /** Issue #84: Handle new entries from the fs.watch-based JSONL watcher. */
  private handleWatcherEvent(event: JsonlWatcherEvent): void {
    const session = this.sessions.getSession(event.sessionId);
    if (!session) return;

    session.monitorOffset = event.newOffset;

    if (event.messages.length > 0) {
      this.stallDetector.rateLimitedSessions.delete(event.sessionId);
      this.rateLimitHandler.getRetryAttempts().delete(event.sessionId);

      for (const msg of event.messages) {
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

      session.lastActivity = Date.now();
    }

    const now = Date.now();
    const prev = this.stallDetector.lastBytesSeen.get(event.sessionId);
    if (event.newOffset > (prev?.bytes ?? -1)) {
      if (event.messages.length > 0) {
        this.stallDetector.lastBytesSeen.set(event.sessionId, { bytes: event.newOffset, at: now });
        this.stallDetector.stallDelete(event.sessionId, 'jsonl');
      } else {
        this.stallDetector.lastBytesSeen.set(event.sessionId, { bytes: event.newOffset, at: prev?.at ?? now });
      }
    }
  }

  private async checkSession(session: SessionInfo): Promise<void> {
    const result = await this.sessions.readMessagesForMonitor(session.id);
    const prevStatus = this.lastStatus.get(session.id);

    if (!this.jsonlWatcher?.isWatching(session.id) && result.messages.length > 0) {
      this.stallDetector.rateLimitedSessions.delete(session.id);
      for (const msg of result.messages) {
        await this.forwardMessage(session, msg);
      }
    }

    // Track idle debounce state via statusBroadcaster
    this.statusBroadcaster.recordStatus(session.id, result.status);

    const idleSince = this.statusBroadcaster.getIdleSince().get(session.id);
    const idleReadyToBroadcast = result.status === 'idle'
      && idleSince !== undefined
      && Date.now() - idleSince >= 3_000
      && !this.statusBroadcaster.getIdleNotified().has(session.id);

    // Debounce status changes
    if (result.status !== prevStatus || idleReadyToBroadcast) {
      const debounceMap = this.statusBroadcaster.getDebounceMap();
      const existing = debounceMap.get(session.id);
      if (existing) clearTimeout(existing);

      const latestStatus = result.status;
      const latestPrevStatus = prevStatus;
      const latestResult = { statusText: result.statusText, interactiveContent: result.interactiveContent };

      debounceMap.set(session.id, setTimeout(() => {
        debounceMap.delete(session.id);
        if (!this.lastStatus.has(session.id)) return;
        void this.statusBroadcaster.broadcastStatusChange(session, latestStatus, latestPrevStatus, latestResult)
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

    if (msg.role === 'system') {
      this.eventBus?.emitSystem(session.id, msg.text, msg.contentType);
      return;
    }

    const event = eventMap[key];
    if (!event) return;

    this.eventBus?.emitMessage(session.id, msg.role, msg.text, msg.contentType,
      msg.toolName || msg.toolUseId ? { tool_name: msg.toolName, tool_id: msg.toolUseId } : undefined);

    if (event === 'message.tool_use' && msg.toolName) {
      const span = startToolSpan('invoke', {
        sessionId: session.id,
        toolName: msg.toolName,
        toolUseId: msg.toolUseId,
      });
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

  /** Build a standard event payload — Issue #4802 (F-6): redacts secrets before shipping. */
  makePayload(event: SessionEvent, session: SessionInfo, detail: string): SessionEventPayload {
    return {
      event,
      timestamp: new Date().toISOString(),
      session: {
        id: session.id,
        name: session.displayName,
        workDir: session.workDir,
      },
      detail: redactStallDetail(detail),
    };
  }

  /** Clean up tracking for a killed session. */
  removeSession(sessionId: string): void {
    this.jsonlWatcher?.unwatch(sessionId);
    this.lastStatus.delete(sessionId);
    this.lastStatusText.delete(sessionId);
    this.deadDetector.removeSession(sessionId);
    this.rateLimitHandler.removeSession(sessionId);
    this.statusBroadcaster.removeSession(sessionId);
    this.stallDetector.removeSession(sessionId);
    // Note: processedStopSignals uses claudeSessionId:timestamp keys, not bridge sessionId.
  }

  /** Return active stall types for a session, or null if not stalled. */
  getStallInfo(sessionId: string): { stalled: true; types: string[] } | { stalled: false } {
    const types = this.stallNotified.get(sessionId);
    if (!types || types.size === 0) return { stalled: false };
    return { stalled: true, types: [...types] };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
