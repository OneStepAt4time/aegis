/**
 * channels/telegram/index.ts — TelegramChannel class + public re-exports.
 *
 * Creates one topic per CC session in a Telegram supergroup.
 * Bidirectional: reads replies from topics and fires inbound commands.
 *
 * Refactored from 405-line god module (#4626). Transport extracted to
 * telegram/api.ts, health tracking to telegram/health.ts. Delegate methods
 * kept as instance methods for test spy compatibility.
 */

import type {
  Channel,
  ChannelHealthStatus,
  SessionEventPayload,
  InboundHandler,
} from '../types.js';

import {
  esc,
  bold,
  code,
  italic,
  quickUpdate,
  taskComplete,
  alert as styleAlert,
  type StyledMessage,
} from '../telegram-style.js';
import { StructuredLogger } from '../../logger.js';

import type {
  TelegramChannelConfig,
  TelegramChannelInternals,
  SessionTopic,
  SessionProgress,
  QueuedItem,
  ToolInfo,
} from './types.js';
import { TopicPersistence } from './topic-persistence.js';
import {
  truncate,
  elapsed,
  shortPath,
  stripXmlTags,
  parseOptions,
  sanitizeTopicName,
  safeCallbackData,
  md2html,
} from './formatter.js';
import {
  formatSubAgentTree,
  formatTimestamp,
  formatSessionCreated,
  formatAssistantMessage,
  parseToolUse,
  formatToolResult,
  formatProgressCard,
} from './message-formatter.js';
import {
  sleep,
  sendStyled,
  editStyled,
  editMessage,
  sendImmediate,
  queueMessage,
  flushQueue,
  flushReads,
  addPendingRead,
  removeReplyMarkup,
} from './telegram-sender.js';
import { pollLoop } from './telegram-polling.js';
import { handleOnMessage } from './telegram-message-handler.js';
import { handleOnStatusChange } from './telegram-status-handler.js';
import {
  cleanupSessionRuntimeState,
  startTopicCleanupSweep,
  clearTopicCleanupTimer,
  scheduleTopicCleanup,
  runTopicCleanup,
  TOPIC_CLEANUP_MAX_RETRIES,
} from './telegram-topic-lifecycle.js';
import { TelegramApiClient } from './api.js';
import { createHealthTracker, trackSuccess, trackFailure, getHealth, type HealthTracker } from './health.js';

// Re-export everything that was previously exported from telegram.ts
export type { TelegramChannelConfig, SessionTopic, SessionProgress, QueuedItem, ToolInfo } from './types.js';
export {
  sanitizeHref,
  sanitizeTopicName,
  safeCallbackData,
} from './formatter.js';
export {
  formatTimestamp,
} from './message-formatter.js';

const log = new StructuredLogger();

// ── Telegram Channel ────────────────────────────────────────────────────────

export class TelegramChannel implements Channel, TelegramChannelInternals {
  readonly name = 'telegram';
  static readonly DEFAULT_TOPIC_TTL_MS = 24 * 60 * 60 * 1000;

  // ── Shared state (TelegramChannelInternals) ──────────────────────────────

  topics = new Map<string, SessionTopic>();
  progress = new Map<string, SessionProgress>();
  pollOffset = 0;
  polling = false;
  pollBackoffMs = 1_000;
  onInbound: InboundHandler | null = null;
  topicCleanupTimers = new Map<string, NodeJS.Timeout>();
  topicCleanupSweepTimer: NodeJS.Timeout | null = null;
  readonly topicTtlMs: number;
  readonly topicAutoDelete: boolean;
  readonly topicPersistence: TopicPersistence;

  messageQueue = new Map<string, QueuedItem[]>();
  lastSent = new Map<string, number>();
  flushTimers = new Map<string, NodeJS.Timeout>();
  pendingTool = new Map<string, ToolInfo>();

  static readonly MAX_IN_FLIGHT = 10;
  inFlightCount = new Map<string, number>();

  preTopicBuffer = new Map<string, Array<{ method: string; payload: SessionEventPayload }>>();

  pendingReads = new Map<string, string[]>();
  readTimer = new Map<string, NodeJS.Timeout>();

  lastUserMessage = new Map<string, string>();

  private apiClient: TelegramApiClient;
  private healthTracker: HealthTracker;

  pollLoopPromise: Promise<void> = Promise.resolve();

  // ── Health tracking accessors (for TelegramChannelInternals compatibility) ──

  get rateLimitUntil(): number { return this.apiClient['rateLimitUntil']; }
  set rateLimitUntil(value: number) { this.apiClient['rateLimitUntil'] = value; }
  get lastSuccessAt(): number | null { return this.healthTracker.lastSuccessAt; }
  set lastSuccessAt(value: number | null) { this.healthTracker.lastSuccessAt = value; }
  get lastErrorAt(): number | null { return this.healthTracker.lastErrorAt; }
  set lastErrorAt(value: number | null) { this.healthTracker.lastErrorAt = value; }
  get lastErrorMessage(): string | null { return this.healthTracker.lastErrorMessage; }
  set lastErrorMessage(value: string | null) { this.healthTracker.lastErrorMessage = value; }
  get deliveryFailCount(): number { return this.healthTracker.deliveryFailCount; }
  set deliveryFailCount(value: number) { this.healthTracker.deliveryFailCount = value; }

  // ── Constructor ──────────────────────────────────────────────────────────

  constructor(readonly config: TelegramChannelConfig, stateDir?: string) {
    const configuredTtlMs = config.topicTtlMs ?? TelegramChannel.DEFAULT_TOPIC_TTL_MS;
    this.topicTtlMs = Number.isFinite(configuredTtlMs)
      ? Math.max(0, configuredTtlMs)
      : TelegramChannel.DEFAULT_TOPIC_TTL_MS;
    this.topicAutoDelete = config.topicAutoDelete ?? true;
    this.topicPersistence = new TopicPersistence(stateDir);
    this.topics = this.topicPersistence.load();
    if (this.topics.size > 0) {
      log.info({ component: 'telegram', operation: 'restoreTopics', attributes: { count: this.topics.size } });
    }
    this.apiClient = new TelegramApiClient(config);
    this.healthTracker = createHealthTracker();
  }

  // ── Telegram Bot API (delegated to apiClient) ───────────────────────────

  async tgApi(
    method: string,
    body: Record<string, unknown>,
    retries = 3,
  ): Promise<unknown> {
    return this.apiClient.tgApi(method, body, retries);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async init(onInbound: InboundHandler): Promise<void> {
    this.onInbound = onInbound;
    this.polling = true;
    startTopicCleanupSweep(this);
    // Pre-flight: clear stale pending updates to avoid 409 Conflict
    try {
      const stale = (await this.tgApi('getUpdates', {
        offset: -1,
        timeout: 0,
        allowed_updates: ['message', 'callback_query'],
      })) as Array<{ update_id: number }>;
      if (Array.isArray(stale) && stale.length > 0) {
        this.pollOffset = stale[stale.length - 1].update_id + 1;
        log.info({ component: 'telegram', operation: 'preflightClear', attributes: { count: stale.length, offset: this.pollOffset } });
      }
    } catch {
      // Pre-flight failure is non-fatal — the poll loop will retry
    }
    this.pollLoopPromise = pollLoop(this);
    log.info({ component: 'telegram', operation: 'pollingStarted', attributes: { groupChatId: this.config.groupChatId } });
  }

  async destroy(): Promise<void> {
    this.polling = false;
    const timeoutMs = 12_000;
    await Promise.race([
      this.pollLoopPromise,
      new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
    ]);
    for (const timer of this.flushTimers.values()) clearTimeout(timer);
    for (const timer of this.readTimer.values()) clearTimeout(timer);
    for (const timer of this.topicCleanupTimers.values()) clearTimeout(timer);
    if (this.topicCleanupSweepTimer) {
      clearInterval(this.topicCleanupSweepTimer);
      this.topicCleanupSweepTimer = null;
    }
    this.flushTimers.clear();
    this.readTimer.clear();
    this.topicCleanupTimers.clear();
  }

  // ── Session events ──────────────────────────────────────────────────────

  async onSessionCreated(payload: SessionEventPayload): Promise<void> {
    const topicName = sanitizeTopicName(`🤖 ${payload.session.name}`);
    const result = (await this.tgApi('createForumTopic', {
      chat_id: this.config.groupChatId,
      name: topicName,
    })) as { message_thread_id: number };

    const topicId = result.message_thread_id;
    clearTopicCleanupTimer(this, payload.session.id);
    this.topics.set(payload.session.id, {
      sessionId: payload.session.id,
      topicId,
      displayName: payload.session.name,
      endedAt: null,
      cleanupScheduledAt: null,
      cleanupRetries: 0,
      deleting: false,
    });

    this.progress.set(payload.session.id, {
      totalMessages: 0,
      reads: 0,
      edits: 0,
      creates: 0,
      commands: 0,
      searches: 0,
      errors: 0,
      filesRead: [],
      filesEdited: [],
      startedAt: Date.now(),
      lastMessage: '',
      currentStatus: 'starting',
      progressMessageId: null,
    });

    await sendImmediate(
      this,
      payload.session.id,
      formatSessionCreated(payload.session.name, payload.session.workDir, payload.session.id, payload.meta),
    );

    this.trackSuccess();
    this.topicPersistence.save(this.topics);

    // Issue #46: Replay any messages that arrived before topic was created
    const buffered = this.preTopicBuffer.get(payload.session.id);
    if (buffered && buffered.length > 0) {
      log.info({ component: 'telegram', operation: 'replayBuffered', sessionId: payload.session.id, attributes: { count: buffered.length, sessionName: payload.session.name } });
      for (const item of buffered) {
        if (item.method === 'message') {
          await this.onMessage(item.payload);
        } else if (item.method === 'statusChange') {
          await this.onStatusChange(item.payload);
        }
      }
    }
    this.preTopicBuffer.delete(payload.session.id);
  }

  async onSessionEnded(payload: SessionEventPayload): Promise<void> {
    await flushReads(this, payload.session.id);
    await flushQueue(this, payload.session.id);

    const prog = this.progress.get(payload.session.id);
    if (prog) {
      const duration = elapsed(Date.now() - prog.startedAt);
      const checks: Array<[string, boolean]> = [];
      checks.push([`${prog.totalMessages} msgs`, true]);
      checks.push([prog.errors === 0 ? 'No errors' : `${prog.errors} errors`, prog.errors === 0]);
      if (prog.filesEdited.length > 0) {
        checks.push([`${prog.filesEdited.length} files edited`, true]);
      }

      const styled = taskComplete({
        taskRef: payload.session.name,
        title: truncate(payload.detail || 'Session complete', 80),
        duration,
        branch: '',
        checks,
      });
      await this.sendStyled(payload.session.id, styled);
    } else {
      const styled = quickUpdate('✅', `${payload.session.name} — Session ended`);
      await this.sendStyled(payload.session.id, styled);
    }

    scheduleTopicCleanup(this, payload.session.id);
    cleanupSessionRuntimeState(this, payload.session.id);
  }

  async onMessage(payload: SessionEventPayload): Promise<void> {
    return handleOnMessage(this, payload);
  }

  async onStatusChange(payload: SessionEventPayload): Promise<void> {
    return handleOnStatusChange(this, payload);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  getTopicIdForSession(sessionId: string): number | null {
    const topic = this.topics.get(sessionId);
    return topic?.topicId ?? null;
  }

  getHealth(): ChannelHealthStatus {
    return getHealth(this.healthTracker, this.name, this.messageQueue.size);
  }

  trackSuccess(): void {
    trackSuccess(this.healthTracker);
  }

  trackFailure(error: unknown): void {
    trackFailure(this.healthTracker, error, this.redactError.bind(this));
  }

  // ── Delegate methods (used by tests via spyOn) ──────────────────────────

  /** Delegate to telegram-sender.sendStyled. Kept as instance method for test spy compatibility. */
  async sendStyled(sessionId: string, styled: StyledMessage): Promise<number | null> {
    return sendStyled(this, sessionId, styled);
  }

  /** Delegate to telegram-topic-lifecycle. Kept as instance method for test access. */
  startTopicCleanupSweep(): void {
    startTopicCleanupSweep(this);
  }

  /** Delegate to telegram-topic-lifecycle. Kept as instance method for test access. */
  scheduleTopicCleanup(sessionId: string): void {
    scheduleTopicCleanup(this, sessionId);
  }

  /** Delegate to telegram-topic-lifecycle. Kept as instance method for test access. */
  async runTopicCleanup(sessionId: string): Promise<void> {
    return runTopicCleanup(this, sessionId, TOPIC_CLEANUP_MAX_RETRIES);
  }

  /** Issue #348: Redact bot token from error messages before logging. */
  redactError(err: unknown): unknown {
    const token = this.config.botToken;
    if (!token) return err;
    const str = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
    if (!str.includes(token)) return err;
    const redacted = str.replaceAll(token, 'REDACTED');
    return err instanceof Error
      ? new Error(`${redacted}\n[stack redacted]`)
      : redacted;
  }
}
