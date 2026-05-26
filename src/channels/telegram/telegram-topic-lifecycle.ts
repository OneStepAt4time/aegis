/**
 * channels/telegram/telegram-topic-lifecycle.ts — Topic cleanup, scheduling, and runtime state.
 */

import { StructuredLogger } from '../../logger.js';

import type { TelegramChannelInternals } from './types.js';

const log = new StructuredLogger();

/** Max retries for topic cleanup. */
export const TOPIC_CLEANUP_MAX_RETRIES = 3;
/** Retry interval for topic cleanup failures. */
export const TOPIC_CLEANUP_RETRY_MS = 60_000;

// ── Runtime state cleanup ─────────────────────────────────────────────────

export function cleanupSessionRuntimeState(ctx: TelegramChannelInternals, sessionId: string): void {
  ctx.progress.delete(sessionId);
  ctx.lastSent.delete(sessionId);
  ctx.pendingTool.delete(sessionId);
  ctx.pendingReads.delete(sessionId);
  ctx.preTopicBuffer.delete(sessionId);
  ctx.lastUserMessage.delete(sessionId);
  ctx.inFlightCount.delete(sessionId);
  const ft = ctx.flushTimers.get(sessionId);
  if (ft) { clearTimeout(ft); ctx.flushTimers.delete(sessionId); }
  const rt = ctx.readTimer.get(sessionId);
  if (rt) { clearTimeout(rt); ctx.readTimer.delete(sessionId); }
}

// ── Topic cleanup sweep ───────────────────────────────────────────────────

export function startTopicCleanupSweep(ctx: TelegramChannelInternals): void {
  if (!ctx.topicAutoDelete) return;
  if (ctx.topicCleanupSweepTimer) return;
  const sweepMs = Math.min(60_000, Math.max(5_000, ctx.topicTtlMs || 5_000));
  ctx.topicCleanupSweepTimer = setInterval(() => {
    for (const [sessionId, topic] of ctx.topics) {
      if (topic.endedAt === null) continue;
      if (topic.deleting) continue;
      if (Date.now() >= topic.endedAt + ctx.topicTtlMs) {
        void runTopicCleanup(ctx, sessionId, TOPIC_CLEANUP_MAX_RETRIES);
      }
    }
  }, sweepMs);
  if (typeof ctx.topicCleanupSweepTimer.unref === 'function') {
    ctx.topicCleanupSweepTimer.unref();
  }
}

export function clearTopicCleanupTimer(ctx: TelegramChannelInternals, sessionId: string): void {
  const timer = ctx.topicCleanupTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    ctx.topicCleanupTimers.delete(sessionId);
  }
}

export function scheduleTopicCleanup(ctx: TelegramChannelInternals, sessionId: string): void {
  if (!ctx.topicAutoDelete) return;
  const topic = ctx.topics.get(sessionId);
  if (!topic) return;

  if (topic.endedAt === null) {
    topic.endedAt = Date.now();
  }

  if (topic.cleanupScheduledAt !== null) {
    return;
  }

  const cleanupAt = topic.endedAt + ctx.topicTtlMs;
  topic.cleanupScheduledAt = cleanupAt;

  const delayMs = Math.max(0, cleanupAt - Date.now());
  if (delayMs === 0) {
    void runTopicCleanup(ctx, sessionId, TOPIC_CLEANUP_MAX_RETRIES);
    return;
  }

  clearTopicCleanupTimer(ctx, sessionId);
  const timer = setTimeout(() => {
    void runTopicCleanup(ctx, sessionId, TOPIC_CLEANUP_MAX_RETRIES);
  }, delayMs);
  ctx.topicCleanupTimers.set(sessionId, timer);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

export async function runTopicCleanup(
  ctx: TelegramChannelInternals,
  sessionId: string,
  maxRetries: number,
): Promise<void> {
  const topic = ctx.topics.get(sessionId);
  if (!topic || topic.endedAt === null || topic.deleting) return;

  if (Date.now() < topic.endedAt + ctx.topicTtlMs) {
    return;
  }

  topic.deleting = true;
  clearTopicCleanupTimer(ctx, sessionId);

  const body = {
    chat_id: ctx.config.groupChatId,
    message_thread_id: topic.topicId,
  };

  try {
    try {
      await ctx.tgApi('closeForumTopic', body);
    } catch (e) {
      if (!isIgnorableTopicDeleteError(e)) {
        throw e;
      }
    }

    await ctx.tgApi('deleteForumTopic', body);
    ctx.topics.delete(sessionId);
    ctx.topicPersistence.save(ctx.topics);
  } catch (e) {
    if (isIgnorableTopicDeleteError(e)) {
      ctx.topics.delete(sessionId);
      ctx.topicPersistence.save(ctx.topics);
    } else {
      log.error({ component: 'telegram', operation: 'topicCleanupFailed', sessionId, attributes: { error: String(ctx.redactError(e)) } });
      topic.cleanupRetries++;
      if (topic.cleanupRetries > maxRetries) {
        log.warn({ component: 'telegram', operation: 'topicCleanupMaxRetries', sessionId, attributes: { maxRetries } });
        ctx.topics.delete(sessionId);
        ctx.topicPersistence.save(ctx.topics);
        return;
      }
      topic.deleting = false;
      topic.cleanupScheduledAt = null;
      const timer = setTimeout(() => {
        void runTopicCleanup(ctx, sessionId, maxRetries);
      }, TOPIC_CLEANUP_RETRY_MS);
      ctx.topicCleanupTimers.set(sessionId, timer);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    }
  }
}

export function isIgnorableTopicDeleteError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not found|message thread|topic.*(?:closed|deleted)|forum topic|TOPIC_ID_INVALID/i.test(message);
}
