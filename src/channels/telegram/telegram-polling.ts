/**
 * channels/telegram/telegram-polling.ts — Telegram long-polling and update handling.
 */

import { esc } from '../telegram-style.js';
import { StructuredLogger } from '../../logger.js';

import type { TelegramChannelInternals } from './types.js';
import { sleep, sendImmediate, removeReplyMarkup } from './telegram-sender.js';

const log = new StructuredLogger();

// ── Poll loop ─────────────────────────────────────────────────────────────

export async function pollLoop(ctx: TelegramChannelInternals): Promise<void> {
  while (ctx.polling) {
    try {
      const updates = (await ctx.tgApi('getUpdates', {
        offset: ctx.pollOffset,
        timeout: 5,
        allowed_updates: ['message', 'callback_query'],
      })) as Array<{ update_id: number; message?: unknown; callback_query?: unknown }>;

      // Reset backoff on successful response
      ctx.pollBackoffMs = 1_000;

      if (Array.isArray(updates)) {
        for (const update of updates) {
          ctx.pollOffset = update.update_id + 1;
          await handleUpdate(ctx, update);
        }
      }
    } catch (e) {
      log.error({ component: 'telegram', operation: 'pollError', attributes: { error: String(ctx.redactError(e)) } });
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
      const backoffMs = Math.min(ctx.pollBackoffMs, 30_000);
      log.info({ component: 'telegram', operation: 'pollBackoff', attributes: { backoffMs } });
      await sleep(backoffMs);
      ctx.pollBackoffMs = Math.min(backoffMs * 2, 30_000);
    }
  }
}

// ── Update handling ───────────────────────────────────────────────────────

async function handleUpdate(
  ctx: TelegramChannelInternals,
  update: { message?: unknown; callback_query?: unknown },
): Promise<void> {
  // Handle callback queries from inline buttons
  if (update.callback_query) {
    await handleCallbackQuery(ctx, update.callback_query);
    return;
  }

  const msg = update.message as {
    text?: string;
    message_thread_id?: number;
    from?: { is_bot?: boolean; id?: number; first_name?: string };
  } | undefined;

  if (!msg?.text || !msg.message_thread_id || msg.from?.is_bot) return;

  // Issue #348/#1087: Check user against allowlist
  if (ctx.config.allowedUserIds.length > 0) {
    const userId = msg.from?.id;
    if (!userId || !ctx.config.allowedUserIds.includes(userId)) {
      const name = msg.from?.first_name ?? 'Unknown';
      log.warn({ component: 'telegram', operation: 'rejectUnauthorizedUser', attributes: { userName: name, userId: userId ?? 'no id' } });
      // Send warning in the topic
      for (const [, topic] of ctx.topics) {
        if (topic.topicId === msg.message_thread_id) {
          await sendImmediate(ctx, topic.sessionId, `⛔ Unauthorized: ${esc(name)} is not in the allowed users list`);
          break;
        }
      }
      return;
    }
  } else {
    // Issue #1087: tgAllowedUsers is empty — reject ALL users when bot is configured
    // Empty allowlist without explicit opt-in is a security risk
    const name = msg.from?.first_name ?? 'Unknown';
    const userId = msg.from?.id ?? 'no id';
    log.error({ component: 'telegram', operation: 'emptyAllowlist', attributes: { userName: name, userId } });
    for (const [, topic] of ctx.topics) {
      if (topic.topicId === msg.message_thread_id) {
        await sendImmediate(ctx, topic.sessionId, `⛔ Telegram access disabled: tgAllowedUsers is empty. Contact the Aegis administrator to add your Telegram user ID to tgAllowedUsers.`);
        break;
      }
    }
    return;
  }

  for (const [sessionId, topic] of ctx.topics) {
    if (topic.topicId === msg.message_thread_id) {
      const text = msg.text.trim().toLowerCase();
      const raw = msg.text.trim();

      if (text === 'approve' || text === 'y' || text === 'yes') {
        await ctx.onInbound?.({ sessionId, action: 'approve' });
      } else if (text === 'reject' || text === 'n' || text === 'no') {
        await ctx.onInbound?.({ sessionId, action: 'reject' });
      } else if (text === 'escape' || text === 'esc') {
        await ctx.onInbound?.({ sessionId, action: 'escape' });
      } else if (text === 'kill' || text === 'stop') {
        await ctx.onInbound?.({ sessionId, action: 'kill' });
      } else if (raw.startsWith('/')) {
        await ctx.onInbound?.({ sessionId, action: 'command', text: raw });
      } else {
        await ctx.onInbound?.({ sessionId, action: 'message', text: raw });
      }
      break;
    }
  }
}

// ── Callback query handling ───────────────────────────────────────────────

async function handleCallbackQuery(ctx: TelegramChannelInternals, cbQuery: unknown): Promise<void> {
  const cb = cbQuery as {
    id: string;
    data?: string;
    from?: { id?: number; first_name?: string };
    message?: { message_id?: number; message_thread_id?: number };
  };

  if (!cb.data || !cb.message?.message_thread_id) return;

  // Issue #348: Check user against allowlist for callbacks too
  if (ctx.config.allowedUserIds.length > 0) {
    const userId = cb.from?.id;
    if (!userId || !ctx.config.allowedUserIds.includes(userId)) {
      const name = cb.from?.first_name ?? 'Unknown';
      log.warn({ component: 'telegram', operation: 'rejectUnauthorizedCallback', attributes: { userName: name, userId: userId ?? 'no id' } });
      try {
        await ctx.tgApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '⛔ You are not authorized to use this bot',
          show_alert: true,
        });
      } catch { /* non-critical */ }
      return;
    }
  }

  // Answer the callback to remove loading state
  try {
    await ctx.tgApi('answerCallbackQuery', { callback_query_id: cb.id });
  } catch { /* non-critical */ }

  // Route callback to the right session
  for (const [sessionId, topic] of ctx.topics) {
    if (topic.topicId === cb.message.message_thread_id) {
      const data = cb.data;

      if (data.startsWith('perm_approve:')) {
        await ctx.onInbound?.({ sessionId, action: 'approve' });
        if (cb.message.message_id) {
          await removeReplyMarkup(ctx, sessionId, cb.message.message_id);
        }
      } else if (data.startsWith('perm_reject:')) {
        await ctx.onInbound?.({ sessionId, action: 'reject' });
        if (cb.message.message_id) {
          await removeReplyMarkup(ctx, sessionId, cb.message.message_id);
        }
      } else if (data.startsWith('session_approve:')) {
        await ctx.onInbound?.({ sessionId, action: 'session_approve', actor: { type: 'telegram' as const, userId: cb.from?.id ?? 0, firstName: cb.from?.first_name ?? 'Unknown' } });
        if (cb.message.message_id) {
          await removeReplyMarkup(ctx, sessionId, cb.message.message_id);
        }
      } else if (data.startsWith('session_reject:')) {
        await ctx.onInbound?.({ sessionId, action: 'session_reject', actor: { type: 'telegram' as const, userId: cb.from?.id ?? 0, firstName: cb.from?.first_name ?? 'Unknown' } });
        if (cb.message.message_id) {
          await removeReplyMarkup(ctx, sessionId, cb.message.message_id);
        }
      } else if (data.startsWith('cb_option:')) {
        const optParts = data.split(':');
        const optValue = optParts.slice(2).join(':');
        // Issue #348: Validate option value is numeric
        if (!/^\d+$/.test(optValue)) {
          log.warn({ component: 'telegram', operation: 'rejectNonNumericOption', attributes: { value: optValue } });
          break;
        }
        await ctx.onInbound?.({ sessionId, action: 'message', text: optValue });
        if (cb.message.message_id) {
          await removeReplyMarkup(ctx, sessionId, cb.message.message_id);
        }
      } else if (data.startsWith('cb_yes:')) {
        await ctx.onInbound?.({ sessionId, action: 'message', text: 'yes' });
        if (cb.message.message_id) {
          await removeReplyMarkup(ctx, sessionId, cb.message.message_id);
        }
      } else if (data.startsWith('cb_no:')) {
        await ctx.onInbound?.({ sessionId, action: 'message', text: 'no' });
        if (cb.message.message_id) {
          await removeReplyMarkup(ctx, sessionId, cb.message.message_id);
        }
      } else if (data.startsWith('cb_skip:')) {
        await ctx.onInbound?.({ sessionId, action: 'message', text: 'skip' });
        if (cb.message.message_id) {
          await removeReplyMarkup(ctx, sessionId, cb.message.message_id);
        }
      } else if (data.startsWith('plan_exec:')) {
        await ctx.onInbound?.({ sessionId, action: 'message', text: 'Execute the plan step by step' });
        if (cb.message.message_id) {
          await removeReplyMarkup(ctx, sessionId, cb.message.message_id);
        }
      } else if (data.startsWith('plan_exec_all:')) {
        await ctx.onInbound?.({ sessionId, action: 'message', text: 'Execute all phases of the plan' });
        if (cb.message.message_id) {
          await removeReplyMarkup(ctx, sessionId, cb.message.message_id);
        }
      } else if (data.startsWith('plan_cancel:')) {
        await ctx.onInbound?.({ sessionId, action: 'escape' });
        if (cb.message.message_id) {
          await removeReplyMarkup(ctx, sessionId, cb.message.message_id);
        }
      } else {
        // Generic callback → forward as command
        await ctx.onInbound?.({ sessionId, action: 'command', text: data });
      }
      break;
    }
  }
}
