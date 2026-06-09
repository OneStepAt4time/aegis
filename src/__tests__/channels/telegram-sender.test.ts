/**
 * channels/telegram-sender.test.ts — Tests for #4622.
 *
 * Targets ≥70% line coverage on src/channels/telegram/telegram-sender.ts
 * (was 7% per #4619 audit §2). Uses vi.useFakeTimers() to skip the 3s
 * per-message rate limit + 3s queue flush + 4s read-grouping timers
 * without real wall-clock waits. The ctx.tgApi mock is scripted to
 * return / throw to exercise the HTML→plain fallback and the
 * "both fail" branch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  sleep,
  sendStyled,
  editStyled,
  editMessage,
  sendImmediate,
  decrementInFlight,
  MAX_IN_FLIGHT,
  queueMessage,
  flushQueue,
  addPendingRead,
  flushReads,
  removeReplyMarkup,
} from '../../channels/telegram/telegram-sender.js';
import type { TelegramChannelInternals } from '../../channels/telegram/types.js';
import type { StyledMessage } from '../../channels/telegram-style.js';

function makeCtx(opts: { topicExists?: boolean; tgApiResult?: any; tgApiError?: Error } = {}): TelegramChannelInternals & { tgApiCallCount: number } {
  const topicExists = opts.topicExists ?? true;
  const tgApiCallCount = 0;
  const ctx: any = {
    config: { botToken: 't', groupChatId: 'g', allowedUserIds: [], verbose: false },
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
    polling: false,
    pollBackoffMs: 1000,
    onInbound: null,
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
    tgApiCallCount,
  };
  if (topicExists) {
    ctx.topics.set('s1', {
      sessionId: 's1', topicId: 1, displayName: 's1',
      endedAt: null, cleanupScheduledAt: null, cleanupRetries: 0, deleting: false,
    });
  }
  ctx.tgApi = vi.fn(async (method: string, body: any) => {
    (ctx as any).tgApiCallCount++;
    if (opts.tgApiError) throw opts.tgApiError;
    return opts.tgApiResult ?? { message_id: 42 };
  });
  return ctx as TelegramChannelInternals & { tgApiCallCount: number };
}

const styledNoMarkup: StyledMessage = { text: 'hello world', parse_mode: 'HTML' };
const styledWithMarkup: StyledMessage = {
  text: 'pick one',
  parse_mode: 'HTML',
  reply_markup: { inline_keyboard: [[{ text: 'Yes', callback_data: 'y' }]] },
};

describe('telegram-sender (#4622)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('sleep', () => {
    it('resolves after the given delay', async () => {
      const p = sleep(100);
      vi.advanceTimersByTime(100);
      await expect(p).resolves.toBeUndefined();
    });
  });

  describe('sendStyled', () => {
    it('returns the message_id on success', async () => {
      const ctx = makeCtx({ tgApiResult: { message_id: 99 } });
      const id = await sendStyled(ctx, 's1', styledNoMarkup);
      expect(id).toBe(99);
      expect(ctx.trackSuccess).toHaveBeenCalled();
    });

    it('returns null when the topic does not exist', async () => {
      const ctx = makeCtx({ topicExists: false });
      const id = await sendStyled(ctx, 's1', styledNoMarkup);
      expect(id).toBeNull();
      expect(ctx.tgApi).not.toHaveBeenCalled();
    });

    it('sleeps for the rate-limit gap when the last send was recent', async () => {
      const ctx = makeCtx();
      ctx.lastSent.set('s1', Date.now() - 1000); // 1s ago → 2s gap remaining
      const p = sendStyled(ctx, 's1', styledNoMarkup);
      // sleep(2000) is called; advance past it
      await vi.advanceTimersByTimeAsync(2000);
      await p;
      expect(ctx.tgApi).toHaveBeenCalled();
    });

    it('truncates text longer than 4096 chars', async () => {
      const ctx = makeCtx();
      const longText = 'a'.repeat(5000);
      await sendStyled(ctx, 's1', { text: longText, parse_mode: 'HTML' });
      const call = (ctx.tgApi as any).mock.calls[0][1];
      expect(call.text.length).toBe(4098);
      expect(call.text.endsWith("\n…")).toBe(true);
      expect(call.text.startsWith("a".repeat(4096))).toBe(true);
    });

    it('falls back to plain text when HTML send throws', async () => {
      const ctx = makeCtx();
      // First call throws, second (plain) succeeds
      let n = 0;
      ctx.tgApi = vi.fn(async () => {
        n++;
        if (n === 1) throw new Error('bad html');
        return { message_id: 7 };
      });
      const id = await sendStyled(ctx, 's1', styledNoMarkup);
      expect(id).toBe(7);
      expect(n).toBe(2);
    });

    it('returns null when both HTML and plain fallbacks fail', async () => {
      const ctx = makeCtx({ tgApiError: new Error('network down') });
      const id = await sendStyled(ctx, 's1', styledNoMarkup);
      expect(id).toBeNull();
      expect(ctx.trackFailure).toHaveBeenCalled();
    });

    it('JSON-stringifies reply_markup when present', async () => {
      const ctx = makeCtx();
      await sendStyled(ctx, 's1', styledWithMarkup);
      const call = (ctx.tgApi as any).mock.calls[0][1];
      expect(typeof call.reply_markup).toBe('string');
      expect(JSON.parse(call.reply_markup)).toEqual(styledWithMarkup.reply_markup);
    });
  });

  describe('editStyled', () => {
    it('returns true on success', async () => {
      const ctx = makeCtx();
      const ok = await editStyled(ctx, 's1', 100, styledNoMarkup);
      expect(ok).toBe(true);
    });

    it('returns false when tgApi throws', async () => {
      const ctx = makeCtx({ tgApiError: new Error('edit failed') });
      const ok = await editStyled(ctx, 's1', 100, styledNoMarkup);
      expect(ok).toBe(false);
    });

    it('returns false when topic does not exist', async () => {
      const ctx = makeCtx({ topicExists: false });
      const ok = await editStyled(ctx, 's1', 100, styledNoMarkup);
      expect(ok).toBe(false);
      expect(ctx.tgApi).not.toHaveBeenCalled();
    });
  });

  describe('editMessage', () => {
    it('returns true on success', async () => {
      const ctx = makeCtx();
      const ok = await editMessage(ctx, 's1', 100, 'updated text');
      expect(ok).toBe(true);
    });

    it('returns false on failure', async () => {
      const ctx = makeCtx({ tgApiError: new Error('edit failed') });
      const ok = await editMessage(ctx, 's1', 100, 'updated');
      expect(ok).toBe(false);
    });

    it('truncates text longer than 4096 chars', async () => {
      const ctx = makeCtx();
      const longText = 'b'.repeat(5000);
      await editMessage(ctx, 's1', 100, longText);
      const call = (ctx.tgApi as any).mock.calls[0][1];
      expect(call.text.length).toBe(4098);
      expect(call.text.endsWith("\n…")).toBe(true);
    });
  });

  describe('sendImmediate', () => {
    it('returns message_id on success', async () => {
      const ctx = makeCtx({ tgApiResult: { message_id: 11 } });
      const id = await sendImmediate(ctx, 's1', 'immediate text');
      expect(id).toBe(11);
    });

    it('returns null when topic does not exist', async () => {
      const ctx = makeCtx({ topicExists: false });
      const id = await sendImmediate(ctx, 's1', 'text');
      expect(id).toBeNull();
    });

    it('falls back to plain text when HTML throws', async () => {
      const ctx = makeCtx();
      let n = 0;
      ctx.tgApi = vi.fn(async () => {
        n++;
        if (n === 1) throw new Error('bad html');
        return { message_id: 22 };
      });
      const id = await sendImmediate(ctx, 's1', 'text with <tags>');
      expect(id).toBe(22);
    });

    it('returns null and tracks failure when both attempts fail', async () => {
      const ctx = makeCtx({ tgApiError: new Error('fail') });
      const id = await sendImmediate(ctx, 's1', 'text');
      expect(id).toBeNull();
      expect(ctx.trackFailure).toHaveBeenCalled();
    });
  });

  describe('decrementInFlight / MAX_IN_FLIGHT', () => {
    it('decrements when count > 1', () => {
      const ctx = makeCtx();
      ctx.inFlightCount.set('s1', 5);
      decrementInFlight(ctx, 's1');
      expect(ctx.inFlightCount.get('s1')).toBe(4);
    });

    it('deletes the entry when count was 1', () => {
      const ctx = makeCtx();
      ctx.inFlightCount.set('s1', 1);
      decrementInFlight(ctx, 's1');
      expect(ctx.inFlightCount.has('s1')).toBe(false);
    });

    it('is a no-op when count is 0 (clamped)', () => {
      const ctx = makeCtx();
      decrementInFlight(ctx, 's1');
      expect(ctx.inFlightCount.has('s1')).toBe(false);
    });

    it('exports MAX_IN_FLIGHT = 10', () => {
      expect(MAX_IN_FLIGHT).toBe(10);
    });
  });

  describe('queueMessage + flushQueue (Issue #89 L12)', () => {
    it('high-priority messages flush immediately (no 3s timer)', async () => {
      const ctx = makeCtx();
      await queueMessage(ctx, 's1', 'urgent', 'high');
      expect(ctx.flushTimers.has('s1')).toBe(false);
      expect(ctx.messageQueue.has('s1')).toBe(false); // drained by flush
      expect(ctx.tgApi).toHaveBeenCalled();
    });

    it('normal-priority messages batch on a 3s timer', async () => {
      const ctx = makeCtx();
      await queueMessage(ctx, 's1', 'normal-1', 'normal');
      await queueMessage(ctx, 's1', 'normal-2', 'normal');
      // Timer is set; queue holds both items
      expect(ctx.flushTimers.has('s1')).toBe(true);
      expect(ctx.messageQueue.get('s1')?.length).toBe(2);
      expect(ctx.tgApi).not.toHaveBeenCalled();
    });

    it('low-priority items are joined with \\n in a single send', async () => {
      const ctx = makeCtx();
      await queueMessage(ctx, 's1', 'low-1', 'low');
      await queueMessage(ctx, 's1', 'low-2', 'low');
      expect(ctx.flushTimers.has('s1')).toBe(true);
      // Force a flush
      await flushQueue(ctx, 's1');
      expect(ctx.tgApi).toHaveBeenCalledTimes(1);
      const body = (ctx.tgApi as any).mock.calls[0][1];
      expect(body.text).toContain('low-1');
      expect(body.text).toContain('low-2');
    });

    it('flushes the 3s timer when 3s elapses', async () => {
      const ctx = makeCtx();
      await queueMessage(ctx, 's1', 'timed', 'normal');
      expect(ctx.flushTimers.has('s1')).toBe(true);
      // Advance the 3s flush timer
      await vi.advanceTimersByTimeAsync(3000);
      expect(ctx.tgApi).toHaveBeenCalled();
    });

    it('drops the oldest pending item when in-flight + queue exceeds MAX_IN_FLIGHT (10)', async () => {
      const ctx = makeCtx();
      ctx.inFlightCount.set('s1', 6);
      // Queue 6 items: 6 in-flight + 5 (after drop) = 11 > 10 → 1 drop
      for (let i = 0; i < 6; i++) {
        await queueMessage(ctx, 's1', `q${i}`, 'normal');
      }
      const queue = ctx.messageQueue.get('s1') ?? [];
      expect(queue.length).toBeLessThanOrEqual(5);
    });

    it('flushQueue is a no-op when the queue is empty', async () => {
      const ctx = makeCtx();
      await flushQueue(ctx, 's1');
      expect(ctx.tgApi).not.toHaveBeenCalled();
    });
  });

  describe('addPendingRead + flushReads', () => {
    it('queues a "Reading <file>" message for a single file', async () => {
      const ctx = makeCtx();
      addPendingRead(ctx, 's1', '/src/foo.ts');
      expect(ctx.readTimer.has('s1')).toBe(true);
      await flushReads(ctx, 's1');
      await vi.advanceTimersByTimeAsync(3000);
      const text = (ctx.tgApi as any).mock.calls[0][1].text;
      expect(text).toContain('Reading');
      expect(text).toContain('foo.ts');
    });

    it('queues a "Reading N files: …" message for multiple files', async () => {
      const ctx = makeCtx();
      addPendingRead(ctx, 's1', '/a.ts');
      addPendingRead(ctx, 's1', '/b.ts');
      addPendingRead(ctx, 's1', '/c.ts');
      await flushReads(ctx, 's1');
      await vi.advanceTimersByTimeAsync(3000);
      const text = (ctx.tgApi as any).mock.calls[0][1].text;
      expect(text).toContain('<b>3</b> files');
    });

    it('truncates the file list to 8 with "+N more" when there are more than 8', async () => {
      const ctx = makeCtx();
      for (let i = 0; i < 12; i++) addPendingRead(ctx, 's1', `/f${i}.ts`);
      await flushReads(ctx, 's1');
      await vi.advanceTimersByTimeAsync(3000);
      const text = (ctx.tgApi as any).mock.calls[0][1].text;
      expect(text).toContain('<b>12</b> files');
      expect(text).toContain('+4 more');
    });

    it('clears the read timer when flushReads is called', async () => {
      const ctx = makeCtx();
      addPendingRead(ctx, 's1', '/x.ts');
      expect(ctx.readTimer.has('s1')).toBe(true);
      await flushReads(ctx, 's1');
      expect(ctx.readTimer.has('s1')).toBe(false);
    });
  });

  describe('removeReplyMarkup', () => {
    it('calls editMessageReplyMarkup on tgApi', async () => {
      const ctx = makeCtx();
      await removeReplyMarkup(ctx, 's1', 200);
      expect(ctx.tgApi).toHaveBeenCalledWith('editMessageReplyMarkup', expect.objectContaining({
        message_id: 200,
        reply_markup: JSON.stringify({ inline_keyboard: [] }),
      }));
    });

    it('is a no-op when the topic does not exist', async () => {
      const ctx = makeCtx({ topicExists: false });
      await removeReplyMarkup(ctx, 's1', 200);
      expect(ctx.tgApi).not.toHaveBeenCalled();
    });
  });
});
