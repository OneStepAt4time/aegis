/**
 * channels/telegram/telegram-status-handler.ts — Status event routing.
 *
 * Handles all `status.*`, `swarm.*`, and `session.*` status events.
 */

import type { SessionEventPayload } from '../types.js';
import { esc, bold, code, type StyledMessage } from '../telegram-style.js';
import type { TelegramChannelInternals } from './types.js';
import {
  truncate,
  shortPath,
  parseOptions,
  safeCallbackData,
  md2html,
} from './formatter.js';
import {
  sendImmediate,
  flushReads,
  flushQueue,
} from './telegram-sender.js';

export async function handleOnStatusChange(
  ctx: TelegramChannelInternals & { sendStyled(sessionId: string, styled: any): Promise<number | null> },
  payload: SessionEventPayload,
): Promise<void> {
  if (!ctx.topics.has(payload.session.id)) {
    if (!ctx.preTopicBuffer.has(payload.session.id)) {
      ctx.preTopicBuffer.set(payload.session.id, []);
    }
    ctx.preTopicBuffer.get(payload.session.id)!.push({ method: 'statusChange', payload });
    return;
  }

  const progress = ctx.progress.get(payload.session.id);
  const statusName = payload.event.replace('status.', '');
  if (progress) progress.currentStatus = statusName;

  switch (payload.event) {
    case 'status.permission': {
      await flushReads(ctx, payload.session.id);
      await flushQueue(ctx, payload.session.id);
      const permSummary = truncate(payload.detail, 300);
      const options = parseOptions(payload.detail);

      const buttons: Array<{ text: string; callback_data: string }> = [];

      if (options) {
        for (const opt of options) {
          buttons.push({
            text: opt.label,
            callback_data: safeCallbackData(`cb_option:${payload.session.id}:${opt.value}`),
          });
        }
      } else {
        buttons.push(
          { text: '✅ Approve', callback_data: safeCallbackData(`perm_approve:${payload.session.id}`) },
          { text: '❌ Reject', callback_data: safeCallbackData(`perm_reject:${payload.session.id}`) },
        );
      }

      const permStyled: StyledMessage = {
        text: `⚠️ Permission: ${esc(permSummary)}`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [buttons] },
      };
      await ctx.sendStyled(payload.session.id, permStyled);
      break;
    }

    case 'status.idle':
    case 'status.working':
      break;

    case 'status.question': {
      await flushReads(ctx, payload.session.id);
      await flushQueue(ctx, payload.session.id);
      const questionText = esc(truncate(payload.detail, 400));
      const options = parseOptions(payload.detail);

      const buttons: Array<{ text: string; callback_data: string }> = [];

      if (options) {
        for (const opt of options) {
          buttons.push({
            text: opt.label,
            callback_data: safeCallbackData(`cb_option:${payload.session.id}:${opt.value}`),
          });
        }
        if (buttons.length < 4) {
          buttons.push({ text: '🤷 Skip', callback_data: safeCallbackData(`cb_skip:${payload.session.id}`) });
        }
      } else {
        buttons.push(
          { text: '✅ Yes', callback_data: safeCallbackData(`cb_yes:${payload.session.id}`) },
          { text: '❌ No', callback_data: safeCallbackData(`cb_no:${payload.session.id}`) },
          { text: '🤷 Skip', callback_data: safeCallbackData(`cb_skip:${payload.session.id}`) },
        );
      }

      const qStyled: StyledMessage = {
        text: `❓ ${questionText}`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [buttons] },
      };
      await ctx.sendStyled(payload.session.id, qStyled);
      break;
    }

    case 'status.plan': {
      await flushReads(ctx, payload.session.id);
      await flushQueue(ctx, payload.session.id);
      const planLines = payload.detail.split('\n');
      const planSummary = md2html(truncate(planLines[0] || payload.detail, 200));
      const planBody = planLines.length > 1
        ? `\n<blockquote expandable>${md2html(planLines.slice(1).join('\n'))}</blockquote>`
        : '';

      const planStyled: StyledMessage = {
        text: `📋 ${planSummary}${planBody}`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '▶ Execute', callback_data: safeCallbackData(`plan_exec:${payload.session.id}`) },
              { text: '⚡ Execute All', callback_data: safeCallbackData(`plan_exec_all:${payload.session.id}`) },
              { text: '❌ Cancel', callback_data: safeCallbackData(`plan_cancel:${payload.session.id}`) },
            ],
          ],
        },
      };
      await ctx.sendStyled(payload.session.id, planStyled);
      break;
    }

    case 'swarm.teammate_spawned': {
      await flushReads(ctx, payload.session.id);
      const teammateName = (payload.meta?.teammateName as string) || 'unknown';
      const teammateId = (payload.meta?.teammateWindowId as string) || '';
      const label = `${bold(teammateName)}${teammateId ? `  ${code(teammateId)}` : ''}`;
      await sendImmediate(ctx, payload.session.id, `🔧 Teammate ${label} spawned`);
      break;
    }

    case 'swarm.teammate_finished': {
      await flushReads(ctx, payload.session.id);
      const teammateName = (payload.meta?.teammateName as string) || 'unknown';
      await sendImmediate(ctx, payload.session.id, `✅ Teammate ${bold(teammateName)} finished`);
      break;
    }
    case 'session.awaiting_approval': {
      const sessionName = esc(payload.session.name || payload.session.id.slice(0, 8));
      const workDir = esc(shortPath(payload.session.workDir));
      const approveStyled: StyledMessage = {
        text: `🔐 <b>Session Approval Required</b>\n\nSession ${bold(sessionName)} in ${code(workDir)} is waiting for your approval.`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve', callback_data: safeCallbackData(`session_approve:${payload.session.id}`) },
            { text: '❌ Reject', callback_data: safeCallbackData(`session_reject:${payload.session.id}`) },
          ]],
        },
      };
      await ctx.sendStyled(payload.session.id, approveStyled);
      break;
    }

    case 'session.approved': {
      await sendImmediate(ctx, payload.session.id, `✅ Session ${bold(esc(payload.session.name || payload.session.id.slice(0, 8)))} approved`);
      break;
    }

    case 'session.rejected': {
      await sendImmediate(ctx, payload.session.id, `❌ Session ${bold(esc(payload.session.name || payload.session.id.slice(0, 8)))} rejected`);
      break;
    }
  }
}
