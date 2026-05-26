/**
 * channels/telegram/telegram-message-handler.ts — Message event routing.
 *
 * Handles all `message.*` events for a TelegramChannel session.
 */

import type { SessionEventPayload } from '../types.js';
import { esc, bold, code, italic, quickUpdate, alert as styleAlert } from '../telegram-style.js';
import type { TelegramChannelInternals } from './types.js';
import {
  truncate,
  formatTimestamp,
  formatAssistantMessage,
  parseToolUse,
  formatToolResult,
  formatProgressCard,
} from './formatter.js';
import {
  queueMessage,
  flushReads,
  addPendingRead,
  editMessage,
  sendImmediate,
} from './telegram-sender.js';

export async function handleOnMessage(
  ctx: TelegramChannelInternals & { sendStyled(sessionId: string, styled: any): Promise<number | null> },
  payload: SessionEventPayload,
): Promise<void> {
  // Issue #46: If topic doesn't exist yet, buffer the message
  if (!ctx.topics.has(payload.session.id)) {
    if (!ctx.preTopicBuffer.has(payload.session.id)) {
      ctx.preTopicBuffer.set(payload.session.id, []);
    }
    ctx.preTopicBuffer.get(payload.session.id)!.push({ method: 'message', payload });
    return;
  }

  const progress = ctx.progress.get(payload.session.id);
  if (progress) progress.totalMessages++;

  switch (payload.event) {
    case 'message.user': {
      await flushReads(ctx, payload.session.id);
      const lastMsg = ctx.lastUserMessage.get(payload.session.id);
      if (lastMsg === payload.detail) break;
      ctx.lastUserMessage.set(payload.session.id, payload.detail);
      const ts = formatTimestamp(payload.timestamp);
      await queueMessage(ctx, payload.session.id, `${ts} User: ${esc(truncate(payload.detail, 200))}`, 'high');
      break;
    }

    case 'message.assistant': {
      if (progress) progress.lastMessage = truncate(payload.detail, 500);
      const formatted = formatAssistantMessage(payload.detail);
      if (formatted) {
        await queueMessage(ctx, payload.session.id, formatted, 'normal');
      }
      break;
    }

    case 'message.thinking': {
      if (ctx.config.verbose) {
        const thinking = payload.detail?.trim();
        if (thinking) {
          const truncated = truncate(thinking, 800);
          await queueMessage(
            ctx, payload.session.id,
            `💭 ${italic(esc(truncated))}`,
            'low',
          );
        }
      }
      break;
    }
    case 'message.tool_use': {
      const detail = payload.detail?.trim();
      if (!detail) break;

      const tool = parseToolUse(detail);
      ctx.pendingTool.set(payload.session.id, tool);

      if (!ctx.config.verbose) {
        const label = tool.label || tool.file || truncate(detail, 80);
        if (label) {
          await queueMessage(
            ctx, payload.session.id,
            `🛠️ Exec: ${esc(truncate(label, 150))}`,
            'normal',
          );
        }
      } else if (tool.label) {
        const toolDetail = truncate(detail, 600);
        await queueMessage(
          ctx, payload.session.id,
          '🔧 ' + code(tool.label) + '\n<pre>' + esc(toolDetail) + '</pre>',
          'low',
        );
      }

      if (progress) {
        switch (tool.category) {
          case 'read': progress.reads++; if (tool.file) progress.filesRead.push(tool.file); break;
          case 'edit': progress.edits++; if (tool.file && !progress.filesEdited.includes(tool.file)) progress.filesEdited.push(tool.file); break;
          case 'create': progress.creates++; if (tool.file && !progress.filesEdited.includes(tool.file)) progress.filesEdited.push(tool.file); break;
          case 'search': progress.searches++; break;
          case 'command': progress.commands++; break;
        }
      }
      break;
    }

    case 'message.tool_result': {
      const tool = ctx.pendingTool.get(payload.session.id);
      ctx.pendingTool.delete(payload.session.id);

      if (!ctx.config.verbose && tool) {
        const label = tool.label || tool.file || 'command';
        const summary = truncate(payload.detail?.trim() || 'done', 80);
        if (!/^(success|ok|done|completed|passed)$/i.test(payload.detail?.trim())) {
          await queueMessage(
            ctx, payload.session.id,
            `🛠️ Exec: completed; ${esc(truncate(summary, 150))}`,
            'normal',
          );
        }
        if (progress) {
          switch (tool.category) {
            case 'read': progress.reads++; if (tool.file) progress.filesRead.push(tool.file); break;
            case 'edit': progress.edits++; if (tool.file && !progress.filesEdited.includes(tool.file)) progress.filesEdited.push(tool.file); break;
            case 'create': progress.creates++; if (tool.file && !progress.filesEdited.includes(tool.file)) progress.filesEdited.push(tool.file); break;
            case 'search': progress.searches++; break;
            case 'command': progress.commands++; break;
          }
        }
        break;
      }

      const result = formatToolResult(payload.detail);

      if (result) {
        await flushReads(ctx, payload.session.id);
        if (result.isError && progress) progress.errors++;
        if (result.isError && tool?.category === 'command') {
          const styled = styleAlert(
            { title: tool.label || 'Command failed', resourceId: payload.session.name, details: truncate(payload.detail, 200) },
          );
          await ctx.sendStyled(payload.session.id, styled);
        } else {
          await queueMessage(ctx, payload.session.id, result.text, result.isError ? 'high' : 'normal');
        }
      } else if (tool && tool.label) {
        if (tool.category === 'read' && tool.file) {
          addPendingRead(ctx, payload.session.id, tool.file);
        } else {
          await flushReads(ctx, payload.session.id);
          await queueMessage(
            ctx, payload.session.id,
            `${tool.icon} ${esc(tool.label)}`,
            'low',
          );
        }
      }
      break;
    }
  }

  // Progress card every 5 messages
  if (progress && progress.totalMessages > 0 && progress.totalMessages % 5 === 0) {
    await flushReads(ctx, payload.session.id);
    const progressText = formatProgressCard(progress);
    if (progress.progressMessageId) {
      await editMessage(ctx, payload.session.id, progress.progressMessageId, progressText);
    } else {
      const msgId = await sendImmediate(ctx, payload.session.id, progressText);
      if (msgId) progress.progressMessageId = msgId;
    }
  }
}
