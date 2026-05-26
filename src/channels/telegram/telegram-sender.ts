/**
 * channels/telegram/telegram-sender.ts — Message sending, editing, queueing, and read grouping.
 */

import {
  esc,
  bold,
  code,
} from '../telegram-style.js';
import type { StyledMessage } from '../telegram-style.js';
import { StructuredLogger } from '../../logger.js';

import type { TelegramChannelInternals, QueuedItem } from './types.js';
import { shortPath } from './formatter.js';

const log = new StructuredLogger();

// ── Helpers ────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Styled Message Support ─────────────────────────────────────────────────

/**
 * Send a StyledMessage (from telegram-style.ts) with inline keyboard support.
 * This is the primary way to send the 6 standard message types.
 */
export async function sendStyled(
  ctx: TelegramChannelInternals,
  sessionId: string,
  styled: StyledMessage,
): Promise<number | null> {
  await flushQueue(ctx, sessionId);
  return sendStyledToTopic(ctx, sessionId, styled);
}

async function sendStyledToTopic(
  ctx: TelegramChannelInternals,
  sessionId: string,
  styled: StyledMessage,
): Promise<number | null> {
  const topic = ctx.topics.get(sessionId);
  if (!topic) return null;

  const truncated = styled.text.length > 4096 ? styled.text.slice(0, 4096) + '\n…' : styled.text;

  // Rate limit: 3s between messages per session
  const lastSentTime = ctx.lastSent.get(sessionId) || 0;
  const now = Date.now();
  const waitMs = Math.max(0, 3000 - (now - lastSentTime));
  if (waitMs > 0) await sleep(waitMs);

  const body: Record<string, unknown> = {
    chat_id: ctx.config.groupChatId,
    message_thread_id: topic.topicId,
    text: truncated,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (styled.reply_markup) {
    body.reply_markup = JSON.stringify(styled.reply_markup);
  }

  try {
    const result = (await ctx.tgApi('sendMessage', body)) as { message_id: number };
    ctx.lastSent.set(sessionId, Date.now());
    ctx.trackSuccess();
    return result.message_id;
  } catch {
    // Fallback: strip HTML + buttons, send plain
    try {
      const plain = truncated
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const result = (await ctx.tgApi('sendMessage', {
        chat_id: ctx.config.groupChatId,
        message_thread_id: topic.topicId,
        text: plain,
        disable_web_page_preview: true,
      })) as { message_id: number };
      ctx.lastSent.set(sessionId, Date.now());
      ctx.trackSuccess();
      return result.message_id;
    } catch (e) {
      log.error({ component: 'telegram', operation: 'sendStyledFailed', attributes: { topicId: topic.topicId, error: String(ctx.redactError(e)) } });
      ctx.trackFailure(e);
      return null;
    }
  }
}

/**
 * Edit a message in-place with a StyledMessage (for progress updates with buttons).
 */
export async function editStyled(
  ctx: TelegramChannelInternals,
  sessionId: string,
  messageId: number,
  styled: StyledMessage,
): Promise<boolean> {
  const topic = ctx.topics.get(sessionId);
  if (!topic) return false;

  const truncated = styled.text.length > 4096 ? styled.text.slice(0, 4096) + '\n…' : styled.text;
  const body: Record<string, unknown> = {
    chat_id: ctx.config.groupChatId,
    message_id: messageId,
    text: truncated,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (styled.reply_markup) {
    body.reply_markup = JSON.stringify(styled.reply_markup);
  }

  try {
    await ctx.tgApi('editMessageText', body);
    return true;
  } catch { /* styled edit failed — message deleted or too old */
    return false;
  }
}

// ── Edit in-place (for progress) ────────────────────────────────────────────

export async function editMessage(
  ctx: TelegramChannelInternals,
  sessionId: string,
  messageId: number,
  text: string,
): Promise<boolean> {
  const topic = ctx.topics.get(sessionId);
  if (!topic) return false;

  const truncated = text.length > 4096 ? text.slice(0, 4096) + '\n…' : text;
  try {
    await ctx.tgApi('editMessageText', {
      chat_id: ctx.config.groupChatId,
      message_id: messageId,
      text: truncated,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    return true;
  } catch {
    // Edit can fail if message is too old or unchanged — not critical
    return false;
  }
}

// ── Send / Queue ──────────────────────────────────────────────────────────

export async function sendImmediate(
  ctx: TelegramChannelInternals,
  sessionId: string,
  text: string,
): Promise<number | null> {
  await flushQueue(ctx, sessionId);
  return sendToTopic(ctx, sessionId, text);
}

async function sendToTopic(
  ctx: TelegramChannelInternals,
  sessionId: string,
  text: string,
): Promise<number | null> {
  const topic = ctx.topics.get(sessionId);
  if (!topic) return null;

  const truncated = text.length > 4096 ? text.slice(0, 4096) + '\n…' : text;

  // Rate limit: 3s between messages per session
  const lastSent = ctx.lastSent.get(sessionId) || 0;
  const now = Date.now();
  const waitMs = Math.max(0, 3000 - (now - lastSent));
  if (waitMs > 0) await sleep(waitMs);

  // Issue #89 L12: Track in-flight count
  ctx.inFlightCount.set(sessionId, (ctx.inFlightCount.get(sessionId) || 0) + 1);

  // Try HTML first, fallback to plain text
  try {
    const result = (await ctx.tgApi('sendMessage', {
      chat_id: ctx.config.groupChatId,
      message_thread_id: topic.topicId,
      text: truncated,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    })) as { message_id: number };
    ctx.lastSent.set(sessionId, Date.now());
    decrementInFlight(ctx, sessionId);
    ctx.trackSuccess();
    return result.message_id;
  } catch {
    // Fallback: strip HTML, send plain
    try {
      const plain = truncated
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const result = (await ctx.tgApi('sendMessage', {
        chat_id: ctx.config.groupChatId,
        message_thread_id: topic.topicId,
        text: plain,
        disable_web_page_preview: true,
      })) as { message_id: number };
      ctx.lastSent.set(sessionId, Date.now());
      decrementInFlight(ctx, sessionId);
      ctx.trackSuccess();
      return result.message_id;
    } catch (e) {
      log.error({ component: 'telegram', operation: 'sendFailed', attributes: { topicId: topic.topicId, error: String(ctx.redactError(e)) } });
      decrementInFlight(ctx, sessionId);
      ctx.trackFailure(e);
      return null;
    }
  }
}

/** Issue #89 L12: Decrement in-flight counter, clamped to 0. */
export function decrementInFlight(ctx: TelegramChannelInternals, sessionId: string): void {
  const current = ctx.inFlightCount.get(sessionId) || 0;
  if (current <= 1) {
    ctx.inFlightCount.delete(sessionId);
  } else {
    ctx.inFlightCount.set(sessionId, current - 1);
  }
}

/** Max in-flight messages per session (Issue #89 L12). */
export const MAX_IN_FLIGHT = 10;

export async function queueMessage(
  ctx: TelegramChannelInternals,
  sessionId: string,
  text: string,
  priority: QueuedItem['priority'],
): Promise<void> {
  if (!ctx.messageQueue.has(sessionId)) {
    ctx.messageQueue.set(sessionId, []);
  }
  const queue = ctx.messageQueue.get(sessionId)!;

  // Issue #89 L12: Backpressure — if in-flight + pending exceeds max, drop oldest pending
  const inFlight = ctx.inFlightCount.get(sessionId) || 0;
  if (inFlight + queue.length >= MAX_IN_FLIGHT) {
    const dropped = queue.shift();
    log.warn({ component: 'telegram', operation: 'backpressureDrop', sessionId, attributes: { inFlight, queued: queue.length } });
    void dropped; // consumed
  }

  queue.push({ text, priority, timestamp: Date.now() });

  // High priority: flush immediately
  if (priority === 'high') {
    await flushQueue(ctx, sessionId);
    return;
  }

  // Normal/low: batch for 3 seconds
  if (!ctx.flushTimers.has(sessionId)) {
    const timer = setTimeout(() => flushQueue(ctx, sessionId), 3000);
    ctx.flushTimers.set(sessionId, timer);
  }
}

export async function flushQueue(ctx: TelegramChannelInternals, sessionId: string): Promise<void> {
  const timer = ctx.flushTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    ctx.flushTimers.delete(sessionId);
  }

  const items = ctx.messageQueue.get(sessionId);
  if (!items || items.length === 0) return;
  ctx.messageQueue.delete(sessionId);

  // Group low-priority items together, send high/normal separately
  const groups: string[] = [];
  let lowBatch: string[] = [];

  for (const item of items) {
    if (item.priority === 'low') {
      lowBatch.push(item.text);
    } else {
      // Flush any pending low-priority batch first
      if (lowBatch.length > 0) {
        groups.push(lowBatch.join('\n'));
        lowBatch = [];
      }
      groups.push(item.text);
    }
  }
  if (lowBatch.length > 0) {
    groups.push(lowBatch.join('\n'));
  }

  for (let i = 0; i < groups.length; i++) {
    await sendToTopic(ctx, sessionId, groups[i]);
  }
}

// ── Read grouping ─────────────────────────────────────────────────────────

export function addPendingRead(ctx: TelegramChannelInternals, sessionId: string, file: string): void {
  if (!ctx.pendingReads.has(sessionId)) {
    ctx.pendingReads.set(sessionId, []);
  }
  ctx.pendingReads.get(sessionId)!.push(file);

  // Flush after 4 seconds to batch consecutive reads
  const existing = ctx.readTimer.get(sessionId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => flushReads(ctx, sessionId), 4000);
  ctx.readTimer.set(sessionId, timer);
}

export async function flushReads(ctx: TelegramChannelInternals, sessionId: string): Promise<void> {
  const timer = ctx.readTimer.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    ctx.readTimer.delete(sessionId);
  }

  const files = ctx.pendingReads.get(sessionId);
  if (!files || files.length === 0) return;
  ctx.pendingReads.delete(sessionId);

  if (files.length === 1) {
    await queueMessage(ctx, sessionId, `📖 Reading ${code(shortPath(files[0]))}`, 'low');
  } else {
    const listed = files.slice(0, 8).map(f => code(shortPath(f))).join(', ');
    const extra = files.length > 8 ? ` +${files.length - 8} more` : '';
    await queueMessage(
      ctx,
      sessionId,
      `📖 Reading ${bold(String(files.length))} files: ${listed}${extra}`,
      'low',
    );
  }
}

/**
 * Remove inline keyboard from a message after button click (one-shot actions).
 */
export async function removeReplyMarkup(
  ctx: TelegramChannelInternals,
  sessionId: string,
  messageId: number,
): Promise<void> {
  const topic = ctx.topics.get(sessionId);
  if (!topic) return;
  try {
    await ctx.tgApi('editMessageReplyMarkup', {
      chat_id: ctx.config.groupChatId,
      message_id: messageId,
      reply_markup: JSON.stringify({ inline_keyboard: [] }),
    });
  } catch { /* non-critical — message may be too old or already edited */ }
}
