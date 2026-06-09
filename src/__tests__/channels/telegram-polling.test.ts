/**
 * channels/telegram-polling.test.ts — Tests for #4623.
 *
 * Targets ≥70% line coverage on src/channels/telegram/telegram-polling.ts
 * (was 1% per #4619 audit §2). Exercises the pollLoop export, which in turn
 * drives handleUpdate + handleCallbackQuery. Mocks telegram-sender so the
 * sleep backoff + sendImmediate + removeReplyMarkup + editMessage are
 * observable via call args.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../channels/telegram/telegram-sender.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
  sendImmediate: vi.fn().mockResolvedValue(42),
  removeReplyMarkup: vi.fn().mockResolvedValue(undefined),
  editMessage: vi.fn().mockResolvedValue(true),
  flushReads: vi.fn().mockResolvedValue(undefined),
  flushQueue: vi.fn().mockResolvedValue(undefined),
  queueMessage: vi.fn().mockResolvedValue(undefined),
  addPendingRead: vi.fn(),
}));

import { pollLoop } from '../../channels/telegram/telegram-polling.js';
import {
  sleep,
  sendImmediate,
  removeReplyMarkup,
  editMessage,
} from '../../channels/telegram/telegram-sender.js';
import type { TelegramChannelInternals } from '../../channels/telegram/types.js';
import type { InboundCommand } from '../../channels/types.js';

const mockedSleep = vi.mocked(sleep);
const mockedSendImmediate = vi.mocked(sendImmediate);
const mockedRemoveReplyMarkup = vi.mocked(removeReplyMarkup);
const mockedEditMessage = vi.mocked(editMessage);

type Ctx = TelegramChannelInternals & { onInbound: ((cmd: InboundCommand) => Promise<void>) | null };
type ScriptedResponse = { kind: 'updates'; updates: any[] } | { kind: 'error'; error: Error };

function makeCtx(opts: {
  allowedUserIds?: number[];
  responses?: ScriptedResponse[];
  topicExists?: boolean;
} = {}): Ctx & { _inboundCalls: InboundCommand[] } {
  const allowedUserIds = opts.allowedUserIds ?? [42, 100];
  const responses = opts.responses ?? [];
  const topicExists = opts.topicExists ?? true;
  const inboundCalls: InboundCommand[] = [];
  const onInbound = vi.fn(async (cmd: InboundCommand) => {
    inboundCalls.push(cmd);
  });
  const ctx: any = {
    config: { botToken: 't', groupChatId: 'g', allowedUserIds, verbose: false },
    topics: new Map(),
    progress: new Map(),
    messageQueue: new Map(),
    lastSent: new Map(),
    flushTimers: new Map(),
    pendingTool: new Map(),
    inFlightCount: new Map(),
    pendingReads: new Map(),
    readTimer: new Map(),
    preTopicBuffer: new Map(),
    lastUserMessage: new Map(),
    rateLimitUntil: 0,
    pollOffset: 0,
    polling: true,
    pollBackoffMs: 1_000,
    onInbound,
    topicCleanupTimers: new Map(),
    topicCleanupSweepTimer: null,
    topicTtlMs: 86400000,
    topicAutoDelete: true,
    topicPersistence: {},
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    deliveryFailCount: 0,
    pollLoopPromise: Promise.resolve(),
    trackSuccess: vi.fn(),
    trackFailure: vi.fn(),
    redactError: vi.fn((e: unknown) => e),
    _inboundCalls: inboundCalls,
  };
  if (topicExists) {
    ctx.topics.set('s1', {
      sessionId: 's1', topicId: 1, displayName: 's1',
      endedAt: null, cleanupScheduledAt: null, cleanupRetries: 0, deleting: false,
    });
  }
  let i = 0;
  ctx.tgApi = vi.fn(async (method: string) => {
    if (method === 'getUpdates') {
      if (i >= responses.length) {
        ctx.polling = false;
        return [];
      }
      // Mark the loop for exit *after* the last response is processed,
      // so a final error's catch (which sets pollBackoffMs) is not
      // undone by a trailing successful getUpdates that resets the backoff.
      const isLast = i === responses.length - 1;
      const r = responses[i++];
      if (isLast) ctx.polling = false;
      if (r.kind === 'updates') return r.updates;
      throw r.error;
    }
    if (method === 'answerCallbackQuery') return true;
    return true;
  });
  return ctx as Ctx & { _inboundCalls: InboundCommand[] };
}

function makeMessageUpdate(text: string, userId: number, isBot = false) {
  return {
    update_id: 100,
    message: {
      text,
      message_thread_id: 1,
      from: { id: userId, first_name: 'Alice', is_bot: isBot },
    },
  };
}

function makeCallbackUpdate(data: string, userId: number, cbId = 'cb-1', messageId = 200) {
  return {
    update_id: 100,
    callback_query: {
      id: cbId,
      data,
      from: { id: userId, first_name: 'Alice' },
      message: { message_id: messageId, message_thread_id: 1 },
    },
  };
}

describe('pollLoop (#4623)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('lifecycle', () => {
    it('processes a message update and advances pollOffset', async () => {
      const ctx = makeCtx({
        responses: [{ kind: 'updates', updates: [makeMessageUpdate('approve', 42)] }],
      });
      await pollLoop(ctx);
      expect(ctx.pollOffset).toBe(101);
      expect(ctx._inboundCalls).toEqual([{ sessionId: 's1', action: 'approve' }]);
    });

    it('resets pollBackoffMs to 1000 after a successful getUpdates', async () => {
      const ctx = makeCtx({
        responses: [
          { kind: 'error', error: new Error('transient network error') },
          { kind: 'updates', updates: [] },
        ],
      });
      ctx.pollBackoffMs = 8_000;
      await pollLoop(ctx);
      expect(ctx.pollBackoffMs).toBe(1_000);
    });

    it('doubles pollBackoffMs across consecutive transient errors and sleeps with the prior value', async () => {
      const ctx = makeCtx({
        responses: [
          { kind: 'error', error: new Error('HTTP 502') },
          { kind: 'error', error: new Error('HTTP 502') },
          { kind: 'error', error: new Error('HTTP 502') },
        ],
      });
      await pollLoop(ctx);
      expect(mockedSleep).toHaveBeenNthCalledWith(1, 1_000);
      expect(mockedSleep).toHaveBeenNthCalledWith(2, 2_000);
      expect(mockedSleep).toHaveBeenNthCalledWith(3, 4_000);
      expect(ctx.pollBackoffMs).toBe(8_000);
    });

    it('caps the backoff at 30_000 ms', async () => {
      const responses: ScriptedResponse[] = [];
      for (let i = 0; i < 6; i++) responses.push({ kind: 'error', error: new Error('err') });
      const ctx = makeCtx({ responses });
      await pollLoop(ctx);
      const calls = mockedSleep.mock.calls.map(c => c[0]);
      expect(calls).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000]);
      expect(ctx.pollBackoffMs).toBe(30_000);
    });

    it('exits the loop when ctx.polling flips to false', async () => {
      const ctx = makeCtx({
        responses: [{ kind: 'updates', updates: [makeMessageUpdate('approve', 42)] }],
      });
      const original = ctx.tgApi;
      let calls = 0;
      (ctx as any).tgApi = vi.fn(async (method: string) => {
        calls++;
        if (calls === 2) {
          ctx.polling = false;
          return [];
        }
        return original(method, {});
      });
      await pollLoop(ctx);
      expect(ctx.polling).toBe(false);
    });

    it('processes multiple updates in a single batch before fetching the next', async () => {
      const ctx = makeCtx({
        responses: [
          {
            kind: 'updates',
            updates: [
              makeMessageUpdate('approve', 42),
              makeMessageUpdate('hello world', 42),
            ].map((u, i) => ({ ...u, update_id: 100 + i })),
          },
        ],
      });
      await pollLoop(ctx);
      expect(ctx.pollOffset).toBe(102);
      expect(ctx._inboundCalls).toEqual([
        { sessionId: 's1', action: 'approve' },
        { sessionId: 's1', action: 'message', text: 'hello world' },
      ]);
    });
  });

  describe('command dispatch (Issue #348, #1087)', () => {
    it.each([
      ['approve', 'approve'],
      ['y', 'approve'],
      ['yes', 'approve'],
      ['reject', 'reject'],
      ['n', 'reject'],
      ['no', 'reject'],
      ['escape', 'escape'],
      ['esc', 'escape'],
      ['kill', 'kill'],
      ['stop', 'kill'],
    ])('"%s" maps to action="%s"', async (input, expectedAction) => {
      const ctx = makeCtx({
        responses: [{ kind: 'updates', updates: [makeMessageUpdate(input, 42)] }],
      });
      await pollLoop(ctx);
      expect(ctx._inboundCalls).toEqual([{ sessionId: 's1', action: expectedAction }]);
    });

    it('"/cmd" maps to action="command" with the raw text', async () => {
      const ctx = makeCtx({
        responses: [{ kind: 'updates', updates: [makeMessageUpdate('/plan', 42)] }],
      });
      await pollLoop(ctx);
      expect(ctx._inboundCalls).toEqual([{ sessionId: 's1', action: 'command', text: '/plan' }]);
    });

    it('plain text maps to action="message" with the raw text', async () => {
      const ctx = makeCtx({
        responses: [{ kind: 'updates', updates: [makeMessageUpdate('hello there', 42)] }],
      });
      await pollLoop(ctx);
      expect(ctx._inboundCalls).toEqual([{ sessionId: 's1', action: 'message', text: 'hello there' }]);
    });

    it('ignores messages from bots (is_bot=true)', async () => {
      const ctx = makeCtx({
        responses: [{ kind: 'updates', updates: [makeMessageUpdate('approve', 42, true)] }],
      });
      await pollLoop(ctx);
      expect(ctx._inboundCalls).toEqual([]);
    });

    it('ignores messages without text or message_thread_id', async () => {
      const ctx = makeCtx({
        responses: [
          {
            kind: 'updates',
            updates: [{ update_id: 100, message: { text: 'no-thread', from: { id: 42 } } }],
          },
        ],
      });
      await pollLoop(ctx);
      expect(ctx._inboundCalls).toEqual([]);
    });
  });

  describe('allowlist enforcement (Issue #348, #1087)', () => {
    it('rejects a user not in the allowlist and sends a warning', async () => {
      const ctx = makeCtx({
        allowedUserIds: [42],
        responses: [{ kind: 'updates', updates: [makeMessageUpdate('approve', 999)] }],
      });
      await pollLoop(ctx);
      expect(ctx._inboundCalls).toEqual([]);
      expect(mockedSendImmediate).toHaveBeenCalledWith(
        ctx, 's1', expect.stringContaining('Unauthorized:'),
      );
    });

    it('rejects ALL users when the allowlist is empty (security default)', async () => {
      const ctx = makeCtx({
        allowedUserIds: [],
        responses: [{ kind: 'updates', updates: [makeMessageUpdate('approve', 42)] }],
      });
      await pollLoop(ctx);
      expect(ctx._inboundCalls).toEqual([]);
      expect(mockedSendImmediate).toHaveBeenCalledWith(
        ctx, 's1', expect.stringContaining('Telegram access disabled'),
      );
    });

    it('rejects a callback from a user not in the allowlist via answerCallbackQuery', async () => {
      const ctx = makeCtx({
        allowedUserIds: [42],
        responses: [{ kind: 'updates', updates: [makeCallbackUpdate('perm_approve:s1', 999)] }],
      });
      await pollLoop(ctx);
      expect(ctx._inboundCalls).toEqual([]);
      expect(ctx.tgApi).toHaveBeenCalledWith('answerCallbackQuery', expect.objectContaining({
        text: expect.stringContaining('not authorized'),
        show_alert: true,
      }));
    });
  });

  describe('callback dispatch', () => {
    it('perm_approve routes to action="approve" and clears the inline keyboard', async () => {
      const ctx = makeCtx({
        responses: [{ kind: 'updates', updates: [makeCallbackUpdate('perm_approve:s1', 42)] }],
      });
      await pollLoop(ctx);
      expect(ctx._inboundCalls).toEqual([{ sessionId: 's1', action: 'approve' }]);
      expect(mockedRemoveReplyMarkup).toHaveBeenCalledWith(ctx, 's1', 200);
    });

    it('session_approve routes to action="session_approve" with actor info', async () => {
      const ctx = makeCtx({
        responses: [{ kind: 'updates', updates: [makeCallbackUpdate('session_approve:s1', 42)] }],
      });
      await pollLoop(ctx);
      expect(ctx._inboundCalls).toHaveLength(1);
      const call = ctx._inboundCalls[0];
      expect(call.action).toBe('session_approve');
      expect(call.actor).toEqual({ type: 'telegram', userId: 42, firstName: 'Alice' });
      expect(mockedEditMessage).toHaveBeenCalledWith(ctx, 's1', 200, expect.stringContaining('Approved by Alice'));
    });

    it('cb_option with a numeric value routes to action="message" with the value as text', async () => {
      const ctx = makeCtx({
        responses: [{ kind: 'updates', updates: [makeCallbackUpdate('cb_option:s1:5', 42)] }],
      });
      await pollLoop(ctx);
      expect(ctx._inboundCalls).toEqual([{ sessionId: 's1', action: 'message', text: '5' }]);
    });

    it('cb_option with a non-numeric value is REJECTED (no onInbound call)', async () => {
      const ctx = makeCtx({
        responses: [{ kind: 'updates', updates: [makeCallbackUpdate('cb_option:s1:<script>', 42)] }],
      });
      await pollLoop(ctx);
      expect(ctx._inboundCalls).toEqual([]);
      expect(mockedEditMessage).not.toHaveBeenCalled();
    });

    it('plan_cancel routes to action="escape"', async () => {
      const ctx = makeCtx({
        responses: [{ kind: 'updates', updates: [makeCallbackUpdate('plan_cancel:s1', 42)] }],
      });
      await pollLoop(ctx);
      expect(ctx._inboundCalls).toEqual([{ sessionId: 's1', action: 'escape' }]);
    });

    it('cb_skip routes to action="message" with text="skip"', async () => {
      const ctx = makeCtx({
        responses: [{ kind: 'updates', updates: [makeCallbackUpdate('cb_skip:s1', 42)] }],
      });
      await pollLoop(ctx);
      expect(ctx._inboundCalls).toEqual([{ sessionId: 's1', action: 'message', text: 'skip' }]);
    });

    it('unknown callback data falls through to action="command" with the raw data', async () => {
      const ctx = makeCtx({
        responses: [{ kind: 'updates', updates: [makeCallbackUpdate('custom_button_data', 42)] }],
      });
      await pollLoop(ctx);
      expect(ctx._inboundCalls).toEqual([{ sessionId: 's1', action: 'command', text: 'custom_button_data' }]);
    });
  });
});
